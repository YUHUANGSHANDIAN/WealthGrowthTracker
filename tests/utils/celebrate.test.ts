import { describe, it, expect } from 'vitest';
import { detectCelebrations } from '../../src/utils/celebrate';
import type { CountdownData } from '../../src/types';

const countdown: CountdownData = { targetAmount: 1_000_000, targetDate: '2026-12-31', startDate: '2026-01-01', timezone: 'Asia/Shanghai' };

describe('庆祝检测', () => {
  it('一次升一级触发 level-up，skippedLevels=1', () => {
    const { event } = detectCelebrations(5_000, 15_000, countdown, { hasAchievedGoal: false });
    expect(event?.levelUp).toBe(true);
    expect(event?.skippedLevels).toBe(1);
    expect(event?.fromLevel).toBe('理财新手');
    expect(event?.toLevel).toBe('储蓄达人');
    expect(event?.goal).toBe(false);
  });

  it('一次跨三级 skippedLevels=3', () => {
    const { event } = detectCelebrations(5_000, 150_000, countdown, { hasAchievedGoal: false });
    expect(event?.skippedLevels).toBe(3);
    expect(event?.toLevel).toBe('投资能手');
  });

  it('资产下降不触发庆祝', () => {
    const { event } = detectCelebrations(60_000, 5_000, countdown, { hasAchievedGoal: false });
    expect(event).toBeNull();
  });

  it('目标跨越触发 goal + goalKey 防止重复', () => {
    const r1 = detectCelebrations(900_000, 1_000_000, countdown, { hasAchievedGoal: false });
    expect(r1.event?.goal).toBe(true);
    expect(r1.newGoalAchieved?.goalKey).toBeTruthy();

    // 已达成且 goalKey 相同 → 不再重复
    const r2 = detectCelebrations(950_000, 1_100_000, countdown, r1.newGoalAchieved!);
    expect(r2.event?.goal).toBe(false);
  });

  it('修改目标金额后（goalKey 变化）可重新检测', () => {
    const r1 = detectCelebrations(900_000, 1_000_000, countdown, { hasAchievedGoal: false });
    const changed: CountdownData = { ...countdown, targetAmount: 2_000_000 };
    const r2 = detectCelebrations(900_000, 1_000_000, changed, r1.newGoalAchieved!);
    // goalKey 不同（目标金额变了），但本次未跨越 2,000,000，故不触发
    expect(r2.event?.goal).toBe(false);
  });
});
