import type { Money } from '../types';

/**
 * 金额处理策略：所有金额以「元」为单位、number 存储，
 * 但在累加/写入/展示前统一做两位小数舍入，避免 0.1 + 0.2 之类的浮点误差。
 *
 * 注：这里刻意不做「整数分」存储，因为旧版 JSON 里金额就是 number(元)，
 * 用整数分会破坏数据兼容性。用 round2 已足以覆盖个人记账精度需求。
 */

const EPSILON = Number.EPSILON;

/** 舍入到两位小数（分）。 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + EPSILON) * 100) / 100;
}

/** 安全求和并舍入到分。 */
export function sumMoney(values: Money[]): Money {
  return round2(values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0));
}

/** 求差额（避免浮点尾巴）。 */
export function diffMoney(a: Money, b: Money): Money {
  return round2(a - b);
}

/** 增长率：(current - prev) / prev，prev <= 0 时返回 0。 */
export function growthRate(current: Money, prev: Money): number {
  if (!Number.isFinite(prev) || prev <= 0) return 0;
  return (current - prev) / prev;
}

/** 百分比（0-100 区间），保留一位小数。 */
export function percentage(current: Money, prev: Money): number {
  const rate = growthRate(current, prev);
  return Math.round(rate * 1000) / 10;
}

const CNY_FORMATTER = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CNY_COMPACT_FORMATTER = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 格式化为人民币字符串（不含 ¥ 前缀，但含两位小数），如 "12,345.67"。 */
export function formatAmount(value: Money): string {
  return CNY_FORMATTER.format(round2(value));
}

/** 带 ¥ 前缀，如 "¥12,345.67"。 */
export function formatCNY(value: Money): string {
  return `¥${CNY_FORMATTER.format(round2(value))}`;
}

/** 大额缩写，如 "12.3万"、"1.2百万"。 */
export function formatCompactCNY(value: Money): string {
  return `¥${CNY_COMPACT_FORMATTER.format(round2(value))}`;
}

/** 解析用户输入的金额字符串，非法输入返回 null。 */
export function parseMoney(input: string): number | null {
  const trimmed = input.trim().replace(/[￥¥,，\s]/g, '');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return round2(n);
}
