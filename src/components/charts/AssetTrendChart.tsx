import { useMemo, useRef, useState } from 'react';
import { CHART_INK } from './palette';
import { daysBetweenDates, formatMoneyTick, linearScale, niceTicks, timeTicks } from './scales';

export interface AssetTrendChartSeries {
  id: string;
  name: string;
  color: string;
  dashed?: boolean;
  area?: boolean;
  points: Array<{ date: string; value: number | null }>;
}

export interface AssetTrendChartMarker {
  date: string;
  label: string;
  color?: string;
}

const W = 900;
const H = 390;
const M = { top: 22, right: 24, bottom: 44, left: 72 };

export function AssetTrendChart({
  series,
  valueFormatter,
  ariaLabel,
  markers = [],
  onSelectedDateChange,
  tableSeries,
}: {
  series: AssetTrendChartSeries[];
  tableSeries?: AssetTrendChartSeries[];
  valueFormatter: (value: number) => string;
  ariaLabel: string;
  markers?: AssetTrendChartMarker[];
  onSelectedDateChange?: (date: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const detailedSeries = tableSeries ?? series;
  const [lockedDate, setLockedDate] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [view, setView] = useState<{ start: string; end: string } | null>(null);
  const [drag, setDrag] = useState<{ from: string; to: string; x1: number; x2: number } | null>(null);
  const dragStart = useRef<{ x: number; date: string } | null>(null);

  const model = useMemo(() => {
    const dates = [...new Set(detailedSeries.flatMap((item) => item.points.map((point) => point.date)))].sort();
    const start = view?.start && dates.includes(view.start) ? view.start : dates[0] ?? '';
    const end = view?.end && dates.includes(view.end) ? view.end : dates[dates.length - 1] ?? '';
    const spanDays = start && end ? Math.max(0, daysBetweenDates(start, end)) : 0;
    const xScale = spanDays > 0
      ? linearScale([0, spanDays], [M.left, W - M.right])
      : () => (M.left + W - M.right) / 2;
    const visible = series.map((item) => ({
      ...item,
      points: item.points.filter((point) => point.date >= start && point.date <= end),
    }));
    const values = visible.flatMap((item) => item.points
      .map((point) => point.value)
      .filter((value): value is number => value !== null && Number.isFinite(value)));
    let min = values.length ? Math.min(...values) : 0;
    let max = values.length ? Math.max(...values) : 1;
    if (min === max) {
      min -= Math.max(1, Math.abs(min) * 0.1);
      max += Math.max(1, Math.abs(max) * 0.1);
    }
    const padding = Math.max((max - min) * 0.08, Math.abs(max) * 0.005);
    const yScale = linearScale([min - padding, max + padding], [H - M.bottom, M.top]);
    const ticks = niceTicks(min - padding, max + padding, 5);
    const x = (date: string) => spanDays > 0 ? xScale(daysBetweenDates(start, date)) : xScale(0);
    const visibleDates = dates.filter((date) => date >= start && date <= end);
    return { dates, visibleDates, start, end, spanDays, x, yScale, ticks };
  }, [detailedSeries, series, view]);

  const activeDate = lockedDate ?? hoverDate;
  const activeRows = activeDate
    ? detailedSeries.map((item) => ({
        ...item,
        value: item.points.find((point) => point.date === activeDate)?.value ?? null,
      }))
    : [];

  function dateAtClientX(clientX: number): string | null {
    const svg = svgRef.current;
    if (!svg || !model.visibleDates.length) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let nearest = model.visibleDates[0]!;
    let best = Number.POSITIVE_INFINITY;
    for (const date of model.visibleDates) {
      const distance = Math.abs(model.x(date) - px);
      if (distance < best) {
        nearest = date;
        best = distance;
      }
    }
    return nearest;
  }

  function selectDate(date: string | null) {
    setLockedDate(date);
    setHoverDate(date);
    onSelectedDateChange?.(date);
  }

  function zoom(factor: number) {
    if (model.visibleDates.length < 3) return;
    const currentStart = model.visibleDates[0]!;
    const currentEnd = model.visibleDates[model.visibleDates.length - 1]!;
    const startIndex = model.dates.indexOf(currentStart);
    const endIndex = model.dates.indexOf(currentEnd);
    const count = endIndex - startIndex + 1;
    const nextCount = factor < 1
      ? Math.max(3, Math.round(count * factor))
      : Math.min(model.dates.length, Math.round(count * factor));
    const center = (startIndex + endIndex) / 2;
    let nextStart = Math.max(0, Math.floor(center - nextCount / 2));
    const nextEnd = Math.min(model.dates.length - 1, nextStart + nextCount - 1);
    nextStart = Math.max(0, nextEnd - nextCount + 1);
    setView({ start: model.dates[nextStart]!, end: model.dates[nextEnd]! });
  }

  function reset() {
    setView(null);
    selectDate(null);
    setDrag(null);
    dragStart.current = null;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1">
        <button type="button" className="trend-chart-control" onClick={() => zoom(0.6)} aria-label="放大趋势图">放大</button>
        <button type="button" className="trend-chart-control" onClick={() => zoom(1.6)} aria-label="缩小趋势图">缩小</button>
        <button type="button" className="trend-chart-control" onClick={reset} aria-label="重置趋势图范围和选中点">重置</button>
      </div>
      <div className="relative" role="group" aria-label={ariaLabel}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-pan-y"
          role="img"
          aria-label={`${ariaLabel}；点击锁定数据点，方向键浏览，拖拽选择时间范围`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              selectDate(null);
              return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const current = model.visibleDates.indexOf(activeDate ?? '');
            const index = event.key === 'Home' ? 0
              : event.key === 'End' ? model.visibleDates.length - 1
              : Math.max(0, Math.min(model.visibleDates.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)));
            const date = model.visibleDates[index];
            if (date) selectDate(date);
          }}
        >
          {model.ticks.map((tick) => (
            <g key={tick}>
              <line x1={M.left} x2={W - M.right} y1={model.yScale(tick)} y2={model.yScale(tick)} stroke={CHART_INK.grid} strokeWidth={1} />
              <text x={M.left - 9} y={model.yScale(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={CHART_INK.muted} className="tabular">
                {formatMoneyTick(tick)}
              </text>
            </g>
          ))}
          {timeTicks(model.start, model.end, 8).map((tick) => {
            const date = new Date(Date.parse(`${model.start}T00:00:00Z`) + tick.t * 86_400_000).toISOString().slice(0, 10);
            return <text key={tick.t} x={model.x(date)} y={H - M.bottom + 19} textAnchor="middle" fontSize={11} fill={CHART_INK.muted}>{tick.label}</text>;
          })}
          {markers.filter((marker) => marker.date >= model.start && marker.date <= model.end).map((marker) => (
            <g key={`${marker.date}:${marker.label}`}>
              <line x1={model.x(marker.date)} x2={model.x(marker.date)} y1={M.top} y2={H - M.bottom} stroke={marker.color ?? '#d97706'} strokeDasharray="4 4" />
              <text x={model.x(marker.date) + 4} y={M.top + 12} fontSize={10} fill={marker.color ?? '#a16207'}>{marker.label}</text>
            </g>
          ))}
          {series.map((item) => {
            const points = item.points.filter((point) => point.date >= model.start && point.date <= model.end);
            const segments: Array<Array<{ x: number; y: number; date: string; value: number }>> = [];
            let segment: Array<{ x: number; y: number; date: string; value: number }> = [];
            for (const point of points) {
              if (point.value === null) {
                if (segment.length) segments.push(segment);
                segment = [];
              } else {
                segment.push({ date: point.date, value: point.value, x: model.x(point.date), y: model.yScale(point.value) });
              }
            }
            if (segment.length) segments.push(segment);
            return (
              <g key={item.id}>
                {segments.map((segmentPoints, index) => (
                  <g key={index}>
                    {item.area && (
                      <path
                        d={`${segmentPoints.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')} L${segmentPoints[segmentPoints.length - 1]!.x},${H - M.bottom} L${segmentPoints[0]!.x},${H - M.bottom} Z`}
                        fill={item.color}
                        opacity={0.08}
                      />
                    )}
                    <path
                      d={segmentPoints.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')}
                      fill="none"
                      stroke={item.color}
                      strokeWidth={2}
                      strokeDasharray={item.dashed ? '6 4' : undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </g>
                ))}
                {points.filter((point) => point.value !== null && model.visibleDates.length <= 120).map((point) => (
                  <circle key={point.date} cx={model.x(point.date)} cy={model.yScale(point.value!)} r={2.6} fill={item.color} />
                ))}
              </g>
            );
          })}
          {activeDate && (
            <line x1={model.x(activeDate)} x2={model.x(activeDate)} y1={M.top} y2={H - M.bottom} stroke={CHART_INK.axis} strokeDasharray="2 2" />
          )}
          <rect
            x={M.left}
            y={M.top}
            width={W - M.left - M.right}
            height={H - M.top - M.bottom}
            fill="transparent"
            onPointerMove={(event) => {
              const date = dateAtClientX(event.clientX);
              if (!date) return;
              if (dragStart.current) {
                setDrag({
                  from: dragStart.current.date,
                  to: date,
                  x1: model.x(dragStart.current.date),
                  x2: model.x(date),
                });
              } else if (!lockedDate) {
                setHoverDate(date);
                onSelectedDateChange?.(date);
              }
            }}
            onPointerLeave={() => {
              if (!lockedDate) {
                setHoverDate(null);
                onSelectedDateChange?.(null);
              }
            }}
            onPointerDown={(event) => {
              const date = dateAtClientX(event.clientX);
              if (!date) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragStart.current = { x: event.clientX, date };
              setDrag({ from: date, to: date, x1: model.x(date), x2: model.x(date) });
            }}
            onPointerUp={(event) => {
              const from = dragStart.current;
              const to = dateAtClientX(event.clientX);
              dragStart.current = null;
              setDrag(null);
              if (!from || !to) return;
              const distance = Math.abs(event.clientX - from.x);
              if (distance > 12 && from.date !== to) {
                const pair = [from.date, to].sort();
                setView({ start: pair[0]!, end: pair[1]! });
                selectDate(null);
              } else {
                selectDate(from.date);
              }
            }}
            onPointerCancel={() => {
              dragStart.current = null;
              setDrag(null);
            }}
          />
          {drag && Math.abs(drag.x2 - drag.x1) > 2 && (
            <rect
              x={Math.min(drag.x1, drag.x2)}
              y={M.top}
              width={Math.abs(drag.x2 - drag.x1)}
              height={H - M.top - M.bottom}
              fill="#0f766e"
              opacity={0.1}
              pointerEvents="none"
            />
          )}
        </svg>
        {activeDate && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 min-w-44 -translate-x-1/2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg">
            <div className="mb-1 font-medium tabular text-slate-600">{activeDate}{lockedDate ? ' · 已锁定' : ''}</div>
            {activeRows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-0.5">
                <span className="flex items-center gap-1.5 text-slate-500"><i className="h-2 w-2 rounded-full" style={{ background: row.color }} />{row.name}</span>
                <span className="tabular font-medium text-slate-700">{row.value === null ? '未知' : valueFormatter(row.value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer py-2">查看趋势数据表</summary>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{ariaLabel}</caption>
            <thead className="sticky top-0 bg-white">
              <tr><th scope="col">日期</th>{detailedSeries.map((item) => <th scope="col" key={item.id}>{item.name}</th>)}</tr>
            </thead>
            <tbody>
              {model.visibleDates.map((date) => (
                <tr key={date}>
                  <th scope="row" className="tabular">{date}</th>
                  {detailedSeries.map((item) => {
                    const value = item.points.find((point) => point.date === date)?.value;
                    return <td key={item.id} className="tabular">{value === null || value === undefined ? '未知' : valueFormatter(value)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
