import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { formatCNY } from '../../utils/money';

const PARTICLES = ['✨', '⭐', '🎉', '💫', '🌟'];

/**
 * 财富升级 / 目标达成庆祝 Overlay。
 * - 与 CoinRainOverlay 分离，避免两个全屏 canvas 同时运行。
 * - 约 3 秒后自动消失；prefers-reduced-motion 时仅显示静态卡片。
 */
export function LevelUpCelebrationOverlay() {
  const celebration = useAppStore((s) => s.celebration);
  const dismiss = useAppStore((s) => s.dismissCelebration);

  const reduced = useMemo(
    () => (typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : true),
    [],
  );

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(dismiss, 3200);
    return () => clearTimeout(t);
  }, [celebration, dismiss]);

  if (!celebration) return null;

  const e = celebration;
  const lines: string[] = [];
  if (e.levelUp) {
    lines.push(e.skippedLevels > 1 ? `连续升级 ${e.skippedLevels} 级！` : '财富等级提升');
    lines.push(`${e.fromLevel ?? ''} → ${e.toLevel}`);
  }
  if (e.goal) {
    lines.push('财富目标达成！');
    if (e.targetAmount) lines.push(formatCNY(e.targetAmount));
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center pointer-events-none" role="status" aria-live="polite">
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 45%, var(--wealth-glow), transparent 60%)' }}
        aria-hidden
      />
      {/* 静态装饰粒子（reduced-motion 时关闭） */}
      {!reduced &&
        PARTICLES.map((p, i) => (
          <span
            key={i}
            className="absolute animate-float text-3xl"
            style={{ left: `${15 + i * 17}%`, top: `${18 + (i % 3) * 22}%`, opacity: 0.9 }}
            aria-hidden
          >
            {p}
          </span>
        ))}

      <div className="relative bg-white/95 border rounded-2xl shadow-2xl px-8 py-7 text-center max-w-sm mx-4">
        <div
          className="text-6xl mb-3 mx-auto w-20 h-20 flex items-center justify-center rounded-full"
          style={{ background: 'var(--wealth-surface)', boxShadow: `0 0 32px var(--wealth-glow)` }}
          aria-hidden
        >
          {e.badge}
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">
          {lines[0] ?? '🎉 恭喜'}
        </h2>
        {lines.slice(1).map((l, i) => (
          <p key={i} className="text-sm text-slate-600">
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}
