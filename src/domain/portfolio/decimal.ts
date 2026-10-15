import Decimal from 'decimal.js';

/**
 * 月度理财域的数值口径：
 * - 金额：元 + number（沿用旧契约），域内用 decimal.js 计算，写入/展示按分（2 位）HALF_UP。
 * - 份额 / 净值 / 费率：以十进制字符串持久化，避免浮点误差；域内转 Decimal 计算。
 * - 比例：域内统一 0–1，展示层转百分数；旧数据里的 0–100 必须显式适配。
 */
export const MONEY = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** 规范化十进制字符串（不接受科学计数法、NaN、空串）。 */
export const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;

export function isDecimalText(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_TEXT.test(value);
}

export function parseDecimal(value: string | number | Decimal, label = '数值'): Decimal {
  if (value instanceof Decimal) return new MONEY(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`${label}必须是有限数值`);
    return new MONEY(value);
  }
  if (!isDecimalText(value)) throw new RangeError(`${label}必须是普通十进制字符串`);
  return new MONEY(value);
}

/** 序列化为固定小数位的十进制字符串（份额/净值/费率持久化用）。 */
export function toDecimalText(value: string | number | Decimal, places: number): string {
  if (!Number.isInteger(places) || places < 0 || places > 18) throw new RangeError('小数位数无效');
  return parseDecimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

/** 金额：舍入到分（2 位）。 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('金额必须是有限数值');
  const rounded = new MONEY(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  return rounded === 0 ? 0 : rounded;
}

/** 金额求和（逐项按分舍入后再累加，避免长尾误差）。 */
export function sumMoney(values: readonly number[]): number {
  return roundMoney(values.reduce((total, value) => total + roundMoney(value), 0));
}

export function moneyDiff(a: number, b: number): number {
  return roundMoney(roundMoney(a) - roundMoney(b));
}

/** 比例：内部 0–1；分母非法（<=0 或未知）时返回 null，绝不返回 Infinity 或补 0。 */
export function ratio(part: number, whole: number | null | undefined): number | null {
  if (whole === null || whole === undefined || !Number.isFinite(whole) || whole <= 0) return null;
  if (!Number.isFinite(part)) return null;
  return new MONEY(part).div(whole).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
}

/** 旧 0–100 字段 → 内部 0–1（显式适配，仅用于跨口径交界处）。 */
export function fromLegacyPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return new MONEY(value).div(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
}

/** 比例展示文本：未知一律 N/A，不显示 0%。 */
export function ratioText(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  return `${(value * 100).toFixed(digits)}%`;
}

/** 两个金额在给定容差（元）内视为一致。 */
export function withinTolerance(a: number, b: number, tolerance: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(tolerance) || tolerance < 0) return false;
  return Math.abs(roundMoney(a) - roundMoney(b)) <= tolerance;
}

/** 逐行舍入产生的最大累计误差：行数 × 0.005 元。 */
export function roundingTolerance(rowCount: number): number {
  if (!Number.isInteger(rowCount) || rowCount < 0) throw new RangeError('行数无效');
  return new MONEY(rowCount).mul(0.005).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
}
