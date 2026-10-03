import { describe, it, expect } from 'vitest';
import { WEALTH_LEVELS, getLevelByAmount, getNextLevel, getLevelIndex } from '../../src/constants/levels';

describe('财富等级边界', () => {
  const cases: [number, string][] = [
    [0, '理财新手'],
    [9_999, '理财新手'],
    [10_000, '储蓄达人'],
    [49_999, '储蓄达人'],
    [50_000, '财富学徒'],
    [99_999, '财富学徒'],
    [100_000, '投资能手'],
    [299_999, '投资能手'],
    [300_000, '财富管家'],
    [499_999, '财富管家'],
    [500_000, '投资专家'],
    [799_999, '投资专家'],
    [800_000, '财富大师'],
    [999_999, '财富大师'],
    [1_000_000, '百万富翁'],
  ];

  for (const [amount, name] of cases) {
    it(`${amount} → ${name}`, () => {
      expect(getLevelByAmount(amount).name).toBe(name);
    });
  }

  it('8 个等级都有独立 Theme Token', () => {
    expect(WEALTH_LEVELS).toHaveLength(8);
    for (const l of WEALTH_LEVELS) {
      expect(l.tokens.primary).toBeTruthy();
      expect(l.tokens.heroGradient).toBeTruthy();
      expect(l.tokens.progressGradient).toBeTruthy();
    }
  });

  it('getNextLevel 返回下一级，最高级返回 null', () => {
    expect(getNextLevel(WEALTH_LEVELS[0]!)?.name).toBe('储蓄达人');
    expect(getNextLevel(WEALTH_LEVELS[7]!)).toBeNull();
  });

  it('getLevelIndex 稳定', () => {
    expect(getLevelIndex(WEALTH_LEVELS[0]!)).toBe(0);
    expect(getLevelIndex(WEALTH_LEVELS[7]!)).toBe(7);
  });
});
