/**
 * Visual Metadata Registry（v1.5）：集中管理全应用语义化 Emoji / 图标 / 颜色，
 * 拆分为多个独立 registry，避免同一 Emoji 表示多个不同概念，语义清晰。
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
export const ACTION_META: Record<string, string> = {
  backup: '🛟',
  health: '🩺',
  import: '📥',
  export: '📤',
  share: '🔗',
  archive: '🗃️',
  edit: '✏️',
  delete: '🗑️',
  repair: '🧰',
  migrate: '🔄',
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
  inject: '➕',
  withdraw: '↩️',
  prize: '🎫➡️💰',
  stake: '🎫',
  pool: '💼',
};

/** 向后兼容别名（旧代码仍引用 ACTION_ICONS）。 */
export const ACTION_ICONS = ACTION_META;

/** 报告相关语义（类型 / 动作）。 */
export const REPORT_META = {
  type: {
    weekly: { label: '周报', icon: '📅' },
    monthly: { label: '月报', icon: '🗓️' },
    yearly: { label: '年报', icon: '📚' },
  },
  history: '🕰️',
  composition: '🧩',
  dataAsOf: '🕰️',
} as const;

/** 渠道默认 Emoji 建议（新建渠道时；用户自选 Emoji 优先）。 */
export const CHANNEL_SUGGESTIONS: { name: string; emoji: string }[] = [
  { name: '支付宝', emoji: '💙' },
  { name: '微信', emoji: '💚' },
  { name: '银行卡', emoji: '🏛️' },
  { name: '京东金融', emoji: '💼' },
  { name: '钱包', emoji: '👛' },
  { name: '现金', emoji: '💵' },
  { name: '基金', emoji: '📊' },
  { name: '股票', emoji: '📈' },
  { name: '黄金', emoji: '🥇' },
  { name: '其他', emoji: '💰' },
];

/** 彩票相关语义。 */
export const LOTTERY_META = {
  pool: '💼',
  prize: '🎫➡️💰',
  stake: '🎫',
} as const;

/** 彩票项目类别。 */
export const LOTTERY_CATEGORY_META: Record<string, { label: string; icon: string }> = {
  'sports-football': { label: '竞彩足球', icon: '⚽' },
  lotto: { label: '大乐透', icon: '🎱' },
  other: { label: '其它彩票', icon: '🎟️' },
};

/** 彩票交易类型。 */
export const LOTTERY_TX_META: Record<string, { label: string; icon: string }> = {
  'capital-injection': { label: '资金注入', icon: '➕' },
  'capital-withdrawal': { label: '资金取出', icon: '↩️' },
  stake: { label: '投注支出', icon: '🎫' },
  prize: { label: '中奖收入', icon: '🎫➡️💰' },
  adjustment: { label: '余额调整', icon: '🔧' },
};

/**
 * 语义色规范（v1.5）：Positive 绿 / Negative 红 / Warning 琥珀 / Info 蓝 / Neutral Slate。
 * 财富等级主题色仅用于品牌/Hero/Accent，绝不覆盖这些数据语义色。
 */
export const SEMANTIC_COLORS = {
  positive: '#10B981',
  negative: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  neutral: '#64748B',
} as const;

/** 状态语义（图标 + 语义色 key）。 */
export const STATUS_META = {
  positive: { label: '增长', icon: '▲', color: SEMANTIC_COLORS.positive },
  negative: { label: '下降', icon: '▼', color: SEMANTIC_COLORS.negative },
  neutral: { label: '持平', icon: '—', color: SEMANTIC_COLORS.neutral },
  warning: { label: '警告', icon: '⚠️', color: SEMANTIC_COLORS.warning },
  info: { label: '信息', icon: 'ℹ️', color: SEMANTIC_COLORS.info },
} as const;

export function featureIcon(id: string): string {
  return (FEATURE_META as Record<string, FeatureMeta | undefined>)[id]?.icon ?? ACTION_META[id] ?? '📄';
}
