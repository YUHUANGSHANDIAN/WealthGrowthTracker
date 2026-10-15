import type { TabId } from '../store/navigationStore';

export const NAV_ITEMS = [
  { id: 'overview', label: '总览' },
  { id: 'assets', label: '资产' },
  { id: 'history', label: '历史' },
  { id: 'reports', label: '报告' },
  { id: 'analysis', label: '分析' },
  { id: 'monthly', label: '月度理财' },
  { id: 'prediction', label: '预测' },
  { id: 'goals', label: '目标' },
  { id: 'lottery', label: '彩票' },
  { id: 'data', label: '数据中心' },
  { id: 'ai', label: '模型连接' },
  { id: 'settings', label: '设置' },
] satisfies readonly { id: TabId; label: string }[];

export const MOBILE_PRIMARY_TAB_IDS = ['overview', 'assets', 'history', 'reports', 'analysis'] as const;

const mobilePrimaryTabs = new Set<TabId>(MOBILE_PRIMARY_TAB_IDS);

export const MOBILE_PRIMARY_ITEMS = NAV_ITEMS.filter(({ id }) => mobilePrimaryTabs.has(id));
export const MOBILE_MORE_ITEMS = NAV_ITEMS.filter(({ id }) => !mobilePrimaryTabs.has(id));
