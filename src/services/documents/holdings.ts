import { isDecimalText, roundMoney } from '../../domain/portfolio/decimal';
import type { EvidenceRef } from '../../domain/portfolio/types';
import type { ExtractedRow, ExtractedTable } from './ooxml';

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
  /** 净值日期（规范化 YYYY-MM-DD）；没有它就不得写入 nav，避免用当天日期冒充历史净值。 */
  navDate: string | null;
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

export type ColumnKind = 'fundCode' | 'name' | 'shares' | 'marketValue' | 'nav' | 'navDate' | 'profit';

/** 表头列名 → 单元格下标；按文档推导一次后应用到该文档的所有表格。 */
export type ColumnMap = Partial<Record<ColumnKind, number>>;

export interface ExtractResult {
  rows: HoldingRowCandidate[];
  duplicates: number;
  /** 推导出的列映射；为 null 表示没有可用表头，已退回位置推定。 */
  columnMap: ColumnMap | null;
  /** 表格级问题（表头歧义、缺净值日期、退回位置推定等），由调用方提示用户。 */
  tableIssues: string[];
}

const CODE = /^[0-9]{6}$|^[0-9A-Z]{6,8}$/;
const MONEY = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;
const IDENTIFIER = /^[0-9A-Za-z]{1,20}$/;

/** 序号、账号这类列永远不是金额列，直接忽略。 */
const HEADER_IGNORE = /序号|账号|账户|编号/;

/**
 * 关键词 → 列用途。顺序有意义：净值日期必须先于净值判定，净值本身排除“日期/累计”。
 * 真实导出的表头顺序互不相同（微信是 份额→市值，支付宝是 账号→份额→净值→净值日期→资产小计），
 * 所以只能按关键词定位，不能按固定位置取值。
 */
const COLUMN_RULES: ReadonlyArray<{ kind: ColumnKind; match: RegExp; exclude?: RegExp }> = [
  { kind: 'fundCode', match: /代码|code/i, exclude: /账号|account/i },
  { kind: 'name', match: /名称|产品|name/i, exclude: /代码|code/i },
  { kind: 'shares', match: /份额|shares?/i, exclude: /市值|资产|value/i },
  { kind: 'marketValue', match: /市值|资产小计|金额|market\s*value/i, exclude: /净值|nav/i },
  { kind: 'navDate', match: /净值日期|日期|date/i, exclude: /份额|市值/ },
  { kind: 'nav', match: /净值|nav/i, exclude: /日期|date|累计/ },
  { kind: 'profit', match: /收益|盈亏|profit/i },
];

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

