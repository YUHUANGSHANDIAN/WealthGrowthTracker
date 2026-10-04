import type { CountdownData, Goal, GoalStatus } from '../types';
import { getDefaultTimezone, resolveCountdownInstants } from './countdown';
import { randomId } from './id';

/**
 * Goals V2 工具：CountdownData → Goal 迁移、Goal → CountdownData 派生、状态判定、校验。
 */

/** v1.2 CountdownData → v1.3 主目标（幂等：多次迁移得到等价目标，id 由目标内容派生避免重复）。 */
export function countdownToGoal(cd: CountdownData): Goal {
  const now = new Date().toISOString();
  const timezone = cd.timezone || getDefaultTimezone();
  const startDateTime = cd.startDateTime ?? `${cd.startDate}T00:00`;
  const targetDateTime = cd.targetDateTime ?? `${cd.targetDate}T00:00`;
  return {
    id: `goal_${cd.targetAmount}_${targetDateTime}`.replace(/[^a-zA-Z0-9_]/g, '_'),
    name: cd.targetName?.trim() || '财富目标',
    icon: '🎯',
    targetAmount: cd.targetAmount,
    startDateTime,
    targetDateTime,
    timezone,
    displayMode: cd.displayMode ?? 'calendar',
    status: 'active',
    priority: 0,
    color: '#3B82F6',
    showSeconds: cd.showSeconds ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Goal → CountdownData（用于向后兼容导出 / 庆祝检测 / 倒计时展示）。 */
export function countdownFromGoal(goal: Goal): CountdownData {
  return {
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDateTime.slice(0, 10),
    startDate: goal.startDateTime.slice(0, 10),
    targetName: goal.name,
    timezone: goal.timezone,
    startDateTime: goal.startDateTime,
    targetDateTime: goal.targetDateTime,
    displayMode: goal.displayMode,
    showSeconds: goal.showSeconds,
  };
}

/** 计算目标状态（Achieved 优先于 Expired；不自动归档）。 */
export function goalStatusOf(goal: Goal, now: number, totalAmount: number): GoalStatus {
  if (goal.status === 'archived') return 'archived';
  if (goal.targetAmount > 0 && totalAmount >= goal.targetAmount) return 'achieved';
  const { startInstant, targetInstant } = resolveCountdownInstants(countdownFromGoal(goal));
  if (now >= targetInstant) return 'expired';
  if (now < startInstant) return 'not-started';
  return 'active';
}

export interface GoalValidation {
  ok: boolean;
  errors: string[];
}

/** 目标校验（金额 > 0、target > start、IANA 时区合法）。 */
export function validateGoal(input: {
  targetAmount: number;
  startDateTime: string;
  targetDateTime: string;
  timezone: string;
}): GoalValidation {
  const errors: string[] = [];
  if (!Number.isFinite(input.targetAmount) || input.targetAmount <= 0) errors.push('目标金额必须大于 0');
  if (input.targetDateTime <= input.startDateTime) errors.push('目标时间必须晚于起始时间');
  if (!isValidTimezone(input.timezone)) errors.push('时区无效');
  return { ok: errors.length === 0, errors };
}

/** IANA 时区合法性校验。 */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    const supported = typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
      ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
      : null;
    if (supported) return supported.includes(tz);
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 金额进度 0-100。 */
export function goalAmountProgress(total: number, target: number): number {
  return target > 0 ? Math.min(100, (total / target) * 100) : 0;
}

/** 新建目标。 */
export function makeGoal(partial: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return {
    id: randomId('goal'),
    name: '财富目标',
    icon: '🎯',
    targetAmount: 1_000_000,
    startDateTime: `${new Date().toISOString().slice(0, 10)}T00:00`,
    targetDateTime: `${new Date().toISOString().slice(0, 10)}T00:00`,
    timezone: getDefaultTimezone(),
    displayMode: 'calendar',
    status: 'active',
    priority: 0,
    color: '#3B82F6',
    showSeconds: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
