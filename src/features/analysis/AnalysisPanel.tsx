import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { channelAmount, totalAssets } from '../../utils/channels';
import { addDays, todayString } from '../../utils/date';
import { Card, EmptyState, Badge } from '../../components/ui/primitives';
import { LineChart } from '../../components/charts/LineChart';
import { BarChart } from '../../components/charts/BarChart';
import { RadarChart } from '../../components/charts/RadarChart';
import { BRAND, CATEGORICAL_SERIES } from '../../components/charts/palette';
import { analyzeDimensions } from '../prediction/models';

const RANGES = [
  { value: 'all', label: '全部' },
  { value: '30', label: '近30天' },
  { value: '90', label: '近90天' },
  { value: '365', label: '近一年' },
];

export function AnalysisPanel() {
  const channels = useAppStore((s) => s.channels);
  const history = useAppStore((s) => s.history);
  const [range, setRange] = useState('all');

  const total = totalAssets(channels);

  const filteredHistory = useMemo(() => {
    const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (range === 'all') return sorted;
    const days = Number(range);
    const start = addDays(todayString(), -days);
    return sorted.filter((p) => p.date >= start);
  }, [history, range]);

  const trendSeries = useMemo(
    () => [
      {
        id: 'total',
        name: '总资产',
        color: BRAND,
        points: filteredHistory.map((p) => ({ date: p.date, value: p.totalAmount })),
        area: true,
      },
    ],
    [filteredHistory],
  );

  const comparisonItems = useMemo(() => {
    const items: { id: string; label: string; value: number; color: string; emoji: string; hint: string }[] = [];
    for (const c of channels) {
      if (c.isParent && c.children && c.children.length > 0) {
        for (const s of c.children) {
          items.push({
            id: s.id,
            label: `${c.name} · ${s.name}`,
            value: s.amount,
            color: s.color,
            emoji: s.emoji,
            hint: total > 0 ? `${((s.amount / total) * 100).toFixed(1)}%` : '0%',
          });
        }
      } else {
        items.push({
          id: c.id,
          label: c.name,
          value: channelAmount(c),
          color: c.color,
          emoji: c.emoji,
          hint: total > 0 ? `${((channelAmount(c) / total) * 100).toFixed(1)}%` : '0%',
        });
      }
    }
    return items.sort((a, b) => b.value - a.value);
  }, [channels, total]);

  const radarAxes = useMemo(() => analyzeDimensions(history), [history]);
  const radarColors = CATEGORICAL_SERIES;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-slate-800">资产趋势</h2>
          <div className="flex gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                aria-pressed={range === r.value}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                  range === r.value ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {filteredHistory.length > 0 ? (
          <LineChart series={trendSeries} ariaLabel="资产趋势图" />
        ) : (
          <EmptyState icon="📈" title="暂无趋势数据" />
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-3">渠道对比</h2>
        {comparisonItems.length > 0 ? (
          <BarChart items={comparisonItems} ariaLabel="渠道资产对比" />
        ) : (
          <EmptyState icon="🏦" title="暂无渠道数据" />
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">财富成长雷达</h2>
          <Badge tone="purple">增长趋势 · 稳定性 · 预测准确性</Badge>
        </div>
        {history.length >= 2 ? (
          <RadarChart axes={radarAxes.map((a, i) => ({ ...a, color: radarColors[i] ?? BRAND }))} ariaLabel="财富成长雷达图" />
        ) : (
          <EmptyState icon="🎯" title="数据不足" description="至少需要两条历史数据才能生成雷达图。" />
        )}
      </Card>
    </div>
  );
}
