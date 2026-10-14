import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FinancialReport, HistoryPoint } from '../../src/types';
import { diffReportFields, buildManualEditAudit } from '../../src/utils/reportEdit';
import { buildMaintenanceActions } from '../../src/utils/maintenance';
import { useAppStore } from '../../src/store/appStore';
import { defaultChannels, defaultCountdownData } from '../../src/constants/defaults';

function weekly(partial: Partial<FinancialReport>): FinancialReport {
  return {
    id: 'r1', reportType: 'weekly', startDate: '2026-10-05', endDate: '2026-10-11',
    title: '2026年第41周周度财务报告', totalAmount: 100, changeAmount: 0, changePercentage: 0,
    channelDetails: [], isArchived: false, createdAt: '2026-10-05T00:00:00.000Z', periodKey: 'weekly:2026-W41',
    isoWeek: 41, isoWeekYear: 2026, weekNumber: 41, year: 2026, ...partial,
  };
}

describe('Advanced Report Editor 纯函数', () => {
  it('diffReportFields 检测字段差异', () => {
    const a = weekly({ totalAmount: 100 });
    const b = weekly({ totalAmount: 150 });
    const diffs = diffReportFields(a, b);
    expect(diffs.some((d) => d.field === 'totalAmount' && d.oldValue === 100 && d.newValue === 150)).toBe(true);
  });

  it('buildManualEditAudit 生成 manual-repair 审计', () => {
    const a = weekly({ totalAmount: 100 });
    const b = weekly({ totalAmount: 150, title: '新标题' });
    const audit = buildManualEditAudit(a, b, '修正总资产');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((x) => x.source === 'manual-repair')).toBe(true);
    expect(audit[0]!.reason).toBe('修正总资产');
  });

  it('无差异时审计为空', () => {
    const a = weekly({});
    expect(buildManualEditAudit(a, weekly({}), 'x')).toHaveLength(0);
  });
});

describe('Maintenance Action Engine', () => {
  it('无问题 → 无 Action', () => {
    const actions = buildMaintenanceActions({ reports: [], history: [], channels: [] });
    expect(actions).toHaveLength(0);
  });

  it('ISO 周期错误 → iso-repair', () => {
    const actions = buildMaintenanceActions({
      reports: [weekly({ periodKey: 'weekly:2026-W02', startDate: '2026-01-04', endDate: '2026-01-11' })],
      history: [],
      channels: [],
    });
    expect(actions.some((a) => a.id === 'iso-repair')).toBe(true);
  });

  it('重复历史日期 → dup-history', () => {
    const history: HistoryPoint[] = [{ date: '2026-10-05', totalAmount: 1 }, { date: '2026-10-05', totalAmount: 2 }];
    const actions = buildMaintenanceActions({ reports: [], history, channels: [] });
    expect(actions.some((a) => a.id === 'dup-history')).toBe(true);
  });

  it('缺失月报 → missing-monthly', () => {
    const history: HistoryPoint[] = [{ date: '2026-03-15', totalAmount: 1000 }];
    const actions = buildMaintenanceActions({ reports: [], history, channels: [] });
    expect(actions.some((a) => a.id === 'missing-monthly')).toBe(true);
  });
});

describe('commitReportEdit（store）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    useAppStore.setState({
      hydrated: true,
      channels: defaultChannels(),
      history: [{ date: '2026-10-05', totalAmount: 100 }],
      reports: [weekly({})],
      countdown: defaultCountdownData(),
      goalAchieved: { hasAchievedGoal: false },
      toasts: [],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('编辑报告：写入审计 + revision 保留', async () => {
    const original = useAppStore.getState().reports[0]!;
    const edited = { ...original, totalAmount: 200 };
    const audit = buildManualEditAudit(original, edited, '修正');
    const r = await useAppStore.getState().commitReportEdit(original.id, edited, audit);
    const stored = useAppStore.getState().reports.find((x) => x.id === original.id)!;
    expect(stored.totalAmount).toBe(200);
    expect(stored.repairAudit?.length).toBeGreaterThan(0);
    expect(stored.repairAudit!.some((a) => a.source === 'manual-repair')).toBe(true);
    expect(r.reportSchemaVersion).toBe(5);
  });

  it('编辑报告 + 同步 History：更新 dataAsOf 对应记录', async () => {
    const original = useAppStore.getState().reports[0]!;
    const edited = { ...original, totalAmount: 300, dataAsOf: '2026-10-05' };
    const audit = buildManualEditAudit(original, edited, '修正');
    await useAppStore.getState().commitReportEdit(original.id, edited, audit, { syncHistory: true });
    const h = useAppStore.getState().history.find((x) => x.date === '2026-10-05')!;
    expect(h.totalAmount).toBe(300);
    expect(useAppStore.getState().history.filter((x) => x.date === '2026-10-05')).toHaveLength(1);
  });
});
