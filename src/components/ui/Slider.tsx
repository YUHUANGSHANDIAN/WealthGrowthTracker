import type { ReactNode } from 'react';

/**
 * 统一 Slider（v1.6）：替换分散的原生 <input type="range">。
 * - 基于原生 range（保证 Mouse / Touch / Arrow Keys / Home / End 可用）。
 * - 统一 Track / Active Track / Thumb 视觉（跟随 emerald accent）。
 * - 实时显示当前值（不再让用户拖动后猜值）。
 * - 携带 aria-valuemin / aria-valuemax / aria-valuenow。
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  ariaLabel,
  hint,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** 自定义值显示格式（默认直接显示数值）。 */
  format?: (value: number) => string;
  ariaLabel?: string;
  hint?: ReactNode;
}) {
  const display = format ? format(value) : String(value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        <span className="text-xs font-semibold text-emerald-600 tabular shrink-0">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="w-full accent-emerald-600 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
