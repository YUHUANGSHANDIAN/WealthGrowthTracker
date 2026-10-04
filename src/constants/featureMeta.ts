/**
 * Feature Icon Registry（v1.4）：集中管理全应用语义化 Emoji / 图标，
 * 避免同一 Emoji 在不同功能中出现，确保语义清晰。
 * Emoji 永远是 aria-hidden 的装饰，不能是唯一信息来源。
 */

export interface FeatureMeta {
  id: string;
  label: string;
  icon: string;
}

/** 顶级功能 Tab。 */
export const FEATURE_META = {
  assets: { id: 'assets', label: '资产', icon: '💰' },
  history: { id: 'history', label: '历史', icon: '🕰️' },
  reports: { id: 'reports', label: '报告', icon: '📑' },
  analysis: { id: 'analysis', label: '分析', icon: '📊' },
  prediction: { id: 'prediction', label: '预测', icon: '🔭' },
  goals: { id: 'goals', label: '目标', icon: '🎯' },
  lottery: { id: 'lottery', label: '彩票', icon: '🎟️' },
  data: { id: 'data', label: '数据', icon: '🗄️' },
  settings: { id: 'settings', label: '设置', icon: '⚙️' },
} satisfies Record<string, FeatureMeta>;

/** 通用动作图标（语义统一）。 */
export const ACTION_ICONS: Record<string, string> = {
  backup: '🛟',
  health: '🩺',
  import: '📥',
  export: '📤',
  share: '🔗',
  archive: '🗃️',
  edit: '✏️',
  delete: '🗑️',
  repair: '🧰',
  calendar: '📅',
  'trend-up': '📈',
  'trend-down': '📉',
  achievement: '🏅',
  add: '＋',
  search: '🔍',
  refresh: '🔄',
  'coin-rain': '🪙',
  'level-up': '🏆',
  'goal-reached': '🎉',
  inject: '➕💰',
  withdraw: '↩️💰',
  prize: '🎫➡️💰',
  stake: '🎫',
  pool: '🪙',
};

/** 彩票项目类别。 */
export const LOTTERY_CATEGORY_META: Record<string, { label: string; icon: string }> = {
  'sports-football': { label: '竞彩足球', icon: '⚽' },
  lotto: { label: '大乐透', icon: '🎱' },
  other: { label: '其它彩票', icon: '🎟️' },
};

/** 彩票交易类型。 */
export const LOTTERY_TX_META: Record<string, { label: string; icon: string }> = {
  'capital-injection': { label: '资金注入', icon: '➕💰' },
  'capital-withdrawal': { label: '资金取出', icon: '↩️💰' },
  stake: { label: '投注支出', icon: '🎫' },
  prize: { label: '中奖收入', icon: '🎫➡️💰' },
  adjustment: { label: '余额调整', icon: '🔧' },
};

export function featureIcon(id: string): string {
  return (FEATURE_META as Record<string, FeatureMeta | undefined>)[id]?.icon ?? ACTION_ICONS[id] ?? '📄';
}
