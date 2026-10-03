import React, { useMemo, useRef, useState } from 'react';
import { linearScale, niceTicks, formatMoneyTick } from './scales';
import { CHART_INK } from './palette';

export interface LineSeries {
  id: string;
  name: string;
  color: string;
  points: { date: string; value: number }[];
  dashed?: boolean;
  area?: boolean;
}

const W = 720;
const H = 320;
const M = { top: 16, right: 16, bottom: 34, left: 60 };

interface TooltipData {
  x: number;
  y: number;
  date: string;
  values: { id: string; name: string; color: string; value: number | null }[];
}

export function LineChart({
  series,
  valueFormatter = (v) => `¥${v.toFixed(2)}`,
  ariaLabel = '折线图',
}: {
  series: LineSeries[];
  valueFormatter?: (v: number) => string;
  ariaLabel?: string;
}) {
  const [tip, setTip] = useState<TooltipData | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { allDates, xScale, yScale, yTicks, xTickIndices, validSeries } = useMemo(() => {
    const dates = new Set<string>();
    for (const s of series) for (const p of s.points) dates.add(p.date);
    const allDates = [...dates].sort();

    const values = series.flatMap((s) => s.points.map((p) => p.value));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    const yScale = linearScale([min - pad, max + pad], [H - M.bottom, M.top]);
    const xScale = linearScale(
      [0, Math.max(1, allDates.length - 1)],
      [M.left, W - M.right],
    );
    const yTicks = niceTicks(min - pad, max + pad, 5);
    // x 刻度：最多 6 个均匀分布的日期下标
    const tickCount = Math.min(6, allDates.length);
    const xTickIndices = Array.from({ length: tickCount }, (_, i) =>
      Math.round((i / (tickCount - 1 || 1)) * (allDates.length - 1)),
    );

    const validSeries = series
      .map((s) => {
        const byDate = new Map(s.points.map((p) => [p.date, p.value]));
        const pts = allDates
          .map((d, i) => {
            const v = byDate.get(d);
            return v === undefined ? null : { x: xScale(i), y: yScale(v), date: d, value: v };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);
        return { ...s, plotted: pts };
      })
      .filter((s) => s.plotted.length > 0);

    return { allDates, xScale, yScale, yTicks, xTickIndices, validSeries };
  }, [series]);

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(
      ((px - M.left) / (W - M.left - M.right)) * Math.max(0, allDates.length - 1),
    );
    const clamped = Math.max(0, Math.min(allDates.length - 1, idx));
    const date = allDates[clamped] ?? allDates[allDates.length - 1] ?? '';
    const values = validSeries.map((s) => {
      const p = s.plotted.find((q) => q.date === date);
      return { id: s.id, name: s.name, color: s.color, value: p ? p.value : null };
    });
    setTip({
      x: xScale(clamped),
      y: Math.max(M.top, Math.min(H - M.bottom, e.clientY - rect.top)),
      date,
      values,
    });
  }

  return (
    <div className="relative" role="img" aria-label={ariaLabel}>
      {validSeries.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 px-1">
          {validSeries.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className="inline-block w-3 h-0.5 rounded"
                style={{ background: s.color }}
                aria-hidden
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        onMouseLeave={() => setTip(null)}
      >
        {/* 网格与 y 轴刻度 */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={yScale(t)}
              y2={yScale(t)}
              stroke={CHART_INK.grid}
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={yScale(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill={CHART_INK.muted}
              className="tabular"
            >
              {formatMoneyTick(t)}
            </text>
          </g>
        ))}

        {/* x 轴刻度 */}
        {xTickIndices.map((i) => (
          <text
            key={i}
            x={xScale(i)}
            y={H - M.bottom + 18}
            textAnchor="middle"
            fontSize={11}
            fill={CHART_INK.muted}
            className="tabular"
          >
            {allDates[i]?.slice(5)}
          </text>
        ))}

        {/* 系列折线 */}
        {validSeries.map((s) => {
          const d = s.plotted.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
          const areaD = s.area
            ? `${d} L${s.plotted[s.plotted.length - 1]!.x},${yScale(0)} L${s.plotted[0]!.x},${yScale(0)} Z`
            : undefined;
          return (
            <g key={s.id}>
              {areaD && (
                <path d={areaD} fill={s.color} opacity={0.08} stroke="none" />
              )}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '5 4' : undefined}
              />
            </g>
          );
        })}

        {/* 悬停十字线 */}
        {tip && (
          <g>
            <line
              x1={tip.x}
              x2={tip.x}
              y1={M.top}
              y2={H - M.bottom}
              stroke={CHART_INK.axis}
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            {tip.values.map((v) => {
              if (v.value === null) return null;
              return (
                <circle
                  key={v.id}
                  cx={tip.x}
                  cy={yScale(v.value)}
                  r={4}
                  fill={v.color}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        )}

        {/* 透明捕获层 */}
        <rect
          x={M.left}
          y={M.top}
          width={W - M.left - M.right}
          height={H - M.top - M.bottom}
          fill="transparent"
          onMouseMove={onMove}
        />
      </svg>

      {tip && (
        <div
          className="absolute z-10 pointer-events-none bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs"
          style={{
            left: `${(tip.x / W) * 100}%`,
            top: tip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="text-slate-400 tabular mb-1">{tip.date}</div>
          {tip.values.map((v) => (
            <div key={v.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full" style={{ background: v.color }} aria-hidden />
              <span className="text-slate-500">{v.name}</span>
              <span className="font-medium text-slate-700 tabular">
                {v.value === null ? '—' : valueFormatter(v.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
