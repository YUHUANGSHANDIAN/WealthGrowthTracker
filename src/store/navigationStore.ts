import { create } from 'zustand';
import { isSettingsSection, type SettingsSectionId } from '../constants/settings';
import type { FinanceTaskKind } from '../domain/portfolio/types';

export const TAB_IDS = ['overview', 'assets', 'history', 'reports', 'analysis', 'monthly', 'prediction', 'goals', 'lottery', 'data', 'ai', 'settings'] as const;
export type TabId = typeof TAB_IDS[number];

export const MAIN_SECTION_IDS = ['overview', 'assets', 'finance', 'review', 'planning', 'lottery', 'settings'] as const;
export type MainSectionId = typeof MAIN_SECTION_IDS[number];

const FINANCE_TASK_KINDS: readonly FinanceTaskKind[] = [
  'initial-reconciliation', 'monthly-review', 'ad-hoc-rebalance', 'fund-analysis',
  'take-profit-review', 'market-intelligence', 'special-research',
];

const SECTION_OF_TAB: Readonly<Record<TabId, MainSectionId>> = {
  overview: 'overview', assets: 'assets', monthly: 'finance',
  history: 'review', reports: 'review', analysis: 'review',
  goals: 'planning', prediction: 'planning', lottery: 'lottery',
  data: 'settings', ai: 'settings', settings: 'settings',
};

export function sectionForTab(tab: TabId): MainSectionId {
  return SECTION_OF_TAB[tab];
}

export interface Route {
  tab: TabId;
  reportId?: string;
  channelId?: string;
  lotteryProjectId?: string;
  goalId?: string;
  startDate?: string;
  endDate?: string;
  historyDate?: string;
  healthFilter?: string;
  settingsSection?: SettingsSectionId;
  financeTaskKind?: FinanceTaskKind;
  financeTaskId?: string;
}

const EMPTY: Route = {
  tab: 'overview', reportId: undefined, channelId: undefined, lotteryProjectId: undefined,
  goalId: undefined, startDate: undefined, endDate: undefined, historyDate: undefined,
  healthFilter: undefined, settingsSection: undefined, financeTaskKind: undefined,
  financeTaskId: undefined,
};

const isTab = (value: unknown): value is TabId => TAB_IDS.includes(value as TabId);
const isFinanceTaskKind = (value: unknown): value is FinanceTaskKind => FINANCE_TASK_KINDS.includes(value as FinanceTaskKind);

function date(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

function routeForPath(segments: string[]): Pick<Route, 'tab' | 'financeTaskKind' | 'settingsSection'> | null {
  const [root, sub] = segments;
  if (!root) return { tab: 'overview' };
  if (root === 'settings') {
    if (sub === 'ai') return { tab: 'ai', settingsSection: 'ai' };
    if (sub === 'storage' || sub === 'data') return { tab: 'data', settingsSection: 'storage' };
    if (isSettingsSection(sub)) return { tab: 'settings', settingsSection: sub };
    return { tab: 'settings' };
  }
  if (isTab(root)) {
    return { tab: root, ...(root === 'monthly' ? { financeTaskKind: 'monthly-review' as const } : {}) };
  }
  if (root === 'finance') {
    return { tab: 'monthly', financeTaskKind: isFinanceTaskKind(sub) ? sub : 'monthly-review' };
  }
  if (root === 'review') {
    return { tab: sub === 'reports' || sub === 'analysis' ? sub : 'history' };
  }
  if (root === 'planning') return { tab: sub === 'prediction' ? 'prediction' : 'goals' };
  if (root === 'assets') return { tab: 'assets' };
  if (root === 'lottery') return { tab: 'lottery' };
  return null;
}

export function parseHash(hash = typeof window === 'undefined' ? '' : window.location.hash): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const segments = path.split('/').filter(Boolean);
  const base = routeForPath(segments);
  if (!base) return { ...EMPTY };

  const oldStyle = isTab(segments[0]);
  const category = oldStyle ? segments[1] : ['settings', 'data', 'ai'].includes(base.tab) ? undefined : segments[2];
  const encodedId = oldStyle ? segments[2] : segments[3];
  let entityId: string | undefined;
  try {
    entityId = encodedId ? decodeURIComponent(encodedId) : undefined;
  } catch {
    return { ...EMPTY, ...base };
  }

  const route: Route = { ...EMPTY, ...base };
  if (category === 'report' && route.tab === 'reports') route.reportId = entityId;
  if (category === 'channel' && (route.tab === 'assets' || route.tab === 'analysis')) route.channelId = entityId;
  if (category === 'project' && route.tab === 'lottery') route.lotteryProjectId = entityId;
  if (category === 'goal' && (route.tab === 'goals' || route.tab === 'prediction')) route.goalId = entityId;

  const params = new URLSearchParams(query);
  route.startDate = date(params.get('startDate'));
  route.endDate = date(params.get('endDate'));
  if (route.startDate && route.endDate && route.startDate > route.endDate) {
    route.startDate = undefined;
    route.endDate = undefined;
  }
  route.historyDate = date(params.get('historyDate'));
  if (route.tab === 'data') route.healthFilter = params.get('healthFilter') ?? undefined;
  if (route.tab === 'monthly') route.financeTaskId = params.get('task') ?? undefined;
  const settingsSection = params.get('section');
  if (route.tab === 'settings' && isSettingsSection(settingsSection)) route.settingsSection = settingsSection;
  return route;
}

