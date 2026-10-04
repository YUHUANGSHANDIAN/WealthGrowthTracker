/**
 * 存储键常量 —— 与灵光旧版逐字对齐，是数据兼容的核心契约。
 *
 * 旧版通过 lingguang.storage 以这些 key 读写数据；新版在浏览器中用 localStorage
 * 复用同样的 key，从而：
 *  1. 在灵光环境内运行时，可无缝读写同一份数据；
 *  2. 用户从旧版「导出 JSON → 新版导入」时，字段结构与这些 key 下的值保持一致。
 */
export const STORAGE_KEYS = {
  wealthTrackerData: 'wealth_tracker_data',
  wealthTrackerHistory: 'wealth_tracker_history',
  financialReports: 'financial_reports',
  customSortRules: 'custom_sort_rules',
  sortHistory: 'sort_history',
  sortConfig: 'sort_config',
  reportSortSettings: 'report_sort_settings',
  smartSortConfig: 'smart_sort_config',
  userProfile: 'user_profile',
  appearanceSettings: 'appearance_settings',
  authData: 'auth_data',
  chartSettings: 'chart_settings',
  countdownData: 'countdown_data',
  countdownOpacity: 'countdown_opacity',
  coinRainConfig: 'coin_rain_config',
  countdownProgressHistory: 'countdown_progress_history',
  currentWealthLevel: 'current_wealth_level',
  goalAchievementStatus: 'goal_achievement_status',
  timeRangeHistory: 'time_range_history',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
