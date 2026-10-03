/** 线性标尺：把 [d0,d1] 映射到 [r0,r1]。 */
export function linearScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** 生成均匀刻度（约 n 个，取整到 "nice" 值）。 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step = niceStep(span / Math.max(1, count));
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  if (n <= 1) return pow;
  if (n <= 2) return 2 * pow;
  if (n <= 5) return 5 * pow;
  return 10 * pow;
}

/** 金额轴刻度格式化：大额缩写。 */
export function formatMoneyTick(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}百万`;
  if (Math.abs(v) >= 10_000) return `${(v / 10_000).toFixed(1)}万`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}千`;
  return `${Math.round(v)}`;
}

/** 两个 YYYY-MM-DD 之间的天数（本地时区）。 */
export function daysBetweenDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = new Date(ay ?? 0, (am ?? 1) - 1, ad ?? 1).getTime();
  const db = new Date(by ?? 0, (bm ?? 1) - 1, bd ?? 1).getTime();
  return Math.round((db - da) / 86_400_000);
}

/**
 * 根据时间跨度选择「nice」的刻度间隔（天），用于时间轴。
 * 跨度越大，刻度间隔越粗，避免标签重叠。
 */
export function timeTickInterval(spanDays: number): number {
  if (spanDays <= 14) return 1;
  if (spanDays <= 45) return 7;
  if (spanDays <= 100) return 14;
  if (spanDays <= 200) return 30;
  if (spanDays <= 400) return 60;
  if (spanDays <= 800) return 90;
  return 180;
}

/** 时间刻度标签格式化：跨年显示 YYYY-MM，年内显示 MM-DD。 */
export function formatDateTick(date: string, spanDays: number): string {
  const [y, m, d] = date.split('-');
  if (spanDays > 365) return `${y}-${m}`;
  return `${m}-${d}`;
}

/** 生成时间轴刻度（返回 elapsed-days 位置与标签）。 */
export function timeTicks(minDate: string, maxDate: string, maxTicks = 7): { t: number; label: string }[] {
  const spanDays = daysBetweenDates(minDate, maxDate);
  if (spanDays <= 0) return [{ t: 0, label: minDate }];
  const interval = timeTickInterval(spanDays);
  const ticks: { t: number; label: string }[] = [];
  for (let t = 0; t <= spanDays; t += interval) {
    const d = addDaysStr(minDate, t);
    ticks.push({ t, label: formatDateTick(d, spanDays) });
  }
  if (ticks.length > maxTicks) {
    // 若仍过多，抽稀
    const step = Math.ceil(ticks.length / maxTicks);
    return ticks.filter((_, i) => i % step === 0);
  }
  return ticks;
}

function addDaysStr(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
