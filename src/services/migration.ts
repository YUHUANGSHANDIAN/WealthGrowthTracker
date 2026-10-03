import type { Channel } from '../types';

/**
 * 数据迁移管道：随 schema 版本升级运行，幂等且只运行一次（由 app_version 检测触发）。
 * 顺序：1.0.0 → 1.1.0 → 1.2.0（历史快照为 1.1.0 引入，校园卡学校为 1.2.0 引入）。
 */

/** v1.2 校园卡新增的默认学校（稳定 ID，供迁移去重）。 */
export const CAMPUS_SCHOOLS = [
  { id: 'campus_card_dlut', name: '大连理工大学', emoji: '🎓', color: '#06B6D4' },
  { id: 'campus_card_tju', name: '天津大学', emoji: '🏫', color: '#0EA5E9' },
  { id: 'campus_card_fudan', name: '复旦大学', emoji: '📚', color: '#6366F1' },
] as const;

/**
 * v1.1 → v1.2：若「校园卡」父渠道存在，则补充三所默认学校（缺失的才添加）。
 * - 用户已删除整个校园卡 → 不重建。
 * - 已有部分学校 → 只补缺失的。
 * - 幂等：重复运行不会产生重复项。
 */
export function migrateChannelsV12(channels: Channel[]): { channels: Channel[]; added: number } {
  const campus = channels.find((c) => c.id === 'campus_card');
  if (!campus) return { channels, added: 0 };

  const children = campus.children ?? [];
  const existingIds = new Set(children.map((s) => s.id));
  const missing = CAMPUS_SCHOOLS.filter((s) => !existingIds.has(s.id));
  if (missing.length === 0) return { channels, added: 0 };

  const added = missing.map((s) => ({ ...s, amount: 0, parentId: 'campus_card' }));
  const updated = channels.map((c) =>
    c.id === 'campus_card' ? { ...c, children: [...(c.children ?? []), ...added] } : c,
  );
  return { channels: updated, added: added.length };
}

/** 判断版本是否需要触发迁移（fromVersion 低于 1.2.0）。 */
export function needsV12Migration(fromVersion: string | null): boolean {
  if (!fromVersion) return true; // 旧版本未记录版本号，按需要迁移处理
  const toNum = (v: string) => {
    const parts = v.replace(/[^0-9.]/g, '').split('.').map(Number);
    return (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1000 + (parts[2] ?? 0);
  };
  return toNum(fromVersion) < toNum('1.2.0');
}
