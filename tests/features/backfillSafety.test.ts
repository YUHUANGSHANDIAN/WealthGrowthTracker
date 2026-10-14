import { describe, expect, it } from 'vitest';
import { runBackfill, reportCoverage } from '../../src/features/reports/backfill';
import { normalizeFinancialReport, REPORT_RENDERER_VERSION, REPORT_SCHEMA_VERSION } from '../../src/features/reports/normalize';
import type { FinancialReport } from '../../src/types';

const report: FinancialReport = { id: 'r', reportType: 'monthly', title: '我的原标题🐱', startDate: '2026-09-01', endDate: '2026-09-30',
  dataAsOf: '2026-09-20', totalAmount: 100, changeAmount: 0, changePercentage: 0, channelDetails: [], isArchived: false,
  createdAt: '2026-09-20', reportSchemaVersion: 4, reportRendererVersion: 3 };

describe('safe report schema migration and backfill', () => {
  it('recognizes a legacy month without a reliable period key and retains saved financial facts', () => {
    const result = runBackfill([report], [{ date: '2026-09-28', totalAmount: 999 }], '2026-10-13');
    expect(result.created).toEqual([]);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({ title: report.title, totalAmount: 100, dataAsOf: '2026-09-20',
      reportSchemaVersion: REPORT_SCHEMA_VERSION, reportRendererVersion: REPORT_RENDERER_VERSION });
    const again = runBackfill(result.reports, [{ date: '2026-09-28', totalAmount: 999 }], '2026-10-13');
    expect(again.repaired).toEqual([]);
    expect(again.reports).toEqual(result.reports);
  });
  it('ignores invalid and future history for coverage', () => {
    expect(reportCoverage([], [{ date: 'bad', totalAmount: 1 }, { date: '2027-01-01', totalAmount: 2 }, { date: '2026-09-01', totalAmount: NaN }], '2026-10-13')).toEqual([]);
  });
  it('does not downgrade future schema or renderer versions', () => {
    expect(() => normalizeFinancialReport({ ...report, reportSchemaVersion: REPORT_SCHEMA_VERSION + 1 })).toThrow('更新版本');
    expect(() => normalizeFinancialReport({ ...report, reportRendererVersion: REPORT_RENDERER_VERSION + 1 })).toThrow('更新版本');
  });
});
