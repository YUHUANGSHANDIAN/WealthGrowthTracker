/** 日期工具：统一使用本地时区的 YYYY-MM-DD 字符串，避免 toISOString 的 UTC 偏移。 */

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date → "YYYY-MM-DD"（本地时区）。 */
export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 今天的 "YYYY-MM-DD"。 */
export function todayString(): string {
  return toDateString(new Date());
}

/** "YYYY-MM-DD" → 本地 Date（当天 00:00）。 */
export function parseDateString(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

/** 加上 n 天。 */
export function addDays(s: string, days: number): string {
  const d = parseDateString(s);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

/** 两个日期字符串之间的天数（b - a）。 */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateString(b).getTime() - parseDateString(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** 某周（周一为一周开始）的起始日期。 */
export function weekStart(s: string): string {
  const d = parseDateString(s);
  const day = d.getDay(); // 0=周日
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateString(d);
}

/** 某周（周日结束）的结束日期。 */
export function weekEnd(s: string): string {
  const d = parseDateString(weekStart(s));
  d.setDate(d.getDate() + 6);
  return toDateString(d);
}

/** 月起始 / 月末。 */
export function monthStart(s: string): string {
  const d = parseDateString(s);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}
export function monthEnd(s: string): string {
  const d = parseDateString(s);
  return toDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** 年起始 / 年末。 */
export function yearStart(s: string): string {
  return `${parseDateString(s).getFullYear()}-01-01`;
}
export function yearEnd(s: string): string {
  return `${parseDateString(s).getFullYear()}-12-31`;
}

/** 计算某日期是当年的第几周（周一为一周开始）。 */
export function weekNumberOfYear(s: string): number {
  const d = parseDateString(s);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfWeek = jan1.getDay() === 0 ? 7 : jan1.getDay();
  const firstMonday = new Date(d.getFullYear(), 0, 1 + (8 - dayOfWeek));
  const diff = Math.round((d.getTime() - firstMonday.getTime()) / 86_400_000);
  return Math.floor(diff / 7) + 1;
}

/** 周报标题，如 "2026年第19周周度财务报告"。 */
export function weeklyReportTitle(s: string): string {
  const year = parseDateString(s).getFullYear();
  return `${year}年第${weekNumberOfYear(s)}周周度财务报告`;
}
