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
    '--wealth-text-on-primary': t.textOnPrimary,
    '--wealth-border': t.border,
    '--wealth-glow': t.glow,
    '--wealth-progress-gradient': t.progressGradient,
    '--wealth-hero-gradient': t.heroGradient,
    '--wealth-particle': t.particleColor,
    '--wealth-chart-accent': t.chartAccent,
  };
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute('data-wealth-theme', level.theme);
}
