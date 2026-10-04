import { create } from 'zustand';

/**
 * App Navigation（v1.4）：轻量 hash 路由 + 跨 Feature 深链。
 * 不引入 React Router，Context + URL hash 足够，刷新/浏览器 Back/PWA 更自然。
 */

export type TabId = 'assets' | 'history' | 'reports' | 'analysis' | 'prediction' | 'goals' | 'lottery' | 'data';

export interface Route {
  tab: TabId;
  /** 报告详情 / 深链定位。 */
  reportId?: string;
  /** 资产渠道定位。 */
  channelId?: string;
  /** 彩票项目定位。 */
  lotteryProjectId?: string;
  /** 目标定位。 */
  goalId?: string;
  /** 分析自定义时间范围。 */
  startDate?: string;
  endDate?: string;
  /** 历史日期高亮。 */
  historyDate?: string;
  /** Data Health 过滤域。 */
  healthFilter?: string;
}

interface NavigationState extends Route {
  navigate: (route: Partial<Route>) => void;
  reset: () => void;
}

function parseHash(): Partial<Route> {
  if (typeof window === 'undefined') return {};
  const h = window.location.hash.replace(/^#\/?/, ''); // 去掉 '#/' 或 '#'
  if (!h) return {};
  const [path = '', query] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query ?? '');
  const route: Partial<Route> = {};

  if (seg[0]) route.tab = seg[0] as TabId;
  if (seg[1] === 'report' && seg[2]) route.reportId = seg[2];
  if (seg[1] === 'channel' && seg[2]) route.channelId = seg[2];
  if (seg[1] === 'project' && seg[2]) route.lotteryProjectId = seg[2];
  if (seg[1] === 'goal' && seg[2]) route.goalId = seg[2];
  if (q.get('startDate')) route.startDate = q.get('startDate')!;
  if (q.get('endDate')) route.endDate = q.get('endDate')!;
  if (q.get('historyDate')) route.historyDate = q.get('historyDate')!;
  if (q.get('healthFilter')) route.healthFilter = q.get('healthFilter')!;
  return route;
}

function buildHash(r: Route): string {
  const parts: string[] = [r.tab];
  if (r.reportId) parts.push('report', r.reportId);
  if (r.channelId) parts.push('channel', r.channelId);
  if (r.lotteryProjectId) parts.push('project', r.lotteryProjectId);
  if (r.goalId) parts.push('goal', r.goalId);
  const q = new URLSearchParams();
  if (r.startDate) q.set('startDate', r.startDate);
  if (r.endDate) q.set('endDate', r.endDate);
  if (r.historyDate) q.set('historyDate', r.historyDate);
  if (r.healthFilter) q.set('healthFilter', r.healthFilter);
  const qs = q.toString();
  return `#/${parts.join('/')}${qs ? `?${qs}` : ''}`;
}

function initialRoute(): Route {
  return { tab: 'assets', ...parseHash() };
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  ...initialRoute(),
  navigate(route) {
    set((s) => {
      // 切 tab 时先清除旧的跨 tab 定位参数，再应用本次 route（保留本次显式传入的定位）
      const base: Route = { ...s };
      if (route.tab && route.tab !== s.tab) {
        base.reportId = undefined;
        base.channelId = undefined;
        base.lotteryProjectId = undefined;
        base.goalId = undefined;
      }
      const next: Route = { ...base, ...route };
      if (typeof window !== 'undefined') {
        const hash = buildHash(next);
        if (window.location.hash !== hash) window.location.hash = hash;
      }
      return next;
    });
  },
  reset() {
    set({ tab: 'assets', reportId: undefined, channelId: undefined, lotteryProjectId: undefined, goalId: undefined, startDate: undefined, endDate: undefined, historyDate: undefined, healthFilter: undefined });
  },
}));

/** 初始化 hash 监听（App 启动时调用一次）。 */
export function initNavigation(): void {
  if (typeof window === 'undefined') return;
  const apply = () => useNavigationStore.setState({ ...useNavigationStore.getState(), ...parseHash() });
  window.addEventListener('hashchange', apply);
}
