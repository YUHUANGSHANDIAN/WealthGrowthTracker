import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import { defaultChannels, defaultCountdownData } from '../../src/constants/defaults';

describe('报告同周期 upsert', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({
      hydrated: true,
      channels: defaultChannels(),
      history: [{ date: '2026-10-04', totalAmount: 1000 }],
      reports: [],
      countdown: defaultCountdownData(),
      goalAchieved: { hasAchievedGoal: false },
      toasts: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同 periodKey 默认更新而非无限创建', () => {
    const r1 = useAppStore.getState().generateReportNow('weekly', '2026-10-04', 'update');
    const r2 = useAppStore.getState().generateReportNow('weekly', '2026-10-04', 'update');
    const reports = useAppStore.getState().reports;
    expect(reports).toHaveLength(1);
    expect(r2.id).toBe(r1.id);
    expect(r2.revision).toBe(2);
    expect(r1.revision).toBe(1);
  });

  it('saveAs 强制新增一份', () => {
    useAppStore.getState().generateReportNow('weekly', '2026-10-04', 'update');
    const r2 = useAppStore.getState().generateReportNow('weekly', '2026-10-04', 'saveAs');
    expect(useAppStore.getState().reports).toHaveLength(2);
    expect(r2.revision).toBe(1);
  });

  it('归档报告默认不静默覆盖', () => {
    const r1 = useAppStore.getState().generateReportNow('weekly', '2026-10-04', 'update');
    useAppStore.getState().archiveReport(r1.id, '已归档');
    const r2 = useAppStore.getState().generateReportNow('weekly', '2026-10-04', 'update');
    const reports = useAppStore.getState().reports;
    expect(reports).toHaveLength(2);
    // 归档报告保留归档备注，新报告是独立的一份
    const archived = reports.find((r) => r.id === r1.id)!;
    expect(archived.isArchived).toBe(true);
    expect(archived.archiveNote).toBe('已归档');
    expect(r2.id).not.toBe(r1.id);
  });

  it('不同周期生成不同报告', () => {
    useAppStore.getState().generateReportNow('weekly', '2026-10-04', 'update');
    useAppStore.getState().generateReportNow('weekly', '2026-09-27', 'update');
    expect(useAppStore.getState().reports).toHaveLength(2);
  });
});
