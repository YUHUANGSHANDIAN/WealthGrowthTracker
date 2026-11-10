/**
 * 品牌单一来源：当前用户可见产品名只能是 WealthGrowthTracker。
 * 历史 identifier、存储键、IndexedDB 名和备份格式属于兼容标识，见 docs/BRANDING.md。
 */
export const APP_BRAND = 'WealthGrowthTracker';
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
  productName: APP_BRAND,
} as const;

export function brandTitle(): string {
  return APP_BRAND;
}
