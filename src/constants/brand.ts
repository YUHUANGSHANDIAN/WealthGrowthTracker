/**
 * 品牌单一来源：用户可见名称与仓库 slug 从这里派生，避免继续到处硬编码旧 slug。
 * 内部标识（identifier、存储键、IndexedDB 库名、SW 缓存前缀、npm/Cargo 包名）保持不变，
 * 见 docs/BRANDING.md 的兼容白名单。
 */
export const APP_BRAND = 'WealthGrowthTracker';
export const APP_BRAND_ZH = '财富成长记';
export const APP_DESCRIPTION = '本地优先的个人财富管理与月度理财工作台';

/** 当前仓库 slug（改名后） */
export const APP_REPOSITORY = 'YUHUANGSHANDIAN/WealthGrowthTracker';
/** 改名前的 slug：更新检查失败时回退尝试（GitHub 对改名仓库提供 301 重定向） */
export const LEGACY_REPOSITORIES = ['YUHUANGSHANDIAN/wealth-growth-tracker'] as const;

export const UPDATE_CHECK_REPOSITORIES = [APP_REPOSITORY, ...LEGACY_REPOSITORIES] as const;

/** 子功能命名 */
export const PLANNER = {
  id: 'monthly',
  label: '月度理财',
  productName: 'WealthGrowthPlanner',
} as const;

export function brandTitle(): string {
  return `${APP_BRAND} · ${APP_BRAND_ZH}`;
}
