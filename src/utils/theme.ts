import type { WealthLevel } from '../types';

/**
 * 把财富等级的结构化 Theme Token 映射为 CSS Variables，全局生效。
 * 组件通过 var(--wealth-*) 引用，避免生成大量动态 Tailwind class。
 */
export function applyLevelTheme(level: WealthLevel): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const t = level.tokens;
  const vars: Record<string, string> = {
    '--wealth-primary': t.primary,
    '--wealth-secondary': t.secondary,
    '--wealth-accent': t.accent,
    '--wealth-surface': t.surface,
    '--wealth-surface-soft': t.surfaceSoft,
    '--wealth-surface-elevated': t.surfaceElevated ?? t.surfaceSoft,
    '--wealth-muted': t.muted ?? '#64748b',
    '--wealth-text-on-primary': t.textOnPrimary,
    '--wealth-border': t.border,
    '--wealth-glow': t.glow,
    '--wealth-progress-gradient': t.progressGradient,
    '--wealth-hero-gradient': t.heroGradient,
    '--wealth-hero': t.hero ?? t.heroGradient,
    '--wealth-celebration': t.celebration ?? t.primary,
    '--wealth-background-motif': t.backgroundMotif ?? 'none',
    '--wealth-particle': t.particleColor,
    '--wealth-chart-accent': t.chartAccent,
  };
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute('data-wealth-theme', level.theme);
}

/** 中性主题（当用户关闭「跟随财富等级主题」时使用）。 */
export function applyNeutralTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--wealth-primary': '#0ea5e9',
    '--wealth-secondary': '#38bdf8',
    '--wealth-accent': '#0284c7',
    '--wealth-surface': '#f0f9ff',
    '--wealth-surface-soft': '#f8fcff',
    '--wealth-text-on-primary': '#ffffff',
    '--wealth-border': '#bae6fd',
    '--wealth-glow': 'rgba(14,165,233,0.3)',
    '--wealth-progress-gradient': 'linear-gradient(90deg,#38bdf8,#0284c7)',
    '--wealth-hero-gradient': 'linear-gradient(135deg,#e0f2fe 0%,#bae6fd 55%,#a5f3fc 100%)',
    '--wealth-particle': '#7dd3fc',
    '--wealth-chart-accent': '#0ea5e9',
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.setAttribute('data-wealth-theme', 'neutral');
}
