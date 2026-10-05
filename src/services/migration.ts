import type { Channel, FinancialReport } from '../types';
import { normalizeAndReport, REPORT_SCHEMA_VERSION } from '../features/reports/normalize';

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

/** 版本号 → 可比较的整数（主/次/补丁）。 */
function versionToNum(v: string): number {
  const parts = v.replace(/[^0-9.]/g, '').split('.').map(Number);
  return (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1000 + (parts[2] ?? 0);
}

/** 判断版本是否需要触发迁移（fromVersion 低于 1.2.0）。 */
export function needsV12Migration(fromVersion: string | null): boolean {
  if (!fromVersion) return true; // 旧版本未记录版本号，按需要迁移处理
  return versionToNum(fromVersion) < versionToNum('1.2.0');
}

// ---------------------------------------------------------------------------
// v1.4 → v1.5：京东金融父渠道 + 默认子渠道（幂等）
// ---------------------------------------------------------------------------

/** 京东金融父渠道默认元数据（稳定 ID，供迁移去重）。 */
export const JD_FINANCE = {
  id: 'jd_finance',
  name: '京东金融',
  emoji: '💼',
  color: '#F43F5E',
} as const;

/** 京东金融默认子渠道（稳定 ID，供迁移去重）。 */
export const JD_FINANCE_CHILDREN = [
  { id: 'jd_jinku', name: '京东小金库', emoji: '🪙', color: '#F59E0B' },
  { id: 'jd_fund', name: '基金', emoji: '📊', color: '#3B82F6' },
  { id: 'jd_stock', name: '股票', emoji: '📈', color: '#06B6D4' },
  { id: 'jd_gold', name: '黄金', emoji: '🥇', color: '#D97706' },
  { id: 'jd_huoqian', name: '京东活钱+', emoji: '💵', color: '#10B981' },
] as const;

/** 规范化名称（用于识别用户手工创建的「京东金融」，去空格、小写）。 */
function normalizedName(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/**
 * v1.4 → v1.5：新增京东金融父渠道及其默认子渠道（幂等，仅升级时运行一次）。
 * - 完全没有「京东金融」→ 新增父渠道（含默认子渠道）。
 * - 用户已手工创建「京东金融」→ 通过规范化名称识别，不重复创建父渠道。
 * - 已有京东金融 → 只补齐缺失的默认子渠道（按规范化名称去重）。
 * - 已有同名子渠道 → 保留 id / 金额 / 用户 Emoji / 用户颜色，绝不覆盖。
 */
export function migrateChannelsV15(channels: Channel[]): { channels: Channel[]; addedParent: number; addedChildren: number } {
  let next = channels;
  let jd = channels.find((c) => c.isParent && normalizedName(c.name) === normalizedName(JD_FINANCE.name));

  let addedParent = 0;
  if (!jd) {
    const now = new Date().toISOString();
    jd = {
      id: JD_FINANCE.id,
      name: JD_FINANCE.name,
      emoji: JD_FINANCE.emoji,
      amount: 0,
      color: JD_FINANCE.color,
      isParent: true,
      isExpanded: false,
      createdAt: now,
      updatedAt: now,
      children: [],
    };
    next = [...next, jd];
    addedParent = 1;
  }

  // 补齐缺失子渠道（按规范化名称识别，保留已有子渠道）
  const children = jd.children ?? [];
  const existingNames = new Set(children.map((s) => normalizedName(s.name)));
  const missing = JD_FINANCE_CHILDREN.filter((s) => !existingNames.has(normalizedName(s.name)));
  if (missing.length > 0) {
    const appended = missing.map((s) => ({ ...s, amount: 0, parentId: jd!.id }));
    next = next.map((c) => (c.id === jd!.id ? { ...c, children: [...(c.children ?? []), ...appended] } : c));
  }

  return { channels: next, addedParent, addedChildren: missing.length };
}

/** 判断版本是否需要触发 v1.5 迁移（fromVersion 低于 1.5.0）。 */
export function needsV15Migration(fromVersion: string | null): boolean {
  if (!fromVersion) return true;
  return versionToNum(fromVersion) < versionToNum('1.5.0');
}

/**
 * v1.2 → v1.3：财务报告规范化迁移（幂等）。
 * 对旧报告补 periodKey / title / ISO week / wealthLevel / topChannels / completeness / schemaVersion；
 * 绝不编造历史渠道构成与期间极值。返回 { reports, changed }。
 */
export function migrateReportsV13(reports: FinancialReport[]): { reports: FinancialReport[]; changed: number } {
  return normalizeAndReport(reports);
}

/** 当前报告 schema 版本（供测试与设置「关于」展示）。 */
export { REPORT_SCHEMA_VERSION };
