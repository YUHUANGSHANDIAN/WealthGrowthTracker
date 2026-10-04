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

/** ISO-8601 周编号结果：ISO 周年份可能与日历年不同（年初/年末跨年周）。 */
export interface IsoWeek {
  /** ISO 周年份（如 2026-W53 可能落在 2027 年初，此时 isoYear 为 2026）。 */
  year: number;
  /** ISO 周编号，1-53。 */
  week: number;
}

/**
 * ISO-8601 周编号（周一为一周起点，第 1 周为包含当年第一个周四的周）。
 * 与旧自定义算法不同：不会出现 Week 0，且跨年周编号稳定。
 */
export function isoWeekOfYear(s: string): IsoWeek {
  const d = parseDateString(s);
  // 用 UTC 计算避免本地时区/夏令时对周计算的影响
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; // 1=周一 … 7=周日
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // 移到本周周四
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: isoYear, week };
}

/** ISO 周编号（数字，向后兼容旧调用方；跨年周返回 ISO 周而非日历年周）。 */
export function weekNumberOfYear(s: string): number {
  return isoWeekOfYear(s).week;
}

/** ISO 周 key，如 "2026-W40"。 */
export function isoWeekKey(s: string): string {
  const { year, week } = isoWeekOfYear(s);
  return `${year}-W${pad2(week)}`;
}

/** 周报标题，如 "2026年第19周周度财务报告"（使用 ISO 周年份与周编号）。 */
export function weeklyReportTitle(s: string): string {
  const { year, week } = isoWeekOfYear(s);
  return `${year}年第${week}周周度财务报告`;
}
