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

  it('当前周期：用当前渠道状态计算期末，不冒充过去', () => {
    const report = generateReport(history, 'monthly', '2026-10-15', channels, '2026-10-15');
    expect(report.totalAmount).toBe(150);
    expect(report.changeAmount).toBe(50);
    expect(report.changePercentage).toBe(50);
    expect(report.reportType).toBe('monthly');
    expect(report.channelDetails.length).toBe(2);
  });

  it('过去周期：使用历史渠道快照而非当前渠道', () => {
    const snapshot: Channel[] = [
      { id: 'x', name: '储蓄', emoji: '💰', amount: 80, color: '#000', isParent: true, isExpanded: false, children: [] },
    ];
    const histWithSnapshot: HistoryPoint[] = [
      { date: '2026-08-31', totalAmount: 50 },
      { date: '2026-09-30', totalAmount: 80, channels: snapshot },
    ];
    const report = generateReport(histWithSnapshot, 'monthly', '2026-09-15', channels, '2026-10-15');
    expect(report.totalAmount).toBe(80);
    expect(report.changeAmount).toBe(30);
    expect(report.channelSnapshotMissing).toBeUndefined();
    expect(report.channelDetails.length).toBe(1);
    expect(report.channelDetails[0]!.amount).toBe(80);
  });

  it('旧版历史无渠道快照：明确标记而非拿今天数据冒充', () => {
    const oldHist: HistoryPoint[] = [
      { date: '2026-08-31', totalAmount: 50 },
      { date: '2026-09-30', totalAmount: 80 },
    ];
    const report = generateReport(oldHist, 'monthly', '2026-09-15', channels, '2026-10-15');
    expect(report.totalAmount).toBe(80);
    expect(report.channelSnapshotMissing).toBe(true);
    expect(report.channelDetails.length).toBe(0);
  });

  it('reportTitle 命名', () => {
    expect(reportTitle('yearly', '2026-07-01')).toBe('2026年年度财务报告');
    expect(reportTitle('monthly', '2026-07-01')).toBe('2026年7月月度财务报告');
  });

  it('toggleReportArchive 切换归档状态', () => {
    const r = generateReport(history, 'weekly', '2026-10-03', channels, '2026-10-03');
    const archived = toggleReportArchive(r, '已归档');
    expect(archived.isArchived).toBe(true);
    expect(archived.archiveNote).toBe('已归档');
    const restored = toggleReportArchive(archived);
    expect(restored.isArchived).toBe(false);
  });
});
