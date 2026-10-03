import { describe, it, expect } from 'vitest';
import {
  computeCountdownState,
  countdownDuration,
  formatCountdown,
  goalKey,
  resolveCountdownInstants,
} from '../../src/utils/countdown';
import type { CountdownData } from '../../src/types';

describe('倒计时引擎', () => {
  it('时间轴：进行中/未开始/已结束', () => {
    const cd: CountdownData = {
      targetAmount: 1_000_000,
      targetDate: '2026-12-31',
      startDate: '2026-01-01',
      timezone: 'Asia/Shanghai',
    };
    // 固定时间点（用绝对时间戳避免依赖系统时钟）
    const { startInstant, targetInstant } = resolveCountdownInstants(cd);
    expect(startInstant).toBeLessThan(targetInstant);

    expect(computeCountdownState(startInstant - 1000, cd).status).toBe('not-started');
    expect(computeCountdownState(startInstant + 1000, cd).status).toBe('running');
    expect(computeCountdownState(targetInstant + 1000, cd).status).toBe('ended');
  });

  it('calendar duration 不使用 30 天=1 月的近似（跨月）', () => {
    const cd: CountdownData = {
      targetAmount: 1,
      targetDate: '2026-03-01',
      startDate: '2026-01-31',
      timezone: 'Asia/Shanghai',
    };
    // 2026-01-31 → 2026-03-01：1 个月 + 1 天（2 月 28 天），而非 30 天=1 个月
    const { startInstant } = resolveCountdownInstants(cd);
    const dur = countdownDuration(startInstant, cd);
    expect(dur.months).toBe(1);
    expect(dur.days).toBe(1);
  });

  it('时区差异影响倒计时（不同时区解析出不同绝对时间）', () => {
    // 2026-07-01（无 DST 切换）：纽约 EDT=UTC-4，上海 CST=UTC+8，相差 12 小时
    const ny: CountdownData = { targetAmount: 1, targetDate: '2026-07-01', startDate: '2026-07-01', timezone: 'America/New_York' };
    const sh: CountdownData = { targetAmount: 1, targetDate: '2026-07-01', startDate: '2026-07-01', timezone: 'Asia/Shanghai' };
    const nyT = resolveCountdownInstants(ny).targetInstant;
    const shT = resolveCountdownInstants(sh).targetInstant;
    expect(Math.abs(nyT - shT)).toBe(12 * 3600 * 1000);
  });

  it('formatCountdown 各格式', () => {
    const dur = { years: 1, months: 2, days: 16, hours: 8, minutes: 35, seconds: 42, totalDays: 441, totalHours: 10592 };
    expect(formatCountdown(dur, 'calendar', true)).toBe('1年 2个月 16天 08:35:42');
    expect(formatCountdown(dur, 'days', true)).toBe('441天 08:35:42');
    expect(formatCountdown(dur, 'hours')).toBe('10,592 小时');
    expect(formatCountdown(dur, 'simple')).toBe('441 天');
  });

  it('goalKey 随目标金额/时间变化', () => {
    const a = goalKey(1_000_000, 1000);
    const b = goalKey(1_000_000, 2000);
    const c = goalKey(2_000_000, 1000);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(goalKey(1_000_000, 1000)).toBe(a);
  });
});
