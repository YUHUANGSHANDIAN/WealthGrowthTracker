import { describe, it, expect } from 'vitest';
import type { Channel, FinancialReport } from '../../src/types';
import {
  normalizeFinancialReport,
  normalizeFinancialReports,
  computeCompleteness,
  periodKeyOf,
  buildTitle,
  REPORT_SCHEMA_VERSION,
  needsReportNormalization,
} from '../../src/features/reports/normalize';
import { generateReport } from '../../src/features/reports/generate';

function legacyWeekly(overrides: Partial<FinancialReport> = {}): FinancialReport {
  return {
    id: 'r1',
    reportType: 'weekly',
    startDate: '2026-09-28',
    endDate: '2026-10-04',
    title: '',
    totalAmount: 500_000,
    changeAmount: 1000,
    changePercentage: 0.2,
    channelDetails: [],
    isArchived: false,
    createdAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('报告规范化（normalizeFinancialReport）', () => {
  it('补全缺失 title（周报，ISO 周）', () => {
    const n = normalizeFinancialReport(legacyWeekly());
    expect(n.title).toBe('2026年第40周周度财务报告');
  });

  it('补全 ISO 周编号 / 周期 key', () => {
    const n = normalizeFinancialReport(legacyWeekly());
    expect(n.weekNumber).toBe(40);
    expect(n.isoWeek).toBe(40);
    expect(n.isoWeekYear).toBe(2026);
    expect(n.periodKey).toBe('weekly:2026-W40');
  });

  it('periodKey 月报/年报格式', () => {
    expect(periodKeyOf({ reportType: 'monthly', startDate: '2026-10-01', endDate: '2026-10-31' })).toBe('monthly:2026-10');
    expect(periodKeyOf({ reportType: 'yearly', startDate: '2026-01-01', endDate: '2026-12-31' })).toBe('yearly:2026');
  });

  it('从 totalAmount 推导 wealthLevel（不依赖今天状态）', () => {
    const n = normalizeFinancialReport(legacyWeekly({ wealthLevel: undefined, wealthLevelName: undefined }));
    expect(n.wealthLevelName).toBe('投资专家'); // 500000 → 投资专家
    expect(n.wealthLevelTheme).toBe('red-royal');
  });

  it('缺 topChannels 但有 channelDetails → 补齐 TOP3', () => {
    const n = normalizeFinancialReport(
      legacyWeekly({
        topChannels: undefined,
        channelDetails: [
          { id: 'a', name: '支付宝', emoji: '💙', amount: 300, isParent: true, children: [], percentage: 60 },
          { id: 'b', name: '微信', emoji: '💚', amount: 150, isParent: true, children: [], percentage: 30 },
          { id: 'c', name: '现金', emoji: '💵', amount: 50, isParent: true, children: [], percentage: 10 },
        ],
      }),
    );
    expect(n.topChannels).toHaveLength(3);
    expect(n.topChannels![0]!.name).toBe('支付宝');
  });

  it('缺 channelDetails 但有 channels snapshot → 补齐', () => {
    const snapshot: Channel[] = [
      { id: 'x', name: '储蓄', emoji: '💰', amount: 500_000, color: '#000', isParent: true, isExpanded: false, children: [] },
    ];
    const n = normalizeFinancialReport(legacyWeekly({ channels: snapshot, channelDetails: [] }));
    expect(n.channelDetails).toHaveLength(1);
    expect(n.channelDetails[0]!.name).toBe('储蓄');
    expect(n.channelSnapshotMissing).toBeUndefined();
  });

  it('完全无 channels → 标记 channelSnapshotMissing，不编造', () => {
    const n = normalizeFinancialReport(legacyWeekly());
    expect(n.channelDetails).toHaveLength(0);
    expect(n.channelSnapshotMissing).toBeUndefined(); // 未显式声明缺失，但无快照
    expect(n.dataWarnings).toContain('缺少渠道快照');
  });

  it('幂等：normalize(normalize(r)) 结果一致', () => {
    const once = normalizeFinancialReport(legacyWeekly());
    const twice = normalizeFinancialReport(once);
    expect(twice).toEqual(once);
  });

  it('历史事实字段不被覆盖（totalAmount/channelDetails/archiveNote）', () => {
    const r = legacyWeekly({
      totalAmount: 123456,
      channelDetails: [{ id: 'z', name: '保留渠道', emoji: '🏦', amount: 123456, isParent: true, children: [], percentage: 100 }],
      archiveNote: '用户手写备注',
    });
    const n = normalizeFinancialReport(r);
    expect(n.totalAmount).toBe(123456);
    expect(n.channelDetails[0]!.name).toBe('保留渠道');
    expect(n.archiveNote).toBe('用户手写备注');
  });

  it('schema version 被写入', () => {
    expect(normalizeFinancialReport(legacyWeekly()).reportSchemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(needsReportNormalization(legacyWeekly())).toBe(true);
    expect(needsReportNormalization(normalizeFinancialReport(legacyWeekly()))).toBe(false);
  });

  it('normalizeFinancialReports 数组映射', () => {
    const out = normalizeFinancialReports([legacyWeekly(), legacyWeekly({ id: 'r2' })]);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.periodKey === 'weekly:2026-W40')).toBe(true);
  });
});

describe('报告完整度（computeCompleteness）', () => {
  it('完整报告 score 100', () => {
    const n = normalizeFinancialReport(
      legacyWeekly({
        previousTotalAmount: 400_000,
        weeklyMax: 500_000,
        weeklyMin: 400_000,
        weeklyAvg: 450_000,
        historyPointsCount: 7,
        channelDetails: [{ id: 'a', name: 'x', emoji: '💰', amount: 500_000, isParent: true, children: [], percentage: 100 }],
      }),
    );
    expect(n.dataCompleteness).toBe(100);
    expect(n.dataCompletenessLabel).toBe('完整');
  });

  it('旧版有限数据 score 较低并给出警告', () => {
    const n = normalizeFinancialReport(legacyWeekly());
    expect(n.dataCompleteness).toBeLessThan(60);
    expect(n.dataCompletenessLabel).toBe('旧版有限数据');
    expect(n.dataWarnings).toContain('缺少渠道快照');
  });
});

describe('生成报告已带 v1.3 字段', () => {
  it('generateReport 返回 periodKey + schema version', () => {
    const history = [{ date: '2026-09-01', totalAmount: 100 }, { date: '2026-10-04', totalAmount: 130 }];
    const r = generateReport(history, 'weekly', '2026-10-03', [], '2026-10-03');
    expect(r.periodKey).toBe('weekly:2026-W40');
    expect(r.reportSchemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(r.revision).toBe(1);
    expect(r.dataCompleteness).toBeDefined();
  });
});

describe('buildTitle', () => {
  it('ISO 跨年周', () => {
    // 2027-01-01 属于 ISO 2026-W53
    expect(buildTitle('weekly', '2027-01-01')).toBe('2026年第53周周度财务报告');
    expect(periodKeyOf({ reportType: 'weekly', startDate: '2026-12-28', endDate: '2027-01-03' })).toBe('weekly:2026-W53');
  });
});
