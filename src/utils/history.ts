import type { HistoryPoint } from '../types';

/**
 * History Domain（v1.6）：一天只能有一条 HistoryPoint。
 * 这个 Domain Invariant 不只在 UI 层保证，任何 Import / Migration / Report Snapshot /
 * Manual Add 都必须经过这里。
 */

export interface HistoryUpsertResult {
  /** true = 无冲突，已写入；false = 同日期已存在，未写入（返回 existing 供 UI 展示）。 */
  ok: boolean;
  history: HistoryPoint[];
  existing?: HistoryPoint;
}

/** 准备写入一个历史点：同日期已存在则返回冲突（不静默覆盖）。 */
export function prepareHistoryUpsert(history: HistoryPoint[], incoming: HistoryPoint): HistoryUpsertResult {
  const existing = history.find((h) => h.date === incoming.date);
  if (existing) {
    return { ok: false, history, existing };
  }
  const next = [...history.filter((h) => h.date !== incoming.date), incoming].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ok: true, history: next };
}

/** 覆盖写历史点（同日期唯一，覆盖已有，日期升序）。 */
export function overwriteHistoryPoint(history: HistoryPoint[], incoming: HistoryPoint): HistoryPoint[] {
  return [...history.filter((h) => h.date !== incoming.date), incoming].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 检测历史中的重复日期（返回所有重复的日期）。 */
export function duplicateHistoryDates(history: HistoryPoint[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const h of history) {
    if (seen.has(h.date)) dups.add(h.date);
    seen.add(h.date);
  }
  return [...dups];
}
