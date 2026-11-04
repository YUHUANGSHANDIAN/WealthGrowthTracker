import { describe, expect, it } from 'vitest';
import type { Channel, HistoryPoint } from '../../src/types';
import {
  buildAssetTrend,
  buildChangeExplanation,
  buildChannelComposition,
  downsamplePreservingExtremes,
} from '../../src/domain/analysis/assetTrends';
import { emptyAssetClassificationState } from '../../src/domain/assets/classification';
import { emptyMonthlyPlanningState } from '../../src/services/monthlyPlanning/storage';

function channel(id: string, name: string, amount: number, children?: Channel['children']): Channel {
  return { id, name, emoji: '💰', amount, color: '#123456', isParent: true, isExpanded: false, children };
}

const channels = [
  channel('a', '支付宝', 0, [
    { id: 'fund', name: '基金', emoji: '📊', amount: 120, color: '#3b82f6', parentId: 'a' },
    { id: 'gold', name: '银行黄金', emoji: '🏦', amount: 50, color: '#d97706', parentId: 'a' },
  ]),
];

const history: HistoryPoint[] = [
  { date: '2026-01-01', totalAmount: 100, channels: [channel('a', '支付宝', 100, [{ id: 'fund', name: '基金', emoji: '📊', amount: 100, color: '#3b82f6', parentId: 'a' }])] },
  { date: '2026-01-02', totalAmount: 110, channels: [channel('a', '支付宝', 110, [{ id: 'fund', name: '基金', emoji: '📊', amount: 110, color: '#3b82f6', parentId: 'a' }])] },
  { date: '2026-01-20', totalAmount: 90, channels: [channel('a', '支付宝', 90, [{ id: 'fund', name: '基金', emoji: '📊', amount: 90, color: '#3b82f6', parentId: 'a' }])] },
  { date: '2026-02-03', totalAmount: 120, channels: [channel('a', '支付宝', 120, [{ id: 'fund', name: '基金', emoji: '📊', amount: 120, color: '#3b82f6', parentId: 'a' }])] },
];

