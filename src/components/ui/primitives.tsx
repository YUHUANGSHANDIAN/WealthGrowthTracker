import React from 'react';

// ---------------------------------------------------------------------------
// 基础 UI 原子组件：Button / Card / Badge / ProgressBar / EmptyState / Spinner
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-500 shadow-sm',
  secondary:
    'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500 shadow-sm',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 shadow-sm',
  outline:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400',
};

const SIZES: Record<Size, string> = {
  sm: 'text-xs px-2.5 py-1.5 rounded-md gap-1',
  md: 'text-sm px-3.5 py-2 rounded-lg gap-1.5',
  lg: 'text-base px-5 py-2.5 rounded-xl gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
}

export function Card({
  className = '',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`ui-card bg-white rounded-2xl border border-slate-200/80 shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

type BadgeTone = 'emerald' | 'blue' | 'amber' | 'red' | 'purple' | 'slate';
const BADGE_TONES: Record<BadgeTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function Badge({
  tone = 'slate',
  className = '',
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  className = '',
  barClassName = '',
  color,
}: {
  value: number; // 0-100
  className?: string;
  barClassName?: string;
  color?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full h-2.5 rounded-full bg-slate-200/70 overflow-hidden ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${barClassName}`}
        style={{ width: `${clamped}%`, ...(color ? { backgroundColor: color } : {}) }}
      />
    </div>
  );
}

export function EmptyState({
  icon = '🗂️',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div className="text-4xl mb-3" aria-hidden>
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-700">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="加载中"
    />
  );
}
