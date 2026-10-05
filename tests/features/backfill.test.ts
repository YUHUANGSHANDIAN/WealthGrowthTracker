import { describe, it, expect } from 'vitest';
import type { FinancialReport, HistoryPoint } from '../../src/types';
import { planBackfill, runBackfill, reportCoverage } from '../../src/features/reports/backfill';

function historyPoint(date: string, totalAmount: number, channels?: HistoryPoint['channels']): HistoryPoint {
  return { date, totalAmount, ...(channels ? { channels } : {}) };
}

function report(periodKey: string, startDate: string, endDate: string): FinancialReport {
  return {
    id: `r_${periodKey}`, reportType: 'monthly', startDate, endDate,
    title: '月报', totalAmount: 100, changeAmount: 0, changePercentage: 0,
    channelDetails: [], isArchived: false, createdAt: '2026-01-01T00:00:00.000Z',
    periodKey,
  };
}

// 用固定的「现在」避免依赖真实日期
const NOW = '2026-08-05';

describe('历史月度报告补生成（backfill）', () => {
  it('某月有 3 个 HistoryPoint，最后一条为 07-29 → 生成 monthly:2026-07，dataAsOf=07-29', () => {
    const history = [
      historyPoint('2026-07-10', 1000),
      historyPoint('2026-07-20', 1200),
      historyPoint('2026-07-29', 1500),
    ];
    const result = runBackfill([], history, NOW);
    expect(result.created).toContain('monthly:2026-07');
    const created = result.reports.find((r) => r.periodKey === 'monthly:2026-07')!;
    expect(created.dataAsOf).toBe('2026-07-29');
    expect(created.endDate).toBe('2026-07-31');
    expect(created.generationSource).toBe('historical-backfill');
    expect(created.totalAmount).toBe(1500);
  });

  it('已有 monthly:2026-07 → 不重复生成（repair/skip）', () => {
    const history = [historyPoint('2026-07-29', 1500)];
    const existing = [report('monthly:2026-07', '2026-07-01', '2026-07-31')];
    const result = runBackfill(existing, history, NOW);
    expect(result.created).not.toContain('monthly:2026-07');
    expect(result.reports.filter((r) => r.periodKey === 'monthly:2026-07')).toHaveLength(1);
  });

  it('无任何 History 的月份 → 跳过（不生成 0 元报告）', () => {
    const history = [historyPoint('2026-05-10', 500)];
    const result = runBackfill([], history, NOW);
    // 6 月、7 月无历史数据 → 不生成
    expect(result.created).not.toContain('monthly:2026-06');
    expect(result.created).not.toContain('monthly:2026-07');
  });

  it('当前未结束月份不作为历史缺失自动生成', () => {
    const history = [historyPoint('2026-08-01', 2000)];
    const result = runBackfill([], history, NOW);
    expect(result.created).not.toContain('monthly:2026-08');
  });

  it('planBackfill 输出 create/repair/skip 动作', () => {
    const history = [
      historyPoint('2026-05-10', 500),
      historyPoint('2026-07-29', 1500),
    ];
    const reports = [report('monthly:2026-05', '2026-05-01', '2026-05-31')];
    const plan = planBackfill(reports, history, NOW);
    const may = plan.find((p) => p.periodKey === 'monthly:2026-05')!;
    const june = plan.find((p) => p.periodKey === 'monthly:2026-06')!;
    const july = plan.find((p) => p.periodKey === 'monthly:2026-07')!;
    expect(may.action).toBe('repair');
    expect(june.action).toBe('skip');
    expect(july.action).toBe('create');
  });

  it('reportCoverage 覆盖 5~7 月（3 个月）', () => {
    const history = [historyPoint('2026-05-10', 500)];
    const coverage = reportCoverage([], history, NOW);
    const keys = coverage.map((c) => c.periodKey);
    expect(keys).toContain('monthly:2026-05');
    expect(keys).toContain('monthly:2026-06');
    expect(keys).toContain('monthly:2026-07');
  });
});