describe('资产历史趋势计算', () => {
  it('KPI 与曲线使用同一历史终点，不混入当前实时余额', () => {
    const trend = buildAssetTrend({
      history, channels: [channel('a', '支付宝', 999)], startDate: '2026-01-01', endDate: '2026-01-20',
      granularity: 'raw', today: '2026-02-04',
    });
    expect(trend.kpis.startValue).toBe(100);
    expect(trend.kpis.endValue).toBe(90);
    expect(trend.kpis.endDate).toBe('2026-01-20');
    expect(trend.kpis.liveValue).toBeNull();
    expect(trend.kpis.change).toBe(-10);
  });

  it('实时值只在显式启用时单独返回', () => {
    const trend = buildAssetTrend({
      history, channels: [channel('a', '支付宝', 999)], startDate: '2026-02-01', endDate: '2026-02-04',
      granularity: 'raw', includeLive: true, today: '2026-02-04',
    });
    expect(trend.kpis.endValue).toBe(120);
    expect(trend.kpis.endDate).toBe('2026-02-03');
    expect(trend.kpis.liveValue).toBe(999);
    expect(trend.kpis.liveDate).toBe('2026-02-04');
  });

  it('原始缺口不补值，周/月聚合保留真实观察日', () => {
    const raw = buildAssetTrend({ history, channels, startDate: '2026-01-01', endDate: '2026-02-03', granularity: 'raw' });
    expect(raw.points.filter((point) => point.value === null).length).toBe(2);
    const monthly = buildAssetTrend({ history, channels, startDate: '2026-01-01', endDate: '2026-02-03', granularity: 'monthly' });
    expect(monthly.points.filter((point) => point.value !== null).map((point) => point.observedAt)).toEqual(['2026-01-20', '2026-02-03']);
  });

  it('跨年周使用 ISO 周起点但保留观察日', () => {
    const weekly = buildAssetTrend({
      history: [
        { date: '2021-01-01', totalAmount: 100 },
        { date: '2021-01-04', totalAmount: 110 },
      ],
      channels, startDate: '2021-01-01', endDate: '2021-01-04', granularity: 'weekly',
    });
    expect(weekly.points.filter((point) => point.value !== null).map((point) => point.bucketStart)).toEqual(['2020-12-28', '2021-01-04']);
    expect(weekly.points.filter((point) => point.value !== null).map((point) => point.observedAt)).toEqual(['2021-01-01', '2021-01-04']);
  });

  it('区间外基线显式标记', () => {
    const trend = buildAssetTrend({
      history, channels, startDate: '2026-01-10', endDate: '2026-02-03', granularity: 'raw', baselineMode: 'previous',
    });
    expect(trend.kpis.startDate).toBe('2026-01-02');
    expect(trend.kpis.baselineOutsideRange).toBe(true);
    expect(trend.kpis.change).toBe(10);
  });

  it('0 起点变化率不可计算', () => {
    const trend = buildAssetTrend({
      history: [{ date: '2026-01-01', totalAmount: 0 }, { date: '2026-01-02', totalAmount: 10 }],
      channels, startDate: '2026-01-01', endDate: '2026-01-02', granularity: 'raw',
    });
    expect(trend.kpis.changeRate).toBeNull();
  });

  it('负资产保留原始差值和不可计算边界', () => {
    const trend = buildAssetTrend({
      history: [{ date: '2026-01-01', totalAmount: -100 }, { date: '2026-01-02', totalAmount: -80 }],
      channels, startDate: '2026-01-01', endDate: '2026-01-02', granularity: 'raw',
    });
    expect(trend.kpis.startValue).toBe(-100);
    expect(trend.kpis.endValue).toBe(-80);
    expect(trend.kpis.change).toBe(20);
    expect(trend.kpis.changeRate).toBe(20);
  });

  it('缺失渠道为未知而非 0，重命名保持稳定 ID', () => {
    const renamed: HistoryPoint[] = [
      { date: '2026-01-01', totalAmount: 100, channels: [channel('a', '支付宝', 0, [{ id: 'gold', name: '黄金', emoji: '🥇', amount: 100, color: '#d97706', parentId: 'a' }])] },
      { date: '2026-01-02', totalAmount: 120, channels: [channel('a', '支付宝', 0, [{ id: 'gold', name: '银行黄金', emoji: '🏦', amount: 120, color: '#d97706', parentId: 'a' }])] },
    ];
    const view = buildChannelComposition({
      history: renamed, classifications: emptyAssetClassificationState(), startDate: '2026-01-01', endDate: '2026-01-02',
      level: 'leaf', parentChannelId: 'a', topN: 5, mode: 'absolute', labelMode: 'as-recorded',
    });
    expect(view.series[0]?.id).toBe('leaf:gold');
    expect(view.points[0]?.segments[0]?.recordedName).toBe('黄金');
    expect(view.points[1]?.segments[0]?.recordedName).toBe('银行黄金');
    const missing: HistoryPoint = {
      date: '2026-01-03', totalAmount: 120,
      channels: [channel('a', '支付宝', 0, [{ id: 'fund', name: '基金', emoji: '📊', amount: 120, color: '#3b82f6', parentId: 'a' }])],
    };
    const withMissing = buildChannelComposition({
      history: [...renamed, missing], classifications: emptyAssetClassificationState(), startDate: '2026-01-01', endDate: '2026-01-03',
      level: 'leaf', parentChannelId: 'a', topN: 5, mode: 'absolute', labelMode: 'as-recorded',
    });
    expect(withMissing.points[2]?.segments.find((segment) => segment.id === 'leaf:gold')?.value).toBeNull();
  });

  it('变动解读不把余额变化冒充投资收益', () => {
    const result = buildChangeExplanation({
      history, classifications: emptyAssetClassificationState(), reports: [], planning: emptyMonthlyPlanningState(),
      startDate: '2026-01-01', endDate: '2026-02-03',
    });
    expect(result.totalChange).toBe(20);
    expect(result.cashFlows).toEqual([]);
    expect(result.interpretation).toContain('不能解释为净投入或投资收益');
  });

  it('降采样保留非空极值并限制点数', () => {
    const points = Array.from({ length: 5_000 }, (_, index) => ({
      bucketStart: `2020-01-${String((index % 28) + 1).padStart(2, '0')}`,
      observedAt: `2020-01-${String((index % 28) + 1).padStart(2, '0')}`,
      value: index === 2_500 ? 1_000_000_000 : index,
      coverage: 'reconciled' as const,
    }));
    const sampled = downsamplePreservingExtremes(points, 1_000);
    expect(sampled.length).toBeLessThanOrEqual(1_000);
    expect(sampled.some((point) => point.value === 1_000_000_000)).toBe(true);
  });
});
