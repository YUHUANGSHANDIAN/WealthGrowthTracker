import type { LotteryProject, LotteryTransaction } from '../../types';
import { round2 } from '../../utils/money';
import { lotteryTxFingerprint, lotteryTxIdFromFingerprint } from './lotteryTx';

/**
 * 旧彩票 Excel 导入（v1.4）：解析《财富成长记AI系统_彩票收支统计.xlsx》三个 Sheet：
 * - 汇总表：项目 + 总收入/总支出/净盈利（summary-only 项目，不伪造明细）
 * - *每日统计：跳过（全部从交易动态推导）
 * - *交易明细：真实交易（收入→prize、支出→stake、其他→adjustment）
 * 纯函数解析（可单测，不依赖真实 Excel）。
 */

export interface SheetLike {
  name: string;
  rows: string[][];
}

export interface LotteryExcelPreview {
  projectCount: number;
  detailedTransactionCount: number;
  legacyIncome: number;
  legacyExpense: number;
  legacyNet: number;
  projects: LotteryProject[];
  transactions: LotteryTransaction[];
  warnings: string[];
}

type SheetType = 'summary' | 'daily' | 'detail' | 'unknown';

function detectSheetType(name: string): SheetType {
  if (name.includes('汇总')) return 'summary';
  if (name.includes('每日统计')) return 'daily';
  if (name.includes('交易明细') || name.includes('明细')) return 'detail';
  return 'unknown';
}

function findHeaderIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] ?? [];
    const joined = row.join('');
    if (joined.includes('收入') || joined.includes('支出') || joined.includes('盈利') || joined.includes('金额')) return i;
  }
  return -1;
}

function colIndex(header: string[], names: string[]): number {
  for (const n of names) {
    const idx = header.findIndex((h) => h.includes(n));
    if (idx >= 0) return idx;
  }
  return -1;
}

