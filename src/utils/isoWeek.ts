import { pad2 } from './date';

/**
 * ISO 8601 Week Domain（v1.6）—— 统一周报周期元数据的唯一权威来源。
 *
 * 规则（严格 ISO 8601）：
 * - 一周从 Monday 开始，Sunday 结束，正好 7 天。
 * - Week 1 是包含 January 4 的周（等价：包含当年第一个 Thursday 的周）。
 * - 全年 52 或 53 周；跨年周归属其「ISO 周年份」。
 *
 * 目的：periodKey / startDate / endDate / isoWeek / isoWeekYear / year /
 * standardTitle 不再各自推导，而由一个 canonical 函数统一生成，避免旧报告中
 * 「Sunday→Sunday 8 天」「weekNumber=1 但 isoWeek=2」这类周期字段互相冲突。
 */

export interface IsoWeekIdentity {
  isoWeekYear: number;
  isoWeek: number; // 1-53
}

export interface CanonicalWeeklyPeriod extends IsoWeekIdentity {
  periodKey: string;
  startDate: string; // Monday
  endDate: string; // Sunday
  standardTitle: string;
}

/** UTC 日期字符串（周计算用 UTC，避免本地时区/夏令时偏移）。 */
function utcDateString(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 某 ISO 周年份 Week 1 的 Monday（即 1 月 4 日所在周的 Monday）。 */
function mondayOfIsoWeek1(isoWeekYear: number): Date {
  const jan4 = new Date(Date.UTC(isoWeekYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // 1=Mon .. 7=Sun
  return new Date(Date.UTC(isoWeekYear, 0, 4 - (jan4Day - 1)));
}

/** 给定 (isoWeekYear, isoWeek)，返回该 ISO 周的 Monday→Sunday 范围。 */
export function isoWeekRange(isoWeekYear: number, isoWeek: number): { startDate: string; endDate: string } {
  const monday = mondayOfIsoWeek1(isoWeekYear);
  monday.setUTCDate(monday.getUTCDate() + (isoWeek - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { startDate: utcDateString(monday), endDate: utcDateString(sunday) };
}

/** 解析 "weekly:2026-W40" → { isoWeekYear, isoWeek }（非法返回 null）。 */
export function parseWeeklyPeriodKey(key: string | undefined): IsoWeekIdentity | null {
  if (!key) return null;
  const m = /^weekly:(\d{4})-W(\d{1,2})$/.exec(key);
  if (!m) return null;
  const isoWeekYear = Number(m[1]);
  const isoWeek = Number(m[2]);
  if (!Number.isFinite(isoWeekYear) || !Number.isFinite(isoWeek)) return null;
  if (isoWeek < 1 || isoWeek > 53) return null;
  return { isoWeekYear, isoWeek };
}

/** 解析标准标题 "2026年第40周周度财务报告" → { isoWeekYear, isoWeek }。 */
export function parseWeeklyTitle(title: string | undefined): IsoWeekIdentity | null {
  if (!title) return null;
  const m = /(\d{4})年第(\d{1,2})周/.exec(title);
  if (!m) return null;
  const isoWeekYear = Number(m[1]);
  const isoWeek = Number(m[2]);
  if (!Number.isFinite(isoWeekYear) || isoWeek < 1 || isoWeek > 53) return null;
  return { isoWeekYear, isoWeek };
}

/** 校验 (isoWeekYear, isoWeek) 是否为合法 ISO 周。 */
export function isValidIsoWeek(isoWeekYear: number, isoWeek: number): boolean {
  return Number.isFinite(isoWeekYear) && Number.isFinite(isoWeek) && isoWeek >= 1 && isoWeek <= 53;
}

/** 由身份生成 canonical 周报周期（所有字段唯一一致）。 */
export function canonicalWeeklyPeriod(identity: IsoWeekIdentity): CanonicalWeeklyPeriod {
  const { startDate, endDate } = isoWeekRange(identity.isoWeekYear, identity.isoWeek);
  return {
    isoWeekYear: identity.isoWeekYear,
    isoWeek: identity.isoWeek,
    periodKey: `weekly:${identity.isoWeekYear}-W${pad2(identity.isoWeek)}`,
    startDate,
    endDate,
    standardTitle: `${identity.isoWeekYear}年第${identity.isoWeek}周周度财务报告`,
  };
}

/**
 * 解析周报身份（优先级，v1.6 规则 9）：
 * 1. 合法 periodKey（weekly:YYYY-Www）
 * 2. 合法 isoWeekYear + isoWeek
 * 3. 标准标题（YYYY年第N周）
 * 4. 由 endDate 推导（最后兜底）
 *
 * 绝不因旧 startDate/endDate 本身错误，而用错误日期重新决定 Week Identity。
 */
export function resolveWeeklyIdentity(input: {
  periodKey?: string;
  isoWeekYear?: number;
  isoWeek?: number;
  title?: string;
  endDate?: string;
  startDate?: string;
}): IsoWeekIdentity | null {
  const fromKey = parseWeeklyPeriodKey(input.periodKey);
  if (fromKey) return fromKey;

  if (input.isoWeekYear !== undefined && input.isoWeek !== undefined && isValidIsoWeek(input.isoWeekYear, input.isoWeek)) {
    return { isoWeekYear: input.isoWeekYear, isoWeek: input.isoWeek };
  }

  const fromTitle = parseWeeklyTitle(input.title);
  if (fromTitle) return fromTitle;

  // 兜底：由 endDate（或 startDate）的 ISO 周推导
  const date = input.endDate || input.startDate;
  if (date) {
    const iso = isoWeekOfDate(date);
    if (iso) return iso;
  }
  return null;
}

/** 某 "YYYY-MM-DD" 的 ISO 周身份（返回 null 若无法解析）。 */
export function isoWeekOfDate(date: string): IsoWeekIdentity | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  const thursday = new Date(dt);
  thursday.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const isoYear = thursday.getUTCFullYear();
  const week1Thursday = new Date(Date.UTC(isoYear, 0, 4));
  const week1ThursdayDay = week1Thursday.getUTCDay() || 7;
  week1Thursday.setUTCDate(week1Thursday.getUTCDate() + (4 - week1ThursdayDay));
  const week = Math.floor((thursday.getTime() - week1Thursday.getTime()) / (7 * 86_400_000)) + 1;
  if (week < 1 || week > 53) return null;
  return { isoWeekYear: isoYear, isoWeek: week };
}
