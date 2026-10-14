import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import { defaultChannels } from '../../src/constants/defaults';
import { generateReport } from '../../src/features/reports/generate';
import { findReportConflict, displayTitle, repairReportFromHistory } from '../../src/features/reports/reportRepair';
import type { FinancialReport, HistoryPoint } from '../../src/types';

async function saveReport(report: FinancialReport): Promise<FinancialReport> {
  const store = useAppStore.getState();
  const proposal = store.prepareReport(report.reportType, report.endDate);
  return store.confirmReport(proposal, { overwriteSnapshot: true, overwriteReport: true });
}

const channels = defaultChannels();
const history: HistoryPoint[] = [
  { date: '2026-09-28', totalAmount: 1000 },
  { date: '2026-10-01', totalAmount: 1200 },
  { date: '2026-10-04', totalAmount: 1500, channels },
];

describe('报告冲突与更新流程（一周期唯一）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    useAppStore.setState({
      hydrated: true,
      channels,
      history,
      reports: [],
      toasts: [],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('第一次生成：无冲突，确认后新增', async () => {
    const generated = generateReport(history, 'weekly', '2026-10-04', channels);
    expect(findReportConflict(useAppStore.getState().reports, generated.periodKey)).toBeUndefined();
    await saveReport(generated);
    expect(useAppStore.getState().reports).toHaveLength(1);
  });

  it('第二次生成：返回 Conflict（不静默写 Store）', async () => {
    const g1 = generateReport(history, 'weekly', '2026-10-04', channels);
    await saveReport(g1);
    const before = useAppStore.getState().reports.length;

    const g2 = generateReport(history, 'weekly', '2026-10-04', channels);
    const conflict = findReportConflict(useAppStore.getState().reports, g2.periodKey);
    expect(conflict).toBeDefined();
    expect(useAppStore.getState().reports).toHaveLength(before);
  });

  it('重复确认相同报告：ID 与 revision 稳定，仍只有一份', async () => {
    const g1 = generateReport(history, 'weekly', '2026-10-04', channels);
    const r1 = await saveReport(g1);
    const r2 = await saveReport(generateReport(history, 'weekly', '2026-10-04', channels));
    expect(r2.id).toBe(r1.id);
    expect(r2.revision).toBe(1);
    expect(useAppStore.getState().reports).toHaveLength(1);
  });

  it('同周期唯一：确认更新绝不新增第二份', async () => {
    const r1 = await saveReport(generateReport(history, 'weekly', '2026-10-04', channels));
    const r2 = await saveReport(generateReport(history, 'weekly', '2026-10-04', channels));
    expect(r2.id).toBe(r1.id);
    expect(useAppStore.getState().reports).toHaveLength(1);
    // 不存在 copyOfReportId（已移除另存新版本概念）
    expect(r2.copyOfReportId).toBeUndefined();
  });

  it('选择 Cancel：Store 不变', async () => {
    await saveReport(generateReport(history, 'weekly', '2026-10-04', channels));
    const snapshot = JSON.stringify(useAppStore.getState().reports);
    // cancel = 不确认候选提案
    expect(JSON.stringify(useAppStore.getState().reports)).toBe(snapshot);
  });

  it('归档报告：不生成第二份（保留归档状态，revision 递增）', async () => {
    const r1 = await saveReport(generateReport(history, 'weekly', '2026-10-04', channels));
    await useAppStore.getState().archiveReport(r1.id, '已归档');
    const archived = useAppStore.getState().reports.find((r) => r.id === r1.id)!;
    expect(archived.isArchived).toBe(true);
    const r2 = await saveReport(generateReport(history, 'weekly', '2026-10-04', channels));
    expect(r2.id).toBe(r1.id);
    expect(useAppStore.getState().reports).toHaveLength(1);
  });
});

describe('自定义标题', () => {
  it('auto 标题 → 改为 custom → 更新后保留', async () => {
    const g = generateReport(history, 'weekly', '2026-10-04', channels);
    const r = await saveReport(g);
    await useAppStore.getState().updateReportMetadata(r.id, { titleMode: 'custom', customTitle: '国庆假期资产报告' });
    const custom = useAppStore.getState().reports.find((x) => x.id === r.id)!;
    expect(displayTitle(custom)).toBe('国庆假期资产报告');

    const updated = await saveReport(generateReport(history, 'weekly', '2026-10-04', channels));
    expect(displayTitle(updated)).toBe('国庆假期资产报告');
  });

  it('切回 auto：恢复标准标题', async () => {
    const r = await saveReport(generateReport(history, 'weekly', '2026-10-04', channels));
    await useAppStore.getState().updateReportMetadata(r.id, { titleMode: 'custom', customTitle: 'X' });
    await useAppStore.getState().updateReportMetadata(r.id, { titleMode: 'auto' });
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
