import { describe, it, expect } from 'vitest';
import type { Channel, HistoryPoint } from '../../src/types';
import {
  generateReport,
  periodRange,
  reportTitle,
  assetAtDate,
  toggleReportArchive,
} from '../../src/features/reports/generate';

const channels: Channel[] = [
  {
    id: 'a', name: '支付宝', emoji: '💙', amount: 0, color: '#000', isParent: true, isExpanded: false,
    children: [{ id: 'a1', name: '余额', emoji: '💰', amount: 100, color: '#000', parentId: 'a' }],
  },
  { id: 'b', name: '现金', emoji: '💵', amount: 50, color: '#000', isParent: true, isExpanded: false, children: [] },
];

const history: HistoryPoint[] = [
  { date: '2026-09-01', totalAmount: 100 },
  { date: '2026-10-05', totalAmount: 130 },
];

describe('报告生成', () => {
  it('periodRange 返回正确区间', () => {
    expect(periodRange('monthly', '2026-10-15')).toEqual({ startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(periodRange('yearly', '2026-07-01')).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' });
  });

  it('assetAtDate 取日期之前最近一次总资产', () => {
    expect(assetAtDate(history, '2026-09-15')).toBe(100);
    expect(assetAtDate(history, '2026-10-01')).toBe(100);
    expect(assetAtDate(history, '2026-10-10')).toBe(130);
    expect(assetAtDate([], '2026-01-01')).toBe(0);
  });

  it('generateReport 计算变化量与变化率', () => {
    const report = generateReport(channels, history, 'monthly', '2026-10-15');
    expect(report.totalAmount).toBe(150);
    // 期初（10-01 之前最近）为 100（9-01 的点），变化 +50
    expect(report.changeAmount).toBe(50);
    expect(report.changePercentage).toBe(50);
    expect(report.reportType).toBe('monthly');
    expect(report.channelDetails.length).toBe(2);
  });

  it('reportTitle 命名', () => {
    expect(reportTitle('yearly', '2026-07-01')).toBe('2026年年度财务报告');
    expect(reportTitle('monthly', '2026-07-01')).toBe('2026年7月月度财务报告');
  });

  it('toggleReportArchive 切换归档状态', () => {
    const r = generateReport(channels, history, 'weekly', '2026-10-03');
    const archived = toggleReportArchive(r, '已归档');
    expect(archived.isArchived).toBe(true);
    expect(archived.archiveNote).toBe('已归档');
    const restored = toggleReportArchive(archived);
    expect(restored.isArchived).toBe(false);
  });
});
