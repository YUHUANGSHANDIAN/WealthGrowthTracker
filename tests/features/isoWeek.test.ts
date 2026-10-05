import { describe, it, expect } from 'vitest';
import {
  isoWeekOfDate,
  isoWeekRange,
  canonicalWeeklyPeriod,
  parseWeeklyPeriodKey,
  parseWeeklyTitle,
  resolveWeeklyIdentity,
} from '../../src/utils/isoWeek';
import { normalizeFinancialReport } from '../../src/features/reports/normalize';
import type { FinancialReport } from '../../src/types';

function weeklyReport(partial: Partial<FinancialReport>): FinancialReport {
  return {
    id: 'r',
    reportType: 'weekly',
    startDate: '2026-01-01',
    endDate: '2026-01-07',
    title: '2026年第1周周度财务报告',
    totalAmount: 100,
    changeAmount: 0,
    changePercentage: 0,
    channelDetails: [],
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('ISO 8601 Week Domain', () => {
  it('日期 → ISO 周（含 W01/W53/跨年）', () => {
    expect(isoWeekOfDate('2026-01-01')).toEqual({ isoWeekYear: 2026, isoWeek: 1 });
    expect(isoWeekOfDate('2026-01-04')).toEqual({ isoWeekYear: 2026, isoWeek: 1 });
    expect(isoWeekOfDate('2026-01-05')).toEqual({ isoWeekYear: 2026, isoWeek: 2 });
    expect(isoWeekOfDate('2026-12-31')).toEqual({ isoWeekYear: 2026, isoWeek: 53 });
    expect(isoWeekOfDate('2027-01-01')).toEqual({ isoWeekYear: 2026, isoWeek: 53 });
    expect(isoWeekOfDate('2027-01-04')).toEqual({ isoWeekYear: 2027, isoWeek: 1 });
  });

  it('ISO 周范围始终 Monday→Sunday，7 天', () => {
    const range = isoWeekRange(2026, 40);
    expect(range).toEqual({ startDate: '2026-09-28', endDate: '2026-10-04' });
    const start = new Date(range.startDate + 'T00:00:00Z');
    const end = new Date(range.endDate + 'T00:00:00Z');
    expect(start.getUTCDay()).toBe(1); // Monday
    expect(end.getUTCDay()).toBe(0); // Sunday
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(6);
  });

  it('canonicalWeeklyPeriod 生成唯一一致的周期元数据', () => {
    const c = canonicalWeeklyPeriod({ isoWeekYear: 2026, isoWeek: 40 });
    expect(c).toEqual({
      isoWeekYear: 2026,
      isoWeek: 40,
      periodKey: 'weekly:2026-W40',
      startDate: '2026-09-28',
      endDate: '2026-10-04',
      standardTitle: '2026年第40周周度财务报告',
    });
  });

  it('parseWeeklyPeriodKey / parseWeeklyTitle', () => {
    expect(parseWeeklyPeriodKey('weekly:2026-W40')).toEqual({ isoWeekYear: 2026, isoWeek: 40 });
    expect(parseWeeklyPeriodKey('weekly:2026-W2')).toEqual({ isoWeekYear: 2026, isoWeek: 2 });
    expect(parseWeeklyPeriodKey('monthly:2026-01')).toBeNull();
    expect(parseWeeklyPeriodKey('')).toBeNull();
    expect(parseWeeklyTitle('2026年第40周周度财务报告')).toEqual({ isoWeekYear: 2026, isoWeek: 40 });
    expect(parseWeeklyTitle('其它标题')).toBeNull();
  });

  it('resolveWeeklyIdentity 优先级：periodKey > isoWeek > title > date', () => {
    expect(resolveWeeklyIdentity({ periodKey: 'weekly:2026-W40', title: '2026年第39周周度财务报告', endDate: '2026-10-04' }))
      .toEqual({ isoWeekYear: 2026, isoWeek: 40 });
    expect(resolveWeeklyIdentity({ isoWeekYear: 2026, isoWeek: 30 })).toEqual({ isoWeekYear: 2026, isoWeek: 30 });
    expect(resolveWeeklyIdentity({ title: '2026年第31周周度财务报告' })).toEqual({ isoWeekYear: 2026, isoWeek: 31 });
    expect(resolveWeeklyIdentity({ endDate: '2026-01-11' })).toEqual({ isoWeekYear: 2026, isoWeek: 2 });
  });
});

describe('Legacy Weekly ISO 规范化（normalizeFinancialReport）', () => {
  it('W02 旧错误（Sunday→Sunday、weekNumber=1、isoWeek=2）→ 修复为 Monday→Sunday W02', () => {
    const report = weeklyReport({
      periodKey: 'weekly:2026-W02',
      startDate: '2026-01-04',
      endDate: '2026-01-11',
      weekNumber: 1,
      isoWeek: 2,
      isoWeekYear: 2026,
      title: '2026年第2周周度财务报告',
    });
    const n = normalizeFinancialReport(report);
    expect(n.startDate).toBe('2026-01-05');
    expect(n.endDate).toBe('2026-01-11');
    expect(n.weekNumber).toBe(2);
    expect(n.isoWeek).toBe(2);
    expect(n.isoWeekYear).toBe(2026);
    expect(n.standardTitle).toBe('2026年第2周周度财务报告');
    expect(n.periodKey).toBe('weekly:2026-W02');
  });

  it('W40 回归：title=第39周/weekNumber=39/isoWeek=40 → 全部修复为 W40', () => {
    const report = weeklyReport({
      periodKey: 'weekly:2026-W40',
      startDate: '2026-09-27',
      endDate: '2026-10-04',
      title: '2026年第39周周度财务报告',
      standardTitle: '2026年第39周周度财务报告',
      weekNumber: 39,
      isoWeek: 40,
      isoWeekYear: 2026,
      year: 2026,
    });
    const n = normalizeFinancialReport(report);
    expect(n.periodKey).toBe('weekly:2026-W40');
    expect(n.startDate).toBe('2026-09-28');
    expect(n.endDate).toBe('2026-10-04');
    expect(n.weekNumber).toBe(40);
    expect(n.isoWeek).toBe(40);
    expect(n.isoWeekYear).toBe(2026);
    expect(n.year).toBe(2026);
    expect(n.standardTitle).toBe('2026年第40周周度财务报告');
    expect(n.title).toBe('2026年第40周周度财务报告'); // auto 模式 title 也修正
  });

  it('Custom Title 保留，但 standardTitle 修正', () => {
    const report = weeklyReport({
      periodKey: 'weekly:2026-W40',
      startDate: '2026-09-28',
      endDate: '2026-10-04',
      titleMode: 'custom',
      customTitle: '国庆假期资产周报',
      title: '国庆假期资产周报',
      standardTitle: '2026年第39周周度财务报告',
      weekNumber: 39,
      isoWeek: 40,
      isoWeekYear: 2026,
    });
    const n = normalizeFinancialReport(report);
    expect(n.title).toBe('国庆假期资产周报'); // custom 保留
    expect(n.standardTitle).toBe('2026年第40周周度财务报告'); // standard 修正
    expect(n.isoWeek).toBe(40);
  });

  it('normalize 幂等：规范化两次结果不变', () => {
    const report = weeklyReport({
      periodKey: 'weekly:2026-W40',
      startDate: '2026-09-27',
      endDate: '2026-10-04',
      title: '2026年第39周周度财务报告',
      weekNumber: 39,
      isoWeek: 40,
      isoWeekYear: 2026,
    });
    const once = normalizeFinancialReport(report);
    const twice = normalizeFinancialReport(once);
    expect(twice).toEqual(once);
  });
});
