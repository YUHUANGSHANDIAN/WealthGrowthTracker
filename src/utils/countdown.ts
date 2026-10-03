import { intervalToDuration } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { CountdownData } from '../types';

export type CountdownStatus = 'not-started' | 'running' | 'ended';

export interface CountdownState {
  status: CountdownStatus;
  elapsedMs: number;
  remainingMs: number;
  totalMs: number;
  /** 时间进度 0-100。 */
  timeProgress: number;
}

export interface CountdownDuration {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalDays: number;
  totalHours: number;
}

/** 系统默认时区（IANA）。 */
export function getDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

/** 常见 IANA 时区选项。 */
export const TIMEZONE_OPTIONS = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const;

/** 解析 CountdownData 为绝对时间戳（优先已存的 instant，否则由日期/时间 + 时区解析）。 */
export function resolveCountdownInstants(cd: CountdownData): {
  startInstant: number;
  targetInstant: number;
  timezone: string;
} {
  const timezone = cd.timezone || getDefaultTimezone();
  const resolve = (instant: number | undefined, dateTime: string | undefined, date: string): number => {
    if (typeof instant === 'number' && Number.isFinite(instant)) return instant;
    if (dateTime) {
      const ms = fromZonedTime(dateTime, timezone).getTime();
      return Number.isFinite(ms) ? ms : fromZonedTime(`${date}T00:00`, timezone).getTime();
    }
    return fromZonedTime(`${date}T00:00`, timezone).getTime();
  };
  return {
    startInstant: resolve(cd.startInstant, cd.startDateTime, cd.startDate),
    targetInstant: resolve(cd.targetInstant, cd.targetDateTime, cd.targetDate),
    timezone,
  };
}

/** 计算倒计时状态（基于真实时间戳，不依赖内部秒数递减，避免睡眠/后台恢复后漂移）。 */
export function computeCountdownState(now: number, cd: CountdownData): CountdownState {
  const { startInstant, targetInstant } = resolveCountdownInstants(cd);
  const totalMs = Math.max(0, targetInstant - startInstant);
  const remainingMs = targetInstant - now;
  const elapsedMs = Math.max(0, Math.min(totalMs, now - startInstant));
  const status: CountdownStatus = now < startInstant ? 'not-started' : now >= targetInstant ? 'ended' : 'running';
  return {
    status,
    elapsedMs,
    remainingMs: Math.max(0, remainingMs),
    totalMs,
    timeProgress: totalMs > 0 ? Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100)) : 0,
  };
}

/** 计算日历时长（真实 calendar duration，非 30 天=1 月近似），在指定时区下。 */
export function countdownDuration(now: number, cd: CountdownData): CountdownDuration {
  const { targetInstant, timezone } = resolveCountdownInstants(cd);
  const remainingMs = Math.max(0, targetInstant - now);

  const zNow = toZonedTime(new Date(now), timezone);
  const zTarget = toZonedTime(new Date(targetInstant), timezone);
  const d = intervalToDuration({ start: zNow, end: zTarget });

  return {
    years: d.years ?? 0,
    months: d.months ?? 0,
    days: d.days ?? 0,
    hours: d.hours ?? 0,
    minutes: d.minutes ?? 0,
    seconds: d.seconds ?? 0,
    totalDays: Math.floor(remainingMs / 86_400_000),
    totalHours: Math.floor(remainingMs / 3_600_000),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 格式化倒计时剩余时间（支持 calendar / days / hours / simple 四种模式）。 */
export function formatCountdown(dur: CountdownDuration, displayMode: CountdownData['displayMode'], showSeconds = false): string {
  const hms = `${pad2(dur.hours)}:${pad2(dur.minutes)}${showSeconds ? `:${pad2(dur.seconds)}` : ''}`;

  switch (displayMode ?? 'calendar') {
    case 'days':
      return `${dur.totalDays}天 ${hms}`;
    case 'hours':
      return `${dur.totalHours.toLocaleString('zh-CN')} 小时`;
    case 'simple':
      return `${dur.totalDays} 天`;
    case 'calendar':
    default: {
      const parts: string[] = [];
      if (dur.years > 0) parts.push(`${dur.years}年`);
      if (dur.months > 0) parts.push(`${dur.months}个月`);
      if (dur.days > 0 || parts.length === 0) parts.push(`${dur.days}天`);
      parts.push(hms);
      return parts.join(' ');
    }
  }
}

/** 目标身份 key：目标金额 + 目标时间变化时改变，用于重新检测目标达成庆祝。 */
export function goalKey(targetAmount: number, targetInstant: number): string {
  return `${Math.round(targetAmount * 100)}@${Math.round(targetInstant)}`;
}
