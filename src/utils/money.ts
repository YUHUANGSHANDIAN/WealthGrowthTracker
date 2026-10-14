import type { Money } from '../types';
import { useWorkspaceStore } from '../store/workspaceStore';
import Decimal from 'decimal.js';

/**
 * 金额处理策略：所有金额以「元」为单位、number 存储，
 * 内部使用十进制运算，在写入/展示边界按 ROUND_HALF_UP 舍入到分。
 *
 * 注：这里刻意不做「整数分」存储，因为旧版 JSON 里金额就是 number(元)，
 * 旧 JSON 的元单位不变；非法数值抛错，展示层使用未知占位。
 */

const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

function decimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new RangeError('金额必须是有限数值');
  return new MoneyDecimal(value);
}

function toMoney(value: Decimal): number {
  const result = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isFinite(result)) throw new RangeError('金额超出可表示范围');
  return result === 0 ? 0 : result;
}

/** 舍入到两位小数（分）。 */
export function round2(value: number): number {
  return toMoney(decimal(value));
}

/** 安全求和并舍入到分。 */
export function sumMoney(values: Money[]): Money {
  return toMoney(values.reduce((acc, value) => acc.plus(decimal(value)), new MoneyDecimal(0)));
}

/** 求差额（避免浮点尾巴）。 */
export function diffMoney(a: Money, b: Money): Money {
  return toMoney(decimal(a).minus(decimal(b)));
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
  return useWorkspaceStore.getState().amountsHidden ? '••••' : Number.isFinite(value) ? CNY_FORMATTER.format(round2(value)) : '—';
}

/** 带 ¥ 前缀，如 "¥12,345.67"。 */
export function formatCNY(value: Money): string {
  return useWorkspaceStore.getState().amountsHidden ? '¥••••' : Number.isFinite(value) ? `¥${CNY_FORMATTER.format(round2(value))}` : '—';
}

/** 大额缩写，如 "12.3万"、"1.2百万"。 */
export function formatCompactCNY(value: Money): string {
  return useWorkspaceStore.getState().amountsHidden ? '¥••••' : Number.isFinite(value) ? `¥${CNY_COMPACT_FORMATTER.format(round2(value))}` : '—';
}

/** 解析用户输入的金额字符串，非法输入返回 null。 */
export function parseMoney(input: string): number | null {
  const trimmed = input.trim().replace(/^[￥¥]\s*/, '').replace(/，/g, ',');
  // Accept ordinary decimal amounts and correctly grouped thousands, never JS literals.
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$|^\.\d+$/.test(trimmed)) return null;
  const value = new MoneyDecimal(trimmed.replace(/,/g, ''));
  if (value.greaterThan(Number.MAX_SAFE_INTEGER / 100)) return null;
  return toMoney(value);
}
