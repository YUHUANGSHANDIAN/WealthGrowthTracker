import { useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { totalAssets } from '../../utils/channels';
import { formatCNY } from '../../utils/money';
import { addDays, todayString } from '../../utils/date';
import { getLevelByAmount, getNextLevel } from '../../constants/levels';
import { useNow } from '../../hooks/useNow';
import { computeCountdownState, countdownDuration, formatCountdown } from '../../utils/countdown';

export function WealthHeroCard({ onOpenLevels }: { onOpenLevels: () => void }) {
  const channels = useAppStore((s) => s.channels);
  const history = useAppStore((s) => s.history);
  const countdown = useAppStore((s) => s.countdown);
  const now = useNow();

  const total = totalAssets(channels);
  const level = getLevelByAmount(total);
  const nextLevel = getNextLevel(level);
  const levelProgress = nextLevel
    ? Math.min(100, ((total - level.minAmount) / (nextLevel.minAmount - level.minAmount)) * 100)
    : 100;

  const goalProgress = countdown.targetAmount > 0 ? Math.min(100, (total / countdown.targetAmount) * 100) : 0;

  // 最近 30 天 sparkline + 变化
  const spark = useMemo(() => {
    const start = addDays(todayString(), -30);
    const pts = [...history].filter((h) => h.date >= start).sort((a, b) => (a.date < b.date ? -1 : 1));
    return pts;
  }, [history]);

  const recentChange = useMemo(() => {
    if (spark.length < 2) return null;
    return spark[spark.length - 1]!.totalAmount - spark[0]!.totalAmount;
  }, [spark]);

  const cdState = computeCountdownState(now, countdown);
  const cdDur = countdownDuration(now, countdown);
  const cdText = formatCountdown(cdDur, countdown.displayMode ?? 'calendar', countdown.showSeconds);

  return (
    <section
      className="relative overflow-hidden rounded-2xl border p-5 sm:p-6 shadow-sm"
      style={{ borderColor: 'var(--wealth-border)', background: 'linear-gradient(135deg, var(--wealth-hero-gradient))' }}
    >
      {/* 背景装饰（低透明度，不遮挡文字） */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 85% 20%, var(--wealth-glow), transparent 55%)', opacity: 0.6 }} aria-hidden />

      <div className="relative grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl" aria-hidden>{level.badge}</span>
            <button onClick={onOpenLevels} className="text-sm font-medium text-slate-700 hover:underline">
              {level.name}
            </button>
            {nextLevel && <span className="text-xs text-slate-500">距 {nextLevel.name} {formatCNY(nextLevel.minAmount - total)}</span>}
          </div>

          <div className="text-3xl sm:text-4xl font-bold text-slate-900 tabular leading-tight">
            {formatCNY(total)}
          </div>

          {recentChange !== null && (
            <div className={`text-sm tabular mt-1 ${recentChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              30日 {recentChange >= 0 ? '▲' : '▼'} {formatCNY(Math.abs(recentChange))}
            </div>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>等级进度</span>
                <span className="tabular">{levelProgress.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/70 overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${levelProgress}%`, background: 'var(--wealth-progress-gradient)' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>{countdown.targetName || '财富目标'}进度</span>
                <span className="tabular">{goalProgress.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/70 overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${goalProgress}%`, background: 'var(--wealth-progress-gradient)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：倒计时 + sparkline */}
        <div className="flex flex-col gap-3 sm:w-56">
          <div className="bg-white/70 rounded-xl p-3 border border-white">
            <div className="text-xs text-slate-500">目标倒计时</div>
            <div className="text-lg font-bold text-slate-800 tabular leading-tight">{cdText}</div>
            <div className="text-[11px] text-slate-400 tabular mt-0.5">
              {cdState.status === 'running' ? `目标日期 ${countdown.targetDate}` : cdState.status === 'ended' ? '已到期' : '未开始'}
            </div>
            {countdown.targetAmount > 0 && (
              <div className="text-[11px] text-slate-400 tabular">目标 {formatCNY(countdown.targetAmount)} · 剩余 {formatCNY(Math.max(0, countdown.targetAmount - total))}</div>
            )}
          </div>

          {spark.length >= 2 && (
            <Sparkline points={spark.map((p) => p.totalAmount)} color="var(--wealth-primary)" />
          )}
        </div>
      </div>
    </section>
  );
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const W = 200;
  const H = 48;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = W / (points.length - 1);
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const areaD = `${d} L${W},${H} L0,${H} Z`;
  return (
    <div className="bg-white/70 rounded-xl p-2 border border-white" aria-label="最近30天资产趋势">
      <div className="text-xs text-slate-500 mb-1">最近 30 天</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" role="img" aria-label="最近30天资产趋势图">
        <path d={areaD} fill={color} opacity={0.1} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
