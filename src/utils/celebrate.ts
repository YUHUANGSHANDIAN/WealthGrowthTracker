import type { CountdownData, GoalAchievementStatus } from '../types';
import { getLevelByAmount, getLevelIndex } from '../constants/levels';
import { goalKey, resolveCountdownInstants } from './countdown';

/** 一次庆祝事件。 */
export interface CelebrationEvent {
  id: string;
  /** 是否同时达到目标。 */
  goal: boolean;
  /** 是否发生等级升级。 */
  levelUp: boolean;
  fromLevel?: string;
  toLevel: string;
  /** 跳过的等级数（1 = 只升一级）。 */
  skippedLevels: number;
  badge: string;
  targetAmount?: number;
}

/**
 * 检测从 prevTotal 到 newTotal 的资产变化应触发哪些庆祝。
 * - 仅等级上升（newIdx > oldIdx）触发 Level Up。
 * - 仅「跨越 total < target → total >= target」且 goalKey 变化时触发 Goal（避免重复）。
 * - 导入/重启不会调用此函数，因此不会重复播放庆祝。
 */
export function detectCelebrations(
  prevTotal: number,
  newTotal: number,
  countdown: CountdownData,
  goalAchieved: GoalAchievementStatus,
): { event: CelebrationEvent | null; newGoalAchieved?: GoalAchievementStatus } {
  const prevLevel = getLevelByAmount(prevTotal);
  const newLevel = getLevelByAmount(newTotal);
  const prevIdx = getLevelIndex(prevLevel);
  const newIdx = getLevelIndex(newLevel);
  const levelUp = newIdx > prevIdx;

  const target = countdown.targetAmount;
  const goalCrossed = target > 0 && prevTotal < target && newTotal >= target;
  let newGoalAchieved: GoalAchievementStatus | undefined;

  if (goalCrossed) {
    const key = goalKey(target, resolveCountdownInstants(countdown).targetInstant);
    if (goalAchieved.goalKey !== key) {
      newGoalAchieved = {
        hasAchievedGoal: true,
        goalKey: key,
        achievedAt: new Date().toISOString(),
        achievedTargetAmount: target,
      };
    }
  }

  const goalFired = !!newGoalAchieved;

  if (!levelUp && !goalFired) return { event: null };

  return {
    newGoalAchieved,
    event: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      goal: goalFired,
      levelUp,
      fromLevel: levelUp ? prevLevel.name : undefined,
      toLevel: newLevel.name,
      skippedLevels: levelUp ? newIdx - prevIdx : 0,
      badge: newLevel.badge,
      ...(goalFired ? { targetAmount: target } : {}),
    },
  };
}
