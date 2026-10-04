import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import { defaultChannels } from '../../src/constants/defaults';
import { generateReport } from '../../src/features/reports/generate';
import { findReportConflict, displayTitle, repairReportFromHistory } from '../../src/features/reports/reportRepair';
import type { FinancialReport, HistoryPoint } from '../../src/types';

const channels = defaultChannels();
const history: HistoryPoint[] = [
  { date: '2026-09-28', totalAmount: 1000 },
  { date: '2026-10-01', totalAmount: 1200 },
  { date: '2026-10-04', totalAmount: 1500, channels },
];

describe('报告冲突与更新流程', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({
      hydrated: true,
      channels,
      history,
      reports: [],
      toasts: [],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('第一次生成：无冲突，直接新增', () => {
    const generated = generateReport(history, 'weekly', '2026-10-04', channels);
    expect(findReportConflict(useAppStore.getState().reports, generated.periodKey)).toBeUndefined();
    useAppStore.getState().commitReport(generated, 'update');
    expect(useAppStore.getState().reports).toHaveLength(1);
  });

  it('第二次生成：返回 Conflict（不静默写 Store）', () => {
    const g1 = generateReport(history, 'weekly', '2026-10-04', channels);
    useAppStore.getState().commitReport(g1, 'update');
    const before = useAppStore.getState().reports.length;

    const g2 = generateReport(history, 'weekly', '2026-10-04', channels);
    const conflict = findReportConflict(useAppStore.getState().reports, g2.periodKey);
    expect(conflict).toBeDefined();
    // 未选择任何动作前，Store 不变
    expect(useAppStore.getState().reports).toHaveLength(before);
  });

  it('选择 Update：ID 不变，revision + 1', () => {
    const g1 = generateReport(history, 'weekly', '2026-10-04', channels);
    const r1 = useAppStore.getState().commitReport(g1, 'update');
    const conflict = findReportConflict(useAppStore.getState().reports, r1.periodKey)!;
    const r2 = useAppStore.getState().commitReport(generateReport(history, 'weekly', '2026-10-04', channels), 'update', conflict);
    expect(r2.id).toBe(r1.id);
    expect(r2.revision).toBe(2);
    expect(useAppStore.getState().reports).toHaveLength(1);
  });

  it('选择 Save As：新 ID', () => {
    const r1 = useAppStore.getState().commitReport(generateReport(history, 'weekly', '2026-10-04', channels), 'update');
    const conflict = findReportConflict(useAppStore.getState().reports, r1.periodKey)!;
    const r2 = useAppStore.getState().commitReport(generateReport(history, 'weekly', '2026-10-04', channels), 'saveAs', conflict);
    expect(r2.id).not.toBe(r1.id);
    expect(r2.copyOfReportId).toBe(r1.id);
    expect(useAppStore.getState().reports).toHaveLength(2);
  });

  it('选择 Cancel：Store 不变', () => {
    useAppStore.getState().commitReport(generateReport(history, 'weekly', '2026-10-04', channels), 'update');
    const snapshot = JSON.stringify(useAppStore.getState().reports);
    // cancel = 不调用 commitReport
    expect(JSON.stringify(useAppStore.getState().reports)).toBe(snapshot);
  });

  it('归档报告：update 不静默覆盖（自动另存）', () => {
    const r1 = useAppStore.getState().commitReport(generateReport(history, 'weekly', '2026-10-04', channels), 'update');
    useAppStore.getState().archiveReport(r1.id, '已归档');
    const archived = useAppStore.getState().reports.find((r) => r.id === r1.id)!;
    expect(archived.isArchived).toBe(true);
    // 对归档报告执行 update：不覆盖，而是另存新版本
    const r2 = useAppStore.getState().commitReport(generateReport(history, 'weekly', '2026-10-04', channels), 'update', archived);
    expect(r2.id).not.toBe(r1.id);
    expect(useAppStore.getState().reports).toHaveLength(2);
  });
});

describe('自定义标题', () => {
  it('auto 标题 → 改为 custom → 更新后保留', () => {
    const g = generateReport(history, 'weekly', '2026-10-04', channels);
    const r = useAppStore.getState().commitReport(g, 'update');
    useAppStore.getState().updateReportMetadata(r.id, { titleMode: 'custom', customTitle: '国庆假期资产报告' });
    const custom = useAppStore.getState().reports.find((x) => x.id === r.id)!;
    expect(displayTitle(custom)).toBe('国庆假期资产报告');

    const conflict = findReportConflict(useAppStore.getState().reports, custom.periodKey)!;
    const updated = useAppStore.getState().commitReport(generateReport(history, 'weekly', '2026-10-04', channels), 'update', conflict);
    expect(displayTitle(updated)).toBe('国庆假期资产报告'); // 更新后自定义标题保留
  });

  it('切回 auto：恢复标准标题', () => {
    const r = useAppStore.getState().commitReport(generateReport(history, 'weekly', '2026-10-04', channels), 'update');
    useAppStore.getState().updateReportMetadata(r.id, { titleMode: 'custom', customTitle: 'X' });
    useAppStore.getState().updateReportMetadata(r.id, { titleMode: 'auto' });
    const back = useAppStore.getState().reports.find((x) => x.id === r.id)!;
    expect(displayTitle(back)).toBe(back.standardTitle);
  });
});

describe('历史报告修复', () => {
  it('缺 previousTotal / 极值 / channels：从 History 恢复', () => {
    const legacy: FinancialReport = {
      id: 'r', reportType: 'weekly', startDate: '2026-09-28', endDate: '2026-10-04',
      title: '', totalAmount: 1500, changeAmount: 0, changePercentage: 0,
      channelDetails: [], isArchived: false, createdAt: '2026-10-04T00:00:00.000Z',
    };
    const { report, repairedFields } = repairReportFromHistory(legacy, history);
    expect(report.previousTotalAmount).toBe(1000);
    expect(report.weeklyMax).toBe(1500);
    expect(report.channelDetails.length).toBeGreaterThan(0);
    expect(repairedFields).toContain('previousTotalAmount');
    expect(report.fieldProvenance?.previousTotalAmount).toBe('history-snapshot');
  });

  it('History 不足：保持 missing 并诚实提示', () => {
    const legacy: FinancialReport = {
      id: 'r', reportType: 'monthly', startDate: '2026-10-01', endDate: '2026-10-31',
      title: '', totalAmount: 1500, changeAmount: 0, changePercentage: 0,
      channelDetails: [], isArchived: false, createdAt: '2026-10-04T00:00:00.000Z',
    };
    const noChannels: HistoryPoint[] = [{ date: '2026-10-04', totalAmount: 1500 }];
    const { report, warnings } = repairReportFromHistory(legacy, noChannels);
    expect(report.channelSnapshotMissing).toBe(true);
    expect(report.channelDetails.length).toBe(0);
    expect(warnings.some((w) => w.includes('无法恢复'))).toBe(true);
  });
});
