import { describe, it, expect } from 'vitest';
import type { FinancialReport } from '../../src/types';
import { reportIndexEntry, buildReportIndex, buildReportsIndexCsv, buildReportsBatchHtml } from '../../src/features/reports/reportIndex';

function report(): FinancialReport {
  return {
    id: 'r1',
    reportType: 'weekly',
    startDate: '2026-09-28',
    endDate: '2026-10-04',
    title: '2026年第40周周度财务报告',
    totalAmount: 1000,
    changeAmount: 100,
    changePercentage: 10,
    channelDetails: [],
    isArchived: false,
    createdAt: '2026-10-04T00:00:00.000Z',
    periodKey: 'weekly:2026-W40',
    revision: 2,
    reportSchemaVersion: 2,
  };
}

describe('报告索引', () => {
  it('reportIndexEntry 字段完整', () => {
    const e = reportIndexEntry(report());
    expect(e.periodKey).toBe('weekly:2026-W40');
    expect(e.revision).toBe(2);
    expect(e.relativePath).toContain('.json');
  });

  it('buildReportIndex 生成 index.json 结构', () => {
    const idx = buildReportIndex([report()]);
    expect(idx.version).toBe(2);
    expect(idx.reports).toHaveLength(1);
  });

  it('CSV 索引表头与行数', () => {
    const { header, rows } = buildReportsIndexCsv([report()]);
    expect(header).toContain('periodKey');
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('r1');
  });

  it('批量 HTML 合集包含所有报告', () => {
    const html = buildReportsBatchHtml([report()]);
    expect(html).toContain('财务报告合集');
    expect(html).toContain('2026年第40周周度财务报告');
  });
});
