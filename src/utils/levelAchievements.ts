import type { HistoryPoint, LevelAchievement } from '../types';
import { WEALTH_LEVEL_DEFINITIONS } from '../constants/levels';

/**
 * 财富成长护照 / Level Achievement —— 记录首次真实跨越等级阈值的时间与金额。
 * - 历史回推：从 history 确定（取第一个达到阈值的日期，真实数据，非伪造）。
 * - 实时记录：真实金额编辑跨越阈值时写入 reachedAt = now。
 */

/** 从历史数据安全回推首次达到每个等级的时间（0 级「理财新手」不计入成就）。 */
export function deriveLevelAchievements(history: HistoryPoint[]): LevelAchievement[] {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: LevelAchievement[] = [];
  for (const def of WEALTH_LEVEL_DEFINITIONS) {
    if (def.minAmount <= 0) continue;
    const first = sorted.find((p) => p.totalAmount >= def.minAmount);
    if (first) {
      out.push({
        levelId: def.id,
        levelName: def.name,
        reachedAt: first.date,
        firstAmount: first.totalAmount,
      });
    }
  }
  return out;
}

/** 计算从 prevTotal 跨越到 newTotal 时新达成的等级成就（实时记录）。 */
export function crossedLevelAchievements(prevTotal: number, newTotal: number): LevelAchievement[] {
  const now = new Date().toISOString();
  const out: LevelAchievement[] = [];
  for (const def of WEALTH_LEVEL_DEFINITIONS) {
    if (def.minAmount <= 0) continue;
    if (prevTotal < def.minAmount && newTotal >= def.minAmount) {
      out.push({ levelId: def.id, levelName: def.name, reachedAt: now, firstAmount: newTotal });
    }
  }
  return out;
}

/** 合并成就（按 levelId 去重，保留最早的 reachedAt；纯函数、幂等）。 */
export function mergeLevelAchievements(existing: LevelAchievement[], incoming: LevelAchievement[]): LevelAchievement[] {
  const map = new Map<string, LevelAchievement>();
  for (const a of [...existing, ...incoming]) {
    const cur = map.get(a.levelId);
    if (!cur || (a.reachedAt < cur.reachedAt && !a.unknownTime)) {
      map.set(a.levelId, a);
    }
  }
  return [...map.values()].sort((a, b) => (a.reachedAt < b.reachedAt ? -1 : 1));
}
