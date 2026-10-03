import { useMemo } from 'react';
import { CHART_INK } from './palette';

export interface RadarAxis {
  dimension: string;
  value: number; // 0-100
  color: string;
  description?: string;
}

const W = 320;
const H = 280;
const CX = W / 2;
const CY = H / 2;
const R = 100;

/** 2D 雷达图（SVG）。旧版使用 three.js 3D 雷达；新版改用轻量 2D 版本以减小包体积。 */
export function RadarChart({
  axes,
  ariaLabel = '雷达图',
}: {
  axes: RadarAxis[];
  ariaLabel?: string;
}) {
  const n = axes.length;
  const angle = useMemo(() => (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2, [n]);
  const point = useMemo(
    () => (i: number, ratio: number) => ({
      x: CX + Math.cos(angle(i)) * R * ratio,
      y: CY + Math.sin(angle(i)) * R * ratio,
    }),
    [angle],
  );

  if (n < 3) {
    return (
      <p className="text-sm text-slate-400 text-center py-8">维度不足，无法绘制雷达图</p>
    );
  }

  const dataPolygon = axes.map((a, i) => {
    const p = point(i, Math.max(0, Math.min(1, a.value / 100)));
    return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ') + ' Z';

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[320px]" role="img" aria-label={ariaLabel}>
        {/* 网格环 */}
        {rings.map((r) => (
          <polygon
            key={r}
            points={axes.map((_, i) => {
              const p = point(i, r);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            }).join(' ')}
            fill="none"
            stroke={CHART_INK.grid}
            strokeWidth={1}
          />
        ))}
        {/* 轴线 */}
        {axes.map((_, i) => {
          const p = point(i, 1);
          return (
            <line
              key={i}
              x1={CX}
              y1={CY}
              x2={p.x}
              y2={p.y}
              stroke={CHART_INK.grid}
              strokeWidth={1}
            />
          );
        })}
        {/* 数据多边形 */}
        <polygon points={dataPolygon} fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth={2} />
        {/* 顶点 */}
        {axes.map((a, i) => {
          const p = point(i, Math.max(0, Math.min(1, a.value / 100)));
          return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={a.color} stroke="#fff" strokeWidth={1.5} />;
        })}
        {/* 维度标签 */}
        {axes.map((a, i) => {
          const p = point(i, 1.18);
          return (
            <text
              key={i}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fill={CHART_INK.secondary}
            >
              {a.dimension}
            </text>
          );
        })}
      </svg>
      <div className="space-y-2 text-sm">
        {axes.map((a) => (
          <div key={a.dimension} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: a.color }} aria-hidden />
            <span className="text-slate-700">{a.dimension}</span>
            <span className="text-slate-400 tabular">{Math.round(a.value)}</span>
            {a.description && <span className="text-slate-400 text-xs">· {a.description}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
