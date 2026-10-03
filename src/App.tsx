import { Suspense, lazy, useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { storageService } from './services/storage';
import { totalAssets } from './utils/channels';
import { getLevelByAmount } from './constants/levels';
import { applyLevelTheme } from './utils/theme';
import { formatCNY } from './utils/money';
import { ToastHost } from './components/ui/ToastHost';
import { Spinner } from './components/ui/primitives';
import { AssetsPanel } from './features/assets/AssetsPanel';
import { CoinRainOverlay } from './features/coinRain/CoinRainOverlay';
import { LevelUpCelebrationOverlay } from './features/celebrate/LevelUpCelebrationOverlay';
import { LevelExplorer } from './features/levels/LevelExplorer';

const HistoryPanel = lazy(() =>
  import('./features/history/HistoryPanel').then((m) => ({ default: m.HistoryPanel })),
);
const ReportsPanel = lazy(() =>
  import('./features/reports/ReportsPanel').then((m) => ({ default: m.ReportsPanel })),
);
const AnalysisPanel = lazy(() =>
  import('./features/analysis/AnalysisPanel').then((m) => ({ default: m.AnalysisPanel })),
);
const PredictionPanel = lazy(() =>
  import('./features/prediction/PredictionPanel').then((m) => ({ default: m.PredictionPanel })),
);
const GoalsPanel = lazy(() =>
  import('./features/goals/GoalsPanel').then((m) => ({ default: m.GoalsPanel })),
);
const DataPanel = lazy(() =>
  import('./features/data/DataPanel').then((m) => ({ default: m.DataPanel })),
);

type TabId = 'assets' | 'history' | 'reports' | 'analysis' | 'prediction' | 'goals' | 'data';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'assets', label: '资产', icon: '💰' },
  { id: 'history', label: '历史', icon: '📊' },
  { id: 'reports', label: '报告', icon: '📄' },
  { id: 'analysis', label: '分析', icon: '🔍' },
  { id: 'prediction', label: '预测', icon: '🔮' },
  { id: 'goals', label: '目标', icon: '🎯' },
  { id: 'data', label: '数据', icon: '💾' },
];

function PanelFallback() {
  return (
    <div className="flex items-center justify-center py-20 text-slate-400">
      <Spinner className="h-5 w-5 mr-2" />
      加载中…
    </div>
  );
}

export default function App() {
  const hydrated = useAppStore((s) => s.hydrated);
  const hydrate = useAppStore((s) => s.hydrate);
  const channels = useAppStore((s) => s.channels);
  const [tab, setTab] = useState<TabId>('assets');
  const [levelExplorerOpen, setLevelExplorerOpen] = useState(false);

  const total = totalAssets(channels);
  const level = getLevelByAmount(total);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // 退出前确保桌面文件存储已落盘
  useEffect(() => {
    const onBeforeUnload = () => {
      void storageService.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // 应用当前财富等级主题（CSS Variables）
  useEffect(() => {
    applyLevelTheme(level);
  }, [level]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-slate-500">
        <div className="text-5xl animate-float" aria-hidden>
          🌱
        </div>
        <Spinner className="h-6 w-6 text-emerald-500" />
        <p className="text-sm">正在加载财富成长记…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/80"
        style={{ backgroundImage: 'linear-gradient(120deg, var(--wealth-surface) 0%, transparent 55%)' }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl" aria-hidden>
              {level.badge}
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-slate-800 leading-tight">财富成长记</h1>
              <p className="text-xs text-slate-500 truncate">{level.name} · 财富梦想实现家</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[11px] text-slate-400">总资产</div>
              <div className="text-lg sm:text-xl font-bold tabular leading-tight" style={{ color: 'var(--wealth-primary)' }}>
                {formatCNY(total)}
              </div>
            </div>
            <button
              onClick={() => setLevelExplorerOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border transition-opacity hover:opacity-85"
              style={{ background: 'var(--wealth-surface)', borderColor: 'var(--wealth-border)', color: 'var(--wealth-primary)' }}
              title="查看财富等级体系"
            >
              {level.badge} {level.name}
            </button>
          </div>
        </div>
        {/* 顶部标签导航（移动端可横向滚动） */}
        <nav className="max-w-5xl mx-auto px-2 flex overflow-x-auto" aria-label="主导航">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`shrink-0 px-3 py-2 flex items-center gap-1.5 text-sm font-medium transition-colors border-b-2 ${
                tab === t.id
                  ? 'text-emerald-600 border-emerald-500'
                  : 'text-slate-500 border-transparent hover:text-slate-700'
              }`}
            >
              <span className="leading-none" aria-hidden>
                {t.icon}
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-4">
        <Suspense fallback={<PanelFallback />}>
          {tab === 'assets' && <AssetsPanel />}
          {tab === 'history' && <HistoryPanel />}
          {tab === 'reports' && <ReportsPanel />}
          {tab === 'analysis' && <AnalysisPanel />}
          {tab === 'prediction' && <PredictionPanel />}
          {tab === 'goals' && <GoalsPanel />}
          {tab === 'data' && <DataPanel />}
        </Suspense>
      </main>

      <ToastHost />
      <CoinRainOverlay />
      <LevelUpCelebrationOverlay />
      <LevelExplorer open={levelExplorerOpen} onClose={() => setLevelExplorerOpen(false)} />
    </div>
  );
}
