import { useMemo } from 'react';
import { CHART_INK } from './palette';
import { linearScale, formatMoneyTick, niceTicks } from './scales';

export interface StackedBarSegment {
  id?: string;
  name: string;
  color: string;
  value: number;
}

export interface StackedBarDatum {
  date: string;
  missing?: boolean;
  segments: StackedBarSegment[];
}

const W = 760;
const H = 320;
const M = { top: 16, right: 16, bottom: 40, left: 64 };

/** 堆叠柱状图（用于历史渠道构成随时间的演变）。 */
export function StackedBarChart({ data, ariaLabel = '堆叠柱状图', valueFormatter }: { data: StackedBarDatum[]; ariaLabel?: string; valueFormatter?: (v: number) => string }) {
  const fmt = valueFormatter ?? formatMoneyTick;
  const model = useMemo(() => {
    const maxTotal = Math.max(1, ...data.map(d => d.segments.reduce((a, s) => a + Math.max(0, s.value), 0)));
    const minTotal = Math.min(0, ...data.map(d => d.segments.reduce((a, s) => a + Math.min(0, s.value), 0)));
    const yScale = linearScale([minTotal, maxTotal], [H - M.bottom, M.top]);
    const times = data.map(d => Date.parse(d.date));
    const first = Math.min(...times);
    const last = Math.max(...times);
    const xScale = linearScale([first - 43_200_000, last + 43_200_000], [M.left, W - M.right]);
    const slot = (W - M.left - M.right) / Math.max(1, (last - first) / 86_400_000 + 1);
    const barW = Math.max(4, Math.min(40, slot * 0.7));
    const yTicks = niceTicks(minTotal, maxTotal, 4);
    return { yScale, xScale, barW, yTicks };
  }, [data]);

  return (
    <div role="group" aria-label={ariaLabel}>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
      {model.yTicks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={model.yScale(t)} y2={model.yScale(t)} stroke={CHART_INK.grid} strokeWidth={1} />
          <text x={M.left - 8} y={model.yScale(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={CHART_INK.muted} className="tabular">
            {fmt(t)}
          </text>
        </g>
      ))}
      {data.map((d) => {
        const x = model.xScale(Date.parse(d.date)) - model.barW / 2;
        let positive = 0;
        let negative = 0;
        const segs: React.ReactNode[] = [];
        for (const s of d.segments) {
          const start = s.value >= 0 ? positive : negative;
          const end = start + s.value;
          if (s.value >= 0) positive = end; else negative = end;
          const rectY = Math.min(model.yScale(start), model.yScale(end));
          const h = Math.abs(model.yScale(start) - model.yScale(end));
          segs.push(<rect key={s.id ?? s.name} x={x} y={rectY} width={model.barW} height={h} fill={s.color} opacity={0.85}><title>{d.date} · {s.name}：{fmt(s.value)}</title></rect>);
        }
        return (
          <g key={d.date}>
            {segs}
            {d.missing && <text x={x} y={model.yScale(0) - 6} fontSize={10} fill={CHART_INK.muted}>缺失</text>}
            {data.length <= 12 && (
              <text x={x + model.barW / 2} y={H - M.bottom + 16} textAnchor="middle" fontSize={10} fill={CHART_INK.muted}>
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
    <details className="mt-2"><summary className="cursor-pointer p-2">查看构成数据表</summary>
      <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">{ariaLabel}</caption>
        <thead><tr><th scope="col">日期</th><th scope="col">渠道</th><th scope="col">数值</th></tr></thead>
        <tbody>{data.flatMap(d => d.missing ? [<tr key={d.date}><td>{d.date}</td><td colSpan={2}>缺少快照或无法计算占比</td></tr>] :
          d.segments.map(s => <tr key={`${d.date}:${s.id ?? s.name}`}><td>{d.date}</td><th scope="row">{s.name}</th><td className="tabular-nums">{fmt(s.value)}</td></tr>))}</tbody>
      </table></div>
    </details></div>
  );
}
