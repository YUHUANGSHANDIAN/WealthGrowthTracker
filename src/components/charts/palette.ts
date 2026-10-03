/**
 * 图表配色 —— 采用经过色盲安全验证的分类色板（见 dataviz 参考规范）。
 * 分类色按固定顺序分配、绝不循环；单系列使用品牌色 emerald。
 * 渠道自身颜色仍用于渠道身份（配合直接标签，颜色不承担唯一识别）。
 */
export const CATEGORICAL_SERIES = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
] as const;

export const CHART_INK = {
  primary: '#0f172a',
  secondary: '#475569',
  muted: '#94a3b8',
  grid: '#e2e8f0',
  axis: '#cbd5e1',
} as const;

export const BRAND = '#10b981';
export const PREDICTION = '#2a78d6';
export const UP = '#006300';
export const DOWN = '#d03b3b';
