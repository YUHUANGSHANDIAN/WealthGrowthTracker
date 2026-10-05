import type { FinancialReport, HistoryPoint } from '../../types';
import { generateReport } from './generate';
import { normalizeFinancialReport } from './normalize';
import { pad2, todayString } from '../../utils/date';

/**
 * 历史月度报告覆盖与补生成（v1.5）。
 *
 * 规则：
 * - 只处理「已经结束的历史月份」（当前月不算历史缺失）。
 * - 对每个已结束月份，找到该月最后一条有效 HistoryPoint（effective end snapshot）。
 * - 若该月已有 canonical monthly report（periodKey = monthly:YYYY-MM）→ repair / skip，绝不重复。
 * - 若该月缺失月报但有历史数据 → 自动补生成（generationSource = historical-backfill）。
 * - 无任何 HistoryPoint 的月份 → 跳过（绝不生成 0 元报告）。
 * - 补生成时 dataAsOf = 该月最后有效记录日期，绝不虚构真正月末值。
 */

export interface MonthCoverage {
  periodKey: string;
  year: number;
  month: number; // 1-12
  lastDataDate: string | null;
  hasReport: boolean;
}

/** 列出从最早历史记录到上一个已结束月份的所有月份的覆盖情况。 */
export function reportCoverage(reports: FinancialReport[], history: HistoryPoint[], now = todayString()): MonthCoverage[] {
  if (history.length === 0) return [];
  const dates = history.map((h) => h.date).sort();
  const earliest = dates[0]!;
  const curYear = Number(now.slice(0, 4));
  const curMonth = Number(now.slice(5, 7));

  const existing = new Set(reports.filter((r) => r.periodKey?.startsWith('monthly:')).map((r) => r.periodKey));

  const result: MonthCoverage[] = [];
  let y = Number(earliest.slice(0, 4));
  let m = Number(earliest.slice(5, 7));
  while (y < curYear || (y === curYear && m < curMonth)) {
    const mm = pad2(m);
    const periodKey = `monthly:${y}-${mm}`;
    const prefix = `${y}-${mm}`;
    const inMonth = dates.filter((d) => d.startsWith(prefix));
    result.push({
      periodKey,
      year: y,
      month: m,
      lastDataDate: inMonth.length ? inMonth[inMonth.length - 1]! : null,
      hasReport: existing.has(periodKey),
    });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return result;
}

export type BackfillAction = 'create' | 'repair' | 'skip';

export interface BackfillPreviewEntry {
  periodKey: string;
  month: string; // YYYY-MM
  lastDataDate: string | null;
  hasReport: boolean;
  action: BackfillAction;
  reason: string;
}

/** 生成补月报计划（只预览，不写数据）。 */
export function planBackfill(reports: FinancialReport[], history: HistoryPoint[], now = todayString()): BackfillPreviewEntry[] {
  return reportCoverage(reports, history, now).map((c) => {
    const month = `${c.year}-${pad2(c.month)}`;
    if (c.lastDataDate === null) {
      return { periodKey: c.periodKey, month, lastDataDate: null, hasReport: c.hasReport, action: 'skip', reason: '该月无历史数据，跳过' };
    }
    if (c.hasReport) {
      return { periodKey: c.periodKey, month, lastDataDate: c.lastDataDate, hasReport: true, action: 'repair', reason: '已有月报，仅修复/补全可推导字段' };
    }
    return { periodKey: c.periodKey, month, lastDataDate: c.lastDataDate, hasReport: false, action: 'create', reason: '缺失月报，将补生成' };
  });
}

export interface BackfillResult {
  reports: FinancialReport[];
  created: string[];
  repaired: string[];
}

/**
 * 执行补月报（幂等）：为缺失月份生成报告，为已有月份修复可推导字段。
 * 绝不创建重复报告；保留用户 customTitle/customSummary/tags/archiveNote。
 */
export function runBackfill(reports: FinancialReport[], history: HistoryPoint[], now = todayString()): BackfillResult {
  const plan = planBackfill(reports, history, now);
  let next = [...reports];
  const created: string[] = [];
  const repaired: string[] = [];

  for (const entry of plan) {
    if (entry.action === 'create' && entry.lastDataDate) {
      const referenceDate = `${entry.month}-15`; // 月中作为参考日；periodRange 使用月末
      const gen = generateReport(history, 'monthly', referenceDate, []);
      gen.generationSource = 'historical-backfill';
      gen.dataAsOf = entry.lastDataDate;
      next = [gen, ...next];
      created.push(entry.periodKey);
    } else if (entry.action === 'repair') {
      const idx = next.findIndex((r) => r.periodKey === entry.periodKey);
      if (idx >= 0) {
        const repairedReport = normalizeFinancialReport(next[idx]!);
        if (entry.lastDataDate) repairedReport.dataAsOf = entry.lastDataDate;
        next[idx] = repairedReport;
        repaired.push(entry.periodKey);
      }
    }
  }

  return { reports: next, created, repaired };
}

/** 按年份统计月度报告覆盖数（如 2025：月报 10 / 12）。 */
export function monthlyCoverageByYear(reports: FinancialReport[], history: HistoryPoint[], now = todayString()): { year: number; covered: number; total: number }[] {
  const coverage = reportCoverage(reports, history, now);
  const byYear = new Map<number, { covered: number; total: number }>();
  for (const c of coverage) {
    const entry = byYear.get(c.year) ?? { covered: 0, total: 0 };
    entry.total += 1;
    if (c.hasReport) entry.covered += 1;
    byYear.set(c.year, entry);
  }
  return [...byYear.entries()].map(([year, v]) => ({ year, covered: v.covered, total: v.total }));
}
