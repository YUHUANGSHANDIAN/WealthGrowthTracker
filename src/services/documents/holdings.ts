import { isDecimalText, roundMoney } from '../../domain/portfolio/decimal';
import type { EvidenceRef } from '../../domain/portfolio/types';
import type { ExtractedTable } from './ooxml';

export interface HoldingRowCandidate {
  id: string;
  tableIndex: number;
  rowIndex: number;
  source: 'body' | 'textbox';
  fundCode: string | null;
  name: string | null;
  shares: string | null;
  marketValue: number | null;
  nav: string | null;
  profit: number | null;
  raw: string;
  issues: string[];
  evidence: EvidenceRef[];
}

export interface ExtractOptions {
  sourceId: string;
  extractor: string;
  extractorVersion: string;
}

const CODE = /^[0-9]{6}$|^[0-9A-Z]{6,8}$/;
const MONEY = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;

/** 金额文本 → number；带千分位、括号负数都接受，异常返回 null 而不是 0。 */
export function parseMoneyText(text: string): number | null {
  const cleaned = text.replace(/[¥￥\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!MONEY.test(cleaned)) return null;
  const value = Number(cleaned.replace(/,/g, ''));
  return Number.isFinite(value) ? roundMoney(value) : null;
}

/** 份额文本 → 十进制字符串；不接受空值补 0。 */
export function parseSharesText(text: string): string | null {
  const cleaned = text.replace(/[,，\s份]/g, '');
  if (!isDecimalText(cleaned)) return null;
  return cleaned;
}

function looksLikeName(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text) && !/^(序号|名称|代码|份额|市值|金额|净值|持仓|收益|盈亏)$/.test(text);
}

/**
 * 表格行 → 持仓候选：代码按字符串保留（前导零不丢），金额/份额解析失败记为未知而不是 0。
 * 表头行不产生候选；同一表格内完全相同的行按重复计数，不重复产生候选。
 */
export function extractHoldingRows(tables: readonly ExtractedTable[], options: ExtractOptions): { rows: HoldingRowCandidate[]; duplicates: number } {
  const rows: HoldingRowCandidate[] = [];
  let duplicates = 0;
  const seenRaw = new Map<string, number>();
  for (const table of tables) {
    for (const row of table.rows) {
      if (row.isHeader) continue;
      const texts = row.cells.map((cell) => cell.text).filter((text) => text.length > 0);
      if (texts.length < 2) continue;
      const codeCell = row.cells.find((cell) => CODE.test(cell.text.trim()));
      if (!codeCell) continue;
      const nameCell = row.cells.find((cell) => cell !== codeCell && looksLikeName(cell.text));
      const numbers = row.cells
        .filter((cell) => cell !== codeCell && cell !== nameCell)
        .map((cell) => ({ cell, value: parseMoneyText(cell.text) }))
        .filter((entry) => entry.value !== null);
      const issues: string[] = [];
      if (!nameCell) issues.push('缺少可识别的产品名称');
      const [marketValueCell, sharesCell, navCell, profitCell] = numbers;
      if (!marketValueCell) issues.push('未识别到市值金额');
      if (numbers.length > 4) issues.push('数值列多于预期（市值/份额/净值/收益），请人工核对列含义');
      const evidence: EvidenceRef[] = [{
        sourceId: options.sourceId,
        tableIndex: table.index,
        rowIndex: row.rowIndex,
        cellIndex: codeCell.cellIndex,
        excerpt: row.text.slice(0, 240),
        extractor: options.extractor,
        extractorVersion: options.extractorVersion,
      }];
      const rawKey = `${table.index}:${row.text}`;
      const seen = seenRaw.get(rawKey);
      if (seen !== undefined) { duplicates += 1; continue; }
      seenRaw.set(rawKey, rows.length);
      rows.push({
        id: `row:${table.index}:${row.rowIndex}`,
        tableIndex: table.index,
        rowIndex: row.rowIndex,
        source: table.source,
        fundCode: CODE.test(codeCell.text.trim()) ? codeCell.text.trim() : null,
        name: nameCell ? nameCell.text.trim() : null,
        shares: sharesCell && parseSharesText(sharesCell.cell.text) ? parseSharesText(sharesCell.cell.text) : null,
        marketValue: marketValueCell ? marketValueCell.value : null,
        nav: navCell && isDecimalText(navCell.cell.text.replace(/[¥￥\s]/g, '')) ? navCell.cell.text.replace(/[¥￥\s]/g, '') : null,
        profit: profitCell ? profitCell.value : null,
        raw: row.text,
        issues,
        evidence,
      });
    }
  }
  return { rows, duplicates };
}

/** 候选行是否可以直接进入事实层：必须有代码/名称/至少一个已观察金额，且无阻塞性问题。 */
export function rowIsConfirmable(row: HoldingRowCandidate): boolean {
  return Boolean(row.fundCode || row.name) && row.marketValue !== null && !row.issues.includes('未识别到市值金额');
}

export function summarizeCandidates(rows: readonly HoldingRowCandidate[]): {
  total: number;
  confirmable: number;
  unknownValue: number;
  withIssues: number;
} {
  return {
    total: rows.length,
    confirmable: rows.filter(rowIsConfirmable).length,
    unknownValue: rows.filter((row) => row.marketValue === null).length,
    withIssues: rows.filter((row) => row.issues.length > 0).length,
  };
}