function basePathFor(route: Route): string[] {
  switch (route.tab) {
    case 'history': return ['review', 'history'];
    case 'reports': return ['review', 'reports'];
    case 'analysis': return ['review', 'analysis'];
    case 'goals': return ['planning', 'goals'];
    case 'prediction': return ['planning', 'prediction'];
    case 'monthly': return ['finance', route.financeTaskKind ?? 'monthly-review'];
    case 'data': return ['settings', 'storage'];
    case 'ai': return ['settings', 'ai'];
    case 'settings': return ['settings'];
    case 'assets': return ['assets'];
    case 'lottery': return ['lottery'];
    case 'overview': return ['overview'];
  }
}

export function buildHash(route: Route): string {
  const parts = basePathFor(route);
  if (route.reportId && route.tab === 'reports') parts.push('report', encodeURIComponent(route.reportId));
  if (route.channelId && (route.tab === 'assets' || route.tab === 'analysis')) parts.push('channel', encodeURIComponent(route.channelId));
  if (route.lotteryProjectId && route.tab === 'lottery') parts.push('project', encodeURIComponent(route.lotteryProjectId));
  if (route.goalId && (route.tab === 'goals' || route.tab === 'prediction')) parts.push('goal', encodeURIComponent(route.goalId));
  const query = new URLSearchParams();
  for (const key of ['startDate', 'endDate', 'historyDate', 'healthFilter'] as const) {
    if (route[key]) query.set(key, route[key]!);
  }
  if (route.tab === 'monthly' && route.financeTaskId) query.set('task', route.financeTaskId);
  if (route.tab === 'settings' && isSettingsSection(route.settingsSection)) query.set('section', route.settingsSection);
  return `#/${parts.join('/')}${query.size ? `?${query}` : ''}`;
}

interface NavigationState extends Route {
  navigate: (route: Partial<Route>) => void;
  reset: () => void;
}

export const useNavigationStore = create<NavigationState>()((set, get) => ({
  ...parseHash(),
  navigate(route) {
    const next = parseHash(buildHash({ ...EMPTY, tab: get().tab, ...route }));
    set(next);
    if (typeof window !== 'undefined' && window.location.hash !== buildHash(next)) {
      window.location.hash = buildHash(next);
    }
  },
  reset() { get().navigate({ tab: 'overview' }); },
}));

export function initNavigation(): () => void {
  if (typeof window === 'undefined') return () => {};
  const apply = () => useNavigationStore.setState(parseHash());
  apply();
  window.addEventListener('hashchange', apply);
  return () => window.removeEventListener('hashchange', apply);
}
