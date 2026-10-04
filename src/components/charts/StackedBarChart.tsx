import { useMemo } from 'react';
import { CHART_INK } from './palette';
import { linearScale, formatMoneyTick, niceTicks } from './scales';

export interface StackedBarSegment {
  name: string;
  color: string;
  value: number;
}

export interface StackedBarDatum {
  date: string;
  segments: StackedBarSegment[];
}

const W = 760;
const H = 320;
const M = { top: 16, right: 16, bottom: 40, left: 64 };

/** 堆叠柱状图（用于历史渠道构成随时间的演变）。 */
export function StackedBarChart({ data, ariaLabel = '堆叠柱状图' }: { data: StackedBarDatum[]; ariaLabel?: string }) {
  const model = useMemo(() => {
    const totals = data.map((d) => d.segments.reduce((a, s) => a + s.value, 0));
    const maxTotal = Math.max(1, ...totals);
    const yScale = linearScale([0, maxTotal], [H - M.bottom, M.top]);
    const n = data.length;
    const slot = n > 0 ? (W - M.left - M.right) / n : 0;
    const barW = Math.max(4, Math.min(40, slot * 0.7));
    const yTicks = niceTicks(0, maxTotal, 4);
    return { maxTotal, yScale, slot, barW, yTicks };
  }, [data]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
      {model.yTicks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={model.yScale(t)} y2={model.yScale(t)} stroke={CHART_INK.grid} strokeWidth={1} />
          <text x={M.left - 8} y={model.yScale(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={CHART_INK.muted} className="tabular">
            {formatMoneyTick(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = M.left + i * model.slot + (model.slot - model.barW) / 2;
        let y = H - M.bottom;
        const segs: React.ReactNode[] = [];
        for (const s of d.segments) {
          const h = model.yScale(0) - model.yScale(s.value);
          const rectY = y - h;
          segs.push(<rect key={s.name} x={x} y={rectY} width={model.barW} height={h} fill={s.color} opacity={0.85} />);
          y = rectY;
        }
        return (
          <g key={d.date}>
            {segs}
            {data.length <= 12 && (
              <text x={x + model.barW / 2} y={H - M.bottom + 16} textAnchor="middle" fontSize={10} fill={CHART_INK.muted}>
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
