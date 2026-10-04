import { describe, it, expect } from 'vitest';
import type { CountdownData } from '../../src/types';
import { countdownToGoal, countdownFromGoal, validateGoal, goalStatusOf, goalAmountProgress } from '../../src/utils/goals';

const legacy: CountdownData = {
  targetAmount: 1_000_000,
  targetDate: '2028-12-31',
  startDate: '2026-01-01',
  targetName: '第一个一百万',
  timezone: 'Asia/Shanghai',
  displayMode: 'calendar',
  showSeconds: true,
};

describe('Goals V2', () => {
  it('旧 countdown 迁移为单个主目标', () => {
    const g = countdownToGoal(legacy);
    expect(g.targetAmount).toBe(1_000_000);
    expect(g.name).toBe('第一个一百万');
    expect(g.targetDateTime.slice(0, 10)).toBe('2028-12-31');
    expect(g.timezone).toBe('Asia/Shanghai');
  });

  it('迁移幂等：相同 countdown 得到相同 id（不重复）', () => {
    const a = countdownToGoal(legacy);
    const b = countdownToGoal(legacy);
    expect(a.id).toBe(b.id);
  });

  it('Goal ↔ CountdownData 往返一致', () => {
    const g = countdownToGoal(legacy);
    const cd = countdownFromGoal(g);
    expect(cd.targetAmount).toBe(legacy.targetAmount);
    expect(cd.targetDate).toBe(legacy.targetDate);
    expect(cd.targetName).toBe(legacy.targetName);
    expect(cd.timezone).toBe(legacy.timezone);
    expect(cd.displayMode).toBe(legacy.displayMode);
  });

  it('validateGoal 校验金额/时间/时区', () => {
    expect(validateGoal({ targetAmount: 0, startDateTime: '2026-01-01T00:00', targetDateTime: '2028-01-01T00:00', timezone: 'Asia/Shanghai' }).ok).toBe(false);
    expect(validateGoal({ targetAmount: 1000, startDateTime: '2028-01-01T00:00', targetDateTime: '2026-01-01T00:00', timezone: 'Asia/Shanghai' }).ok).toBe(false);
    expect(validateGoal({ targetAmount: 1000, startDateTime: '2026-01-01T00:00', targetDateTime: '2028-01-01T00:00', timezone: 'Not/AZone' }).ok).toBe(false);
    expect(validateGoal({ targetAmount: 1000, startDateTime: '2026-01-01T00:00', targetDateTime: '2028-01-01T00:00', timezone: 'Asia/Shanghai' }).ok).toBe(true);
  });

  it('状态判定：Achieved 优先于 Expired，Archived 优先', () => {
    const base = countdownToGoal(legacy);
    const now = Date.parse('2027-01-01T00:00:00Z');
    expect(goalStatusOf(base, now, 2_000_000)).toBe('achieved'); // 已达金额
    expect(goalStatusOf(base, now, 10_000)).toBe('active');
    const expired = goalStatusOf(base, Date.parse('2030-01-01T00:00:00Z'), 10_000);
    expect(expired).toBe('expired');
    expect(goalStatusOf({ ...base, status: 'archived' }, now, 10_000)).toBe('archived');
  });

  it('金额进度', () => {
    expect(goalAmountProgress(500_000, 1_000_000)).toBe(50);
    expect(goalAmountProgress(2_000_000, 1_000_000)).toBe(100);
  });
});
