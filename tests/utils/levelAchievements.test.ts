import { describe, it, expect } from 'vitest';
import {
  WEALTH_LEVELS,
  WEALTH_LEVEL_DEFINITIONS,
  WEALTH_THEMES,
  getLevelByAmount,
} from '../../src/constants/levels';
import {
  deriveLevelAchievements,
  crossedLevelAchievements,
  mergeLevelAchievements,
} from '../../src/utils/levelAchievements';
import type { HistoryPoint } from '../../src/types';

describe('财富等级架构（定义与主题解耦）', () => {
  it('定义与主题独立存在，且数量一致', () => {
    expect(WEALTH_LEVEL_DEFINITIONS).toHaveLength(8);
    expect(WEALTH_THEMES).toHaveLength(8);
    expect(WEALTH_LEVELS).toHaveLength(8);
  });

  it('8 级阈值保持不变', () => {
    expect(WEALTH_LEVELS.map((l) => l.minAmount)).toEqual([0, 10_000, 50_000, 100_000, 300_000, 500_000, 800_000, 1_000_000]);
  });

  it('高财富等级不再使用红色主色（金融语义）', () => {
    expect(getLevelByAmount(300_000).theme).toBe('bronze-gold');
    expect(getLevelByAmount(500_000).theme).toBe('navy-gold');
    const steward = getLevelByAmount(300_000).tokens.primary;
    const expert = getLevelByAmount(500_000).tokens.primary;
    // 不是 crimson/red 系
    for (const c of [steward, expert]) {
      expect(['#9F1239', '#B91C1C', '#EF4444', '#E11D48']).not.toContain(c);
    }
  });
});

describe('等级成就', () => {
  it('从历史回推首次达到时间', () => {
    const history: HistoryPoint[] = [
      { date: '2026-01-02', totalAmount: 2000 },
      { date: '2026-03-12', totalAmount: 12_000 },
      { date: '2026-06-30', totalAmount: 55_000 },
    ];
    const a = deriveLevelAchievements(history);
    expect(a.find((x) => x.levelId === 'saver')?.reachedAt).toBe('2026-03-12');
    expect(a.find((x) => x.levelId === 'apprentice')?.reachedAt).toBe('2026-06-30');
    expect(a.find((x) => x.levelId === 'novice')).toBeUndefined(); // 0 级不计入
  });

  it('实时跨越检测', () => {
    const crossed = crossedLevelAchievements(9_000, 12_000);
    expect(crossed).toHaveLength(1);
    expect(crossed[0]!.levelId).toBe('saver');
    expect(crossed[0]!.firstAmount).toBe(12_000);
  });

  it('合并成就幂等（按 levelId 去重）', () => {
    const a = deriveLevelAchievements([{ date: '2026-03-12', totalAmount: 12_000 }]);
    const merged = mergeLevelAchievements(a, a);
    expect(merged).toHaveLength(a.length);
    expect(merged).toEqual(a);
  });
});