/** 净值日期规范化：接受 20260720 / 2026-07-20 / 2026/7/20，非法或不存在返回 null。 */
export function normalizeNavDate(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const value = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * 从一行里识别表头：至少两列命中已知关键词才算表头。
 * 不依赖 ooxml 的 isHeader（它对“查询份额/总份额”这类真实表头判 false）。
 */
function detectHeaderRow(row: ExtractedRow): { map: ColumnMap; issues: string[] } | null {
  const map: ColumnMap = {};
  const issues: string[] = [];
  for (const cell of row.cells) {
    const text = cell.text.trim();
    if (!text || HEADER_IGNORE.test(text)) continue;
    const kinds = COLUMN_RULES.filter((rule) => rule.match.test(text) && !(rule.exclude?.test(text) ?? false))
      .map((rule) => rule.kind);
    if (kinds.length === 0) continue;
    if (kinds.length > 1) {
      issues.push(`表头「${text}」同时匹配 ${kinds.join('/')}，该列已忽略，请人工核对`);
      continue;
    }
    const kind = kinds[0]!;
    if (map[kind] !== undefined) {
      issues.push(`表头存在多列 ${kind}，已取第一列`);
      continue;
    }
    map[kind] = cell.cellIndex;
  }
  if (Object.keys(map).length < 2) return null;
  return { map, issues };
}

function textAt(row: ExtractedRow, index: number | undefined): string {
  if (index === undefined) return '';
  return row.cells[index]?.text.trim() ?? '';
}

function moneyAt(row: ExtractedRow, index: number | undefined): number | null {
  if (index === undefined) return null;
  const cell = row.cells[index];
  return cell ? parseMoneyText(cell.text) : null;
}

function decimalAt(row: ExtractedRow, index: number | undefined): string | null {
  if (index === undefined) return null;
  const raw = row.cells[index]?.text.replace(/[¥￥\s]/g, '') ?? '';
  return raw && isDecimalText(raw) ? raw : null;
}

/**
 * 表格行 → 持仓候选：代码按字符串保留（前导零不丢），金额/份额解析失败记为未知而不是 0。
 * 列含义由表头关键词确定；没有可用表头时退回固定位置顺序，但一定带上“请人工核对”的问题，
 * 绝不静默猜测。表头行不产生候选；同一表格内完全相同的行按重复计数。
 */
export function extractHoldingRows(tables: readonly ExtractedTable[], options: ExtractOptions): ExtractResult {
  const rows: HoldingRowCandidate[] = [];
  let duplicates = 0;
  const seenRaw = new Map<string, number>();
  const tableIssues: string[] = [];
  const note = (message: string) => { if (!tableIssues.includes(message)) tableIssues.push(message); };

  // 每个表格自己的表头（只看前两行），并挑出第一份可用的文档级映射。
  const ownMaps = new Map<number, ColumnMap>();
  let documentMap: ColumnMap | null = null;
  for (const table of tables) {
    for (const row of table.rows.slice(0, 2)) {
      const detected = detectHeaderRow(row);
      if (!detected) continue;
      if (!ownMaps.has(table.index)) ownMaps.set(table.index, detected.map);
      if (!documentMap) documentMap = detected.map;
      detected.issues.forEach(note);
      break;
    }
  }

  for (const table of tables) {
    const map = ownMaps.get(table.index) ?? documentMap;
    const positional = map === null;
    if (positional) note('未识别表头，列含义按默认顺序推定，请人工核对');
    for (const row of table.rows) {
      if (row.isHeader) continue;
      if (detectHeaderRow(row)) continue;
      const texts = row.cells.map((cell) => cell.text).filter((text) => text.length > 0);
      if (texts.length < 2) continue;

      const issues: string[] = [];
      let fundCode: string | null = null;
      let name: string | null = null;
      let shares: string | null = null;
      let marketValue: number | null = null;
      let nav: string | null = null;
      let navDate: string | null = null;
      let profit: number | null = null;
      let evidenceCellIndex = 0;

      if (map) {
        const codeText = textAt(row, map.fundCode);
        fundCode = CODE.test(codeText) || (IDENTIFIER.test(codeText) && /\d/.test(codeText)) ? codeText : null;
        name = textAt(row, map.name) || null;
        const sharesText = textAt(row, map.shares);
        shares = sharesText ? parseSharesText(sharesText) : null;
        marketValue = moneyAt(row, map.marketValue);
        nav = decimalAt(row, map.nav);
        navDate = normalizeNavDate(textAt(row, map.navDate));
        const profitText = textAt(row, map.profit);
        profit = profitText ? parseMoneyText(profitText) : null;
        evidenceCellIndex = map.fundCode ?? map.name ?? 0;
        if (map.marketValue === undefined) issues.push('表头未给出市值列，市值记为未知');
        else if (marketValue === null) issues.push('未识别到市值金额');
        // 至少要有一个像样的身份：有效代码，或看起来真的是产品名称的名称列。
        const nameLooksReal = name !== null && looksLikeName(name);
        if (!fundCode && !nameLooksReal) continue;
        if (!name) issues.push('缺少可识别的产品名称');
        else if (!nameLooksReal) issues.push('名称列内容不像产品名称，请核对列含义');
        if (sharesText && shares === null) issues.push('份额列无法解析为数字，已记为未知');
      } else {
        const codeCell = row.cells.find((cell) => CODE.test(cell.text.trim()));
        if (!codeCell) continue;
        const nameCell = row.cells.find((cell) => cell !== codeCell && looksLikeName(cell.text));
        const numbers = row.cells
          .filter((cell) => cell !== codeCell && cell !== nameCell)
          .map((cell) => ({ cell, value: parseMoneyText(cell.text) }))
          .filter((entry) => entry.value !== null);
        fundCode = codeCell.text.trim();
        name = nameCell ? nameCell.text.trim() : null;
        if (!nameCell) issues.push('缺少可识别的产品名称');
        const [marketValueCell, sharesCell, navCell, profitCell] = numbers;
        if (!marketValueCell) issues.push('未识别到市值金额');
        if (numbers.length > 4) issues.push('数值列多于预期（市值/份额/净值/收益），请人工核对列含义');
        marketValue = marketValueCell ? marketValueCell.value : null;
        shares = sharesCell && parseSharesText(sharesCell.cell.text) ? parseSharesText(sharesCell.cell.text) : null;
        nav = navCell && isDecimalText(navCell.cell.text.replace(/[¥￥\s]/g, '')) ? navCell.cell.text.replace(/[¥￥\s]/g, '') : null;
        profit = profitCell ? profitCell.value : null;
        evidenceCellIndex = codeCell.cellIndex;
      }
      // 有净值却没有净值日期时不能凭当天日期补日期，只能把净值降级为未知。
      if (nav !== null && navDate === null) {
        nav = null;
        issues.push('有净值但缺少净值日期，净值已置为未知');
      }

      const evidence: EvidenceRef[] = [{
        sourceId: options.sourceId,
        tableIndex: table.index,
        rowIndex: row.rowIndex,
        cellIndex: evidenceCellIndex,
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
        fundCode,
        name,
        shares,
        marketValue,
        nav,
        navDate,
        profit,
        raw: row.text,
        issues,
        evidence,
      });
    }
  }
  return { rows, duplicates, columnMap: documentMap, tableIssues };
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
