import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import { defaultChannels, defaultCountdownData } from '../../src/constants/defaults';
import type { ReportType } from '../../src/types';

async function saveReport(type: ReportType, referenceDate: string) {
  const store = useAppStore.getState();
  return store.confirmReport(store.prepareReport(type, referenceDate), { overwriteSnapshot: true, overwriteReport: true });
}

describe('报告同周期 upsert（一周期唯一）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    useAppStore.setState({
      hydrated: true,
      channels: defaultChannels(),
      history: [
        { date: '2026-09-27', totalAmount: 900 },
        { date: '2026-10-04', totalAmount: 1000 },
      ],
      reports: [],
      countdown: defaultCountdownData(),
      goalAchieved: { hasAchievedGoal: false },
      toasts: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('相同 periodKey 重复确认保持幂等', async () => {
    const r1 = await saveReport('weekly', '2026-10-04');
    const r2 = await saveReport('weekly', '2026-10-04');
    const reports = useAppStore.getState().reports;
    expect(reports).toHaveLength(1);
    expect(r2.id).toBe(r1.id);
    expect(r2.revision).toBe(1);
    expect(r1.revision).toBe(1);
  });

  it('同周期唯一：不存在 saveAs 强制新增', async () => {
    await saveReport('weekly', '2026-10-04');
    await saveReport('weekly', '2026-10-04');
    expect(useAppStore.getState().reports).toHaveLength(1);
  });

  it('归档报告：确认更新也不新增第二份', async () => {
    const r1 = await saveReport('weekly', '2026-10-04');
    await useAppStore.getState().archiveReport(r1.id, '已归档');
    const r2 = await saveReport('weekly', '2026-10-04');
    const reports = useAppStore.getState().reports;
    expect(reports).toHaveLength(1);
    expect(r2.id).toBe(r1.id);
  });

  it('不同周期生成不同报告', async () => {
    await saveReport('weekly', '2026-10-04');
    await saveReport('weekly', '2026-09-27');
    expect(useAppStore.getState().reports).toHaveLength(2);
  });
});