function projectIdFromName(name: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `lp_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function num(v: string | undefined): number {
  if (v === undefined) return 0;
  const n = Number(String(v).replace(/[￥¥,，\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 解析汇总表 → summary-only 项目。 */
function parseSummarySheet(rows: string[][]): LotteryProject[] {
  const headerIdx = findHeaderIndex(rows);
  if (headerIdx < 0) return [];
  const header = rows[headerIdx]!;
  const nameCol = header.findIndex((h) => h.includes('项目') || h.includes('名称') || h.includes('彩票') || h.includes('足球') || h.includes('乐透') || h.includes('世界杯'));
  const incomeCol = colIndex(header, ['总收入', '收入']);
  const expenseCol = colIndex(header, ['总支出', '支出']);
  const netCol = colIndex(header, ['净盈利', '净盈亏', '净收益']);

  const projects: LotteryProject[] = [];
  const seen = new Set<string>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const name = (nameCol >= 0 ? row[nameCol] : row[0])?.trim();
    if (!name || name === '合计' || name === '总计' || name === '总' || name === '汇总') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const income = num(row[incomeCol]);
    const expense = num(row[expenseCol]);
    const net = row[netCol] !== undefined ? num(row[netCol]) : round2(income - expense);
    const now = new Date().toISOString();
    projects.push({
      id: projectIdFromName(name),
      name,
      category: name.includes('足球') ? 'sports-football' : name.includes('乐透') ? 'lotto' : 'other',
      status: 'active',
      emoji: name.includes('足球') ? '⚽' : name.includes('乐透') ? '🎱' : name.includes('世界杯') ? '🏆' : '🎟️',
      dataCompleteness: 'summary-only',
      legacySummary: { income: round2(income), expense: round2(expense), netProfitLoss: round2(net) },
      createdAt: now,
      updatedAt: now,
    });
  }
  return projects;
}

/** 解析交易明细 Sheet → 交易。 */
function parseDetailSheet(rows: string[][], projectId: string): LotteryTransaction[] {
  const headerIdx = findHeaderIndex(rows);
  if (headerIdx < 0) return [];
  const header = rows[headerIdx]!;
  const dateCol = colIndex(header, ['交易日期', '日期']);
  const timeCol = colIndex(header, ['交易时间', '时间']);
  const typeCol = colIndex(header, ['收/支', '收支', '类型', '收/支/其他']);
  const methodCol = colIndex(header, ['交易方式', '方式', '支付方式']);
  const amountCol = colIndex(header, ['金额']);
  const descCol = colIndex(header, ['转账说明', '说明', '备注']);
  const statusCol = colIndex(header, ['交易状态', '状态']);

  const out: LotteryTransaction[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const date = row[dateCol]?.trim();
    const time = row[timeCol]?.trim();
    const rawType = row[typeCol]?.trim();
    const amount = num(row[amountCol]);
    if (!date && !rawType && !amount) continue;

    let type: LotteryTransaction['type'];
    if (rawType?.includes('收入')) type = 'prize';
    else if (rawType?.includes('支出')) type = 'stake';
    else type = 'adjustment'; // 「其他」→ 默认余额调整，导入后可由用户修改

    const occurredAt = `${date ?? ''}${time ? `T${time.length === 5 ? time + ':00' : time}` : 'T00:00:00'}`;
    const tx: LotteryTransaction = {
      id: '',
      projectId,
      occurredAt,
      type,
      amount: Math.abs(round2(amount)),
      paymentMethod: row[methodCol]?.trim() || undefined,
      description: row[descCol]?.trim() || undefined,
      status: row[statusCol]?.trim() || undefined,
      source: 'excel-lottery',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tx.importFingerprint = lotteryTxFingerprint(tx);
    tx.id = lotteryTxIdFromFingerprint(tx.importFingerprint);
    out.push(tx);
  }
  return out;
}

/** 从 Sheet 名中提取项目名（去掉「每日统计」「交易明细」等后缀）。 */
function projectNameFromSheet(sheetName: string): string {
  return sheetName.replace(/每日统计|交易明细|明细|统计/g, '').trim();
}

/** 解析整个工作簿（纯函数）。 */
export function parseLotteryExcel(sheets: SheetLike[]): LotteryExcelPreview {
  const warnings: string[] = [];
  let projects: LotteryProject[] = [];
  const transactions: LotteryTransaction[] = [];

  for (const sheet of sheets) {
    const type = detectSheetType(sheet.name);
    if (type === 'summary') {
      projects = parseSummarySheet(sheet.rows);
    } else if (type === 'detail') {
      const pname = projectNameFromSheet(sheet.name);
      // 匹配汇总项目，否则新建
      let project = projects.find((p) => p.name.includes(pname) || pname.includes(p.name));
      if (!project) {
        const now = new Date().toISOString();
        project = { id: projectIdFromName(pname), name: pname, category: pname.includes('足球') ? 'sports-football' : 'other', status: 'active', emoji: pname.includes('足球') ? '⚽' : '🎟️', dataCompleteness: 'detailed', createdAt: now, updatedAt: now };
        projects.push(project);
      } else {
        // 有真实明细的项目：清除 summary 中的 legacySummary，交易才是唯一真相源（避免双计数）
        project = { ...project, dataCompleteness: 'detailed', legacySummary: undefined };
        projects = projects.map((p) => (p.id === project!.id ? project! : p));
      }
      const txs = parseDetailSheet(sheet.rows, project.id);
      const otherCount = txs.filter((t) => t.type === 'adjustment').length;
      if (otherCount > 0) warnings.push(`检测到 ${otherCount} 笔「其他」交易，已按「余额调整」导入（可在导入后修改）`);
      transactions.push(...txs);
    }
    // daily 统计 sheet 忽略（由交易动态推导）
  }

  const detailedIncome = round2(transactions.filter((t) => t.type === 'prize').reduce((a, t) => a + t.amount, 0));
  const detailedExpense = round2(transactions.filter((t) => t.type === 'stake').reduce((a, t) => a + t.amount, 0));
  const summaryIncome = round2(projects.reduce((a, p) => a + (p.legacySummary?.income ?? 0), 0));
  const summaryExpense = round2(projects.reduce((a, p) => a + (p.legacySummary?.expense ?? 0), 0));

  return {
    projectCount: projects.length,
    detailedTransactionCount: transactions.length,
    legacyIncome: round2(summaryIncome + detailedIncome),
    legacyExpense: round2(summaryExpense + detailedExpense),
    legacyNet: round2(summaryIncome + detailedIncome - summaryExpense - detailedExpense),
    projects,
    transactions,
    warnings,
  };
}
