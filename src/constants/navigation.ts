import type { FinanceTaskKind } from '../domain/portfolio/types';
import type { MainSectionId, TabId } from '../store/navigationStore';

export interface MainNavItem {
  id: MainSectionId;
  label: string;
  defaultTab: TabId;
}

export interface SecondaryNavItem {
  label: string;
  tab: TabId;
  financeTaskKind?: FinanceTaskKind;
  settingsSection?: 'ai' | 'storage';
}

export const MAIN_NAV_ITEMS: readonly MainNavItem[] = [
  { id: 'overview', label: '总览', defaultTab: 'overview' },
  { id: 'assets', label: '资产', defaultTab: 'assets' },
  { id: 'finance', label: '理财', defaultTab: 'monthly' },
  { id: 'review', label: '复盘', defaultTab: 'history' },
  { id: 'planning', label: '规划', defaultTab: 'goals' },
  { id: 'lottery', label: '彩票', defaultTab: 'lottery' },
  { id: 'settings', label: '设置', defaultTab: 'settings' },
];

export const SECONDARY_NAV_ITEMS: Readonly<Record<MainSectionId, readonly SecondaryNavItem[]>> = {
  overview: [],
  assets: [{ label: '渠道持仓', tab: 'assets' }],
  finance: [
    { label: '初始对账', tab: 'monthly', financeTaskKind: 'initial-reconciliation' },
    { label: '月度复盘', tab: 'monthly', financeTaskKind: 'monthly-review' },
    { label: '临时调仓', tab: 'monthly', financeTaskKind: 'ad-hoc-rebalance' },
    { label: '基金分析', tab: 'monthly', financeTaskKind: 'fund-analysis' },
    { label: '止盈审查', tab: 'monthly', financeTaskKind: 'take-profit-review' },
    { label: '市场情报', tab: 'monthly', financeTaskKind: 'market-intelligence' },
    { label: '专项研究', tab: 'monthly', financeTaskKind: 'special-research' },
  ],
  review: [
    { label: '历史记录', tab: 'history' },
    { label: '财务报告', tab: 'reports' },
    { label: '资产历史趋势', tab: 'analysis' },
  ],
  planning: [
    { label: '目标管理', tab: 'goals' },
    { label: '情景预测', tab: 'prediction' },
  ],
  lottery: [{ label: '彩票管理', tab: 'lottery' }],
  settings: [
    { label: '偏好设置', tab: 'settings' },
    { label: '模型连接', tab: 'ai', settingsSection: 'ai' },
    { label: '数据维护', tab: 'data', settingsSection: 'storage' },
  ],
};

export const MOBILE_PRIMARY_ITEMS = MAIN_NAV_ITEMS.slice(0, 5);
export const MOBILE_MORE_ITEMS = MAIN_NAV_ITEMS.slice(5);
