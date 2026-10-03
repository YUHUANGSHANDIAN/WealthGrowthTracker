import { useMemo, useRef, useState } from 'react';
import { linearScale, niceTicks, formatMoneyTick, timeTicks, daysBetweenDates } from './scales';
import { CHART_INK } from './palette';

export interface LineChartPoint {
  date: string;
  value: number;
  lower?: number;
  upper?: number;
}

export interface LineSeries {
  id: string;
  name: string;
  color: string;
  points: LineChartPoint[];
  dashed?: boolean;
  area?: boolean;
  showDots?: boolean;
  /** 是否绘制 lower/upper 预测带。 */
  band?: boolean;
  bandColor?: string;
  /** 线宽（默认 2）。 */
  strokeWidth?: number;
}

export interface ReferenceLine {
  value: number;
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface VerticalMarker {
  date: string;
  label?: string;
  color?: string;
}

const W = 760;
const H = 340;
const M = { top: 18, right: 20, bottom: 40, left: 64 };

interface TooltipData {
  px: number;
  py: number;
  date: string;
  rows: { id: string; name: string; color: string; value: number | null; delta: number | null; lower?: number | null; upper?: number | null }[];
}

export function LineChart({
  series,
  valueFormatter = (v) => `¥${v.toFixed(2)}`,
  ariaLabel = '折线图',
  referenceLines = [],
  verticalMarkers = [],
}: {
  series: LineSeries[];
  valueFormatter?: (v: number) => string;
  ariaLabel?: string;
  referenceLines?: ReferenceLine[];
  verticalMarkers?: VerticalMarker[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<TooltipData | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const model = useMemo(() => {
    const dateSet = new Set<string>();
    for (const s of series) for (const p of s.points) dateSet.add(p.date);
    const allDates = [...dateSet].sort();
    const minDate = allDates[0] ?? '';
    const maxDate = allDates[allDates.length - 1] ?? '';
    const spanDays = allDates.length > 1 ? daysBetweenDates(minDate, maxDate) : 0;

    const elapsedOf = (date: string) => daysBetweenDates(minDate, date);
    const xScale =
      spanDays > 0
        ? linearScale([0, spanDays], [M.left, W - M.right])
        : (_e: number) => (W - M.left - M.right) / 2 + M.left;

    // 单日退化为索引位置
    let values: number[] = [];
    for (const s of series) {
      for (const p of s.points) {
        values.push(p.value);
        if (p.lower !== undefined) values.push(p.lower);
        if (p.upper !== undefined) values.push(p.upper);
      }
    }
    let min = Math.min(...values, ...referenceLines.map((r) => r.value));
    let max = Math.max(...values, ...referenceLines.map((r) => r.value));
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    if (min === max) {
      min -= Math.max(1, Math.abs(min) * 0.1);
      max += Math.max(1, Math.abs(max) * 0.1);
    }
    const pad = (max - min) * 0.08;
    const yScale = linearScale([min - pad, max + pad], [H - M.bottom, M.top]);
    const yTicks = niceTicks(min - pad, max + pad, 5);

    const xTicks = spanDays > 0 ? timeTicks(minDate, maxDate, 7) : [];

    // 每系列 → 绘图坐标
    const plotted = series.map((s) => {
      if (spanDays > 0) {
        return {
          ...s,
          pts: s.points
            .map((p) => {
              const e = elapsedOf(p.date);
              return {
                date: p.date,
                x: xScale(e),
                y: yScale(p.value),
                value: p.value,
                lower: p.lower !== undefined ? yScale(p.lower) : undefined,
                upper: p.upper !== undefined ? yScale(p.upper) : undefined,
              };
            })
            .filter((p) => Number.isFinite(p.y)),
        };
      }
      // 单日退化：按索引均匀展开
      const n = s.points.length || 1;
      return {
        ...s,
        pts: s.points.map((p, i) => ({
          date: p.date,
          x: M.left + ((i + 0.5) / n) * (W - M.left - M.right),
          y: yScale(p.value),
          value: p.value,
          lower: p.lower !== undefined ? yScale(p.lower) : undefined,
          upper: p.upper !== undefined ? yScale(p.upper) : undefined,
        })),
      };
    });

    // 十字光标最近日期索引（elapsed 排序）
    const allElapsed = [...dateSet]
      .map((d) => ({ date: d, e: elapsedOf(d) }))
      .sort((a, b) => a.e - b.e);

    return { allDates, minDate, maxDate, spanDays, xScale, yScale, yTicks, xTicks, plotted, allElapsed };
  }, [series, referenceLines]);

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;

    // 找最近的日期
    let nearest = model.allElapsed[0];
    let best = Infinity;
    for (const item of model.allElapsed) {
      const x = model.spanDays > 0 ? model.xScale(item.e) : (M.left + (W - M.left) / 2);
      const d = Math.abs(x - px);
      if (d < best) {
        best = d;
        nearest = item;
      }
    }
    if (!nearest) return;

    const rows = model.plotted
      .filter((s) => !hidden.has(s.id))
      .map((s) => {
        const sorted = [...s.pts].sort((a, b) => (a.date < b.date ? -1 : 1));
        const idx = sorted.findIndex((p) => p.date === nearest.date);
        if (idx < 0) return { id: s.id, name: s.name, color: s.color, value: null, delta: null };
        const cur = sorted[idx]!;
        const prev = idx > 0 ? sorted[idx - 1]! : null;
        return {
          id: s.id,
          name: s.name,
          color: s.color,
          value: cur.value,
          lower: cur.lower !== undefined ? cur.lower : undefined,
          upper: cur.upper !== undefined ? cur.upper : undefined,
          delta: prev ? cur.value - prev.value : null,
        };
      });

    setTip({ px, py, date: nearest.date, rows });
  }

  function toggle(id: string) {
    setHidden((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleSeries = model.plotted.filter((s) => !hidden.has(s.id));

  return (
    <div className="relative" role="img" aria-label={ariaLabel}>
      {model.plotted.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 px-1">
          {model.plotted.map((s) => (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              className={`inline-flex items-center gap-1.5 text-xs rounded px-1 py-0.5 transition-opacity ${hidden.has(s.id) ? 'opacity-40' : ''}`}
              aria-pressed={!hidden.has(s.id)}
              title={hidden.has(s.id) ? '点击显示' : '点击隐藏'}
            >
              <span className="inline-block w-3 h-0.5 rounded" style={{ background: s.color }} aria-hidden />
              {s.name}
            </button>
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
        {model.yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={model.yScale(t)} y2={model.yScale(t)} stroke={CHART_INK.grid} strokeWidth={1} />
            <text x={M.left - 8} y={model.yScale(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={CHART_INK.muted} className="tabular">
              {formatMoneyTick(t)}
            </text>
          </g>
        ))}

        {/* 时间轴刻度 */}
        {model.xTicks.map((tk) => (
          <text key={tk.t} x={model.xScale(tk.t)} y={H - M.bottom + 18} textAnchor="middle" fontSize={11} fill={CHART_INK.muted} className="tabular">
            {tk.label}
          </text>
        ))}

        {/* 水平参考线（如目标金额） */}
        {referenceLines.map((r, i) => (
          <g key={i}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={model.yScale(r.value)}
              y2={model.yScale(r.value)}
              stroke={r.color ?? '#e34948'}
              strokeWidth={1.2}
              strokeDasharray={r.dashed === false ? undefined : '5 4'}
            />
            {r.label && (
              <text x={W - M.right - 4} y={model.yScale(r.value) - 5} textAnchor="end" fontSize={11} fill={r.color ?? '#e34948'}>
                {r.label}
              </text>
            )}
          </g>
        ))}

        {/* 垂直标记（预测起点等） */}
        {verticalMarkers.map((vm, i) => {
          const e = daysBetweenDates(model.minDate, vm.date);
          const x = model.spanDays > 0 ? model.xScale(e) : model.xScale(0);
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={M.top} y2={H - M.bottom} stroke={vm.color ?? '#898781'} strokeWidth={1} strokeDasharray="4 4" />
              {vm.label && (
                <text x={x + 4} y={M.top + 12} fontSize={11} fill={vm.color ?? '#898781'}>
                  {vm.label}
                </text>
              )}
            </g>
          );
        })}

        {/* 系列 */}
        {visibleSeries.map((s) => {
          const pts = s.pts;
          if (pts.length === 0) return null;

          // 预测带
          if (s.band && pts.some((p) => p.lower !== undefined || p.upper !== undefined)) {
            const bandPath = buildBandPath(pts);
            if (bandPath) {
              return (
                <g key={s.id}>
                  <path d={bandPath} fill={s.bandColor ?? s.color} opacity={0.14} stroke="none" />
                  <path d={linePath(pts)} fill="none" stroke={s.color} strokeWidth={s.strokeWidth ?? 2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
                  {s.showDots && pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={s.color} stroke="#fff" strokeWidth={1} />)}
                </g>
              );
            }
          }

          const areaD = s.area ? `${linePath(pts)} L${pts[pts.length - 1]!.x},${model.yScale(model.yTicks[0] ?? 0)} L${pts[0]!.x},${model.yScale(model.yTicks[0] ?? 0)} Z` : undefined;

          return (
            <g key={s.id}>
              {areaD && <path d={areaD} fill={s.color} opacity={0.08} stroke="none" />}
              <path d={linePath(pts)} fill="none" stroke={s.color} strokeWidth={s.strokeWidth ?? 2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
              {s.showDots && pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={s.color} stroke="#fff" strokeWidth={1} />)}
            </g>
          );
        })}

        {/* 十字光标 */}
        {tip && (
          <g>
            <line x1={tip.px} x2={tip.px} y1={M.top} y2={H - M.bottom} stroke={CHART_INK.axis} strokeWidth={1} strokeDasharray="2 2" />
            {tip.rows.map((r) =>
              r.value === null ? null : (
                <circle key={r.id} cx={tip.px} cy={model.yScale(r.value)} r={4} fill={r.color} stroke="#fff" strokeWidth={1.5} />
              ),
            )}
          </g>
        )}

        <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" onMouseMove={onMove} />
      </svg>

      {tip && (
        <div
          className="absolute z-10 pointer-events-none bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[160px]"
          style={{
            left: Math.min(Math.max((tip.px / W) * 100, 18), 82) + '%',
            top: Math.max(8, tip.py - 20),
            transform: 'translateX(-50%)',
          }}
        >
          <div className="text-slate-400 tabular mb-1">{tip.date}</div>
          {tip.rows.map((r) => (
            <div key={r.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full" style={{ background: r.color }} aria-hidden />
              <span className="text-slate-500">{r.name}</span>
              <span className="font-medium text-slate-700 tabular">{r.value === null ? '—' : valueFormatter(r.value)}</span>
              {r.delta !== null && r.delta !== undefined && (
                <span className={`tabular ${r.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {r.delta >= 0 ? '▲' : '▼'}{valueFormatter(Math.abs(r.delta))}
                </span>
              )}
            </div>
          ))}
          {tip.rows.some((r) => r.lower !== undefined) && (
            <div className="text-[10px] text-slate-400 mt-1 border-t border-slate-100 pt-1">
              95% 区间见阴影带
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function linePath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

/** 构建预测带路径（上半边走正向，下半边反向回到起点）。 */
function buildBandPath(pts: { x: number; y: number; lower?: number; upper?: number }[]): string | null {
  const hasAny = pts.some((p) => p.lower !== undefined || p.upper !== undefined);
  if (!hasAny) return null;
  const upper = pts.map((p) => ({ x: p.x, y: p.upper ?? p.y }));
  const lower = pts.map((p) => ({ x: p.x, y: p.lower ?? p.y })).reverse();
  const d = [...upper, ...lower].map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  return `${d} Z`;
}
