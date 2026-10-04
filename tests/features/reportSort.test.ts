import { describe, it, expect } from 'vitest';
import type { FinancialReport } from '../../src/types';
import { sortReports, reportFieldValue, REPORT_SORT_PRESETS } from '../../src/features/reports/reportSort';

function report(overrides: Partial<FinancialReport>): FinancialReport {
  return {
    id: overrides.id ?? 'r',
    reportType: 'weekly',
    startDate: '2026-01-05',
    endDate: '2026-01-11',
    title: 'T',
    totalAmount: 1000,
    changeAmount: 0,
    changePercentage: 0,
    channelDetails: [],
    isArchived: false,
    createdAt: '2026-01-05T00:00:00.000Z',
    periodKey: 'weekly:2026-W02',
    dataCompleteness: 100,
    ...overrides,
  };
}

describe('报告排序', () => {
  it('单字段：周期从新到旧', () => {
    const a = report({ id: 'a', startDate: '2026-01-05', periodKey: 'weekly:2026-W02' });
    const b = report({ id: 'b', startDate: '2026-02-02', periodKey: 'weekly:2026-W06' });
    const out = sortReports([a, b], [{ field: 'period', direction: 'desc' }]);
    expect(out.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('多维排序：归档状态 → 周期', () => {
    const a = report({ id: 'a', isArchived: true, startDate: '2026-03-01', periodKey: 'weekly:2026-W10' });
    const b = report({ id: 'b', isArchived: false, startDate: '2026-01-01', periodKey: 'weekly:2026-W01' });
    const c = report({ id: 'c', isArchived: false, startDate: '2026-02-01', periodKey: 'weekly:2026-W05' });
    const out = sortReports([a, b, c], [
      { field: 'archived', direction: 'asc' },
      { field: 'period', direction: 'desc' },
    ]);
    expect(out.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('N/A 字段始终排到最后', () => {
    const withVal = report({ id: 'a', totalAmount: 100, dataCompleteness: 90 });
    const na = report({ id: 'b', totalAmount: 200, dataCompleteness: undefined });
    const desc = sortReports([withVal, na], [{ field: 'completeness', direction: 'desc' }]);
    expect(desc[0]!.id).toBe('a');
    const asc = sortReports([withVal, na], [{ field: 'completeness', direction: 'asc' }]);
    expect(asc[0]!.id).toBe('a');
  });

  it('变化金额排序', () => {
    const a = report({ id: 'a', changeAmount: 10 });
    const b = report({ id: 'b', changeAmount: 500 });
    expect(sortReports([a, b], [{ field: 'changeAmount', direction: 'desc' }]).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('稳定排序：相等键保持原相对顺序', () => {
    const a = report({ id: 'a', totalAmount: 100 });
    const b = report({ id: 'b', totalAmount: 100 });
    const c = report({ id: 'c', totalAmount: 100 });
    const out = sortReports([a, b, c], [{ field: 'totalAmount', direction: 'desc' }]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('字段值提取', () => {
    expect(reportFieldValue(report({}), 'totalAmount')).toBe(1000);
    expect(reportFieldValue(report({}), 'archived')).toBe(0);
    expect(reportFieldValue(report({ totalAmount: NaN }), 'totalAmount')).toBeNull();
  });

  it('预设存在且可用', () => {
    const ids = REPORT_SORT_PRESETS.map((p) => p.id);
    expect(ids).toContain('recent');
    expect(ids).toContain('most-complete');
    expect(ids).toContain('unarchived-first');
  });
});
