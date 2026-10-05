import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import { defaultChannels, defaultCountdownData } from '../../src/constants/defaults';
import { prepareHistoryUpsert, duplicateHistoryDates } from '../../src/utils/history';
import { checkReportHealth } from '../../src/utils/dataHealth';
import type { HistoryPoint, FinancialReport } from '../../src/types';

function pt(date: string, totalAmount: number, source?: HistoryPoint['source']): HistoryPoint {
  return { date, totalAmount, ...(source ? { source } : {}) };
}

describe('History 一天一条（Domain Invariant）', () => {
  it('prepareHistoryUpsert：同日期返回冲突，不覆盖', () => {
    const r = prepareHistoryUpsert([pt('2026-10-05', 100)], pt('2026-10-05', 200));
    expect(r.ok).toBe(false);
    expect(r.existing?.totalAmount).toBe(100);
    expect(r.history).toHaveLength(1);
  });

  it('prepareHistoryUpsert：无冲突则写入并升序', () => {
    const r = prepareHistoryUpsert([pt('2026-10-05', 100)], pt('2026-10-04', 50));
    expect(r.ok).toBe(true);
    expect(r.history.map((h) => h.date)).toEqual(['2026-10-04', '2026-10-05']);
  });

  it('duplicateHistoryDates 检测重复日期', () => {
    expect(duplicateHistoryDates([pt('2026-10-05', 1), pt('2026-10-05', 2), pt('2026-10-04', 3)])).toEqual(['2026-10-05']);
  });
});

describe('周报生成 → Daily Snapshot 联动', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T10:00:00'));
    useAppStore.setState({
      hydrated: true,
      channels: defaultChannels(),
      history: [],
      reports: [],
      countdown: defaultCountdownData(),
      goalAchieved: { hasAchievedGoal: false },
      toasts: [],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('今天无 History：prepareWeeklySnapshot 无冲突', () => {
    const snap = useAppStore.getState().prepareWeeklySnapshot('2026-10-04');
    expect(snap.conflict).toBe(false);
    expect(snap.snapshot.source).toBe('weekly-report');
    expect(snap.snapshot.totalAmount).toBe(0);
  });

  it('commitWeeklySnapshot：写入后 History +1，一天一条', () => {
    const snap = useAppStore.getState().prepareWeeklySnapshot('2026-10-04');
    useAppStore.getState().commitWeeklySnapshot(snap.snapshot);
    expect(useAppStore.getState().history.filter((h) => h.date === '2026-10-04')).toHaveLength(1);
    expect(useAppStore.getState().history[0]!.source).toBe('weekly-report');
  });

  it('今天已有不同记录：conflict=true', () => {
    useAppStore.getState().overwriteHistoryPoint('2026-10-04', 999, 'manual');
    const snap = useAppStore.getState().prepareWeeklySnapshot('2026-10-04');
    expect(snap.conflict).toBe(true);
    expect(snap.existing?.totalAmount).toBe(999);
  });
});

describe('报告周期完整性检查（Period Integrity）', () => {
  function weekly(partial: Partial<FinancialReport>): FinancialReport {
    return {
      id: 'r', reportType: 'weekly', startDate: '2026-01-04', endDate: '2026-01-11',
      title: '2026年第2周周度财务报告', totalAmount: 100, changeAmount: 0, changePercentage: 0,
      channelDetails: [], isArchived: false, createdAt: '', ...partial,
    };
  }

  it('周报 start 非 Monday / end 非 Sunday → 报告 issue', () => {
    const issues = checkReportHealth([weekly({ periodKey: 'weekly:2026-W02', startDate: '2026-01-04', endDate: '2026-01-11' })]);
    expect(issues.some((i) => i.title.includes('周期非法'))).toBe(true);
  });

  it('周报 isoWeek 与 periodKey 冲突 → issue', () => {
    const issues = checkReportHealth([weekly({ periodKey: 'weekly:2026-W02', startDate: '2026-01-05', endDate: '2026-01-11', isoWeek: 1, weekNumber: 1 })]);
    expect(issues.some((i) => i.title.includes('isoWeek'))).toBe(true);
    expect(issues.some((i) => i.title.includes('weekNumber'))).toBe(true);
  });

  it('重复 periodKey → issue', () => {
    const a = weekly({ id: 'a', periodKey: 'weekly:2026-W02', startDate: '2026-01-05', endDate: '2026-01-11' });
    const b = weekly({ id: 'b', periodKey: 'weekly:2026-W02', startDate: '2026-01-05', endDate: '2026-01-11' });
    const issues = checkReportHealth([a, b]);
    expect(issues.some((i) => i.title.includes('重复周期'))).toBe(true);
  });

  it('正确 ISO 周期无 issue', () => {
    const issues = checkReportHealth([weekly({ periodKey: 'weekly:2026-W02', startDate: '2026-01-05', endDate: '2026-01-11', isoWeek: 2, weekNumber: 2, isoWeekYear: 2026 })]);
    expect(issues).toHaveLength(0);
  });
});
