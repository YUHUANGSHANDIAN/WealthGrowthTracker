import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { totalAssets } from '../../utils/channels';
import { formatCNY } from '../../utils/money';
import { WEALTH_LEVELS, getLevelByAmount, getLevelIndex } from '../../constants/levels';
import { applyLevelTheme, applyNeutralTheme } from '../../utils/theme';
import type { WealthLevel } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { Badge, Button } from '../../components/ui/primitives';

/** 格式化等级资产范围（最高级显示 +，不显示 Infinity）。 */
function formatLevelRange(level: WealthLevel): string {
  if (level.maxAmount === Number.POSITIVE_INFINITY) return `${formatCNY(level.minAmount)}+`;
  return `${formatCNY(level.minAmount)} - ${formatCNY(level.maxAmount)}`;
}

export function LevelExplorer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const channels = useAppStore((s) => s.channels);
  const levelAchievements = useAppStore((s) => s.levelAchievements);
  const followWealthTheme = useAppStore((s) => s.appearance.followWealthTheme);
  const [detail, setDetail] = useState<WealthLevel | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  const total = totalAssets(channels);
  const current = getLevelByAmount(total);
  const currentIdx = getLevelIndex(current);

  function close() {
    setDetail(null);
    setPreviewing(null);
    // 恢复真实主题
    if (followWealthTheme) applyLevelTheme(getLevelByAmount(totalAssets(useAppStore.getState().channels)));
    else applyNeutralTheme();
    onClose();
  }

  function preview(level: WealthLevel) {
    applyLevelTheme(level);
    setPreviewing(level.name);
  }

  const achievedMap = new Map(levelAchievements.map((a) => [a.levelName, a]));

  if (detail) {
    return (
      <Modal open={open} onClose={close} title="等级详情" size="sm">
        <LevelDetail
          level={detail}
          total={total}
          currentIdx={currentIdx}
          achievement={achievedMap.get(detail.name)}
          previewing={previewing === detail.name}
          onPreview={() => preview(detail)}
          onBack={() => { setDetail(null); setPreviewing(null); }}
        />
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title="财富等级体系" size="lg">
      <p className="text-xs text-slate-500 mb-3">
        本等级体系是应用的<strong>游戏化成长体系</strong>，不代表投资能力评级、信用评级或真实社会财富地位。
      </p>
      {/* 财富成长护照 */}
      {levelAchievements.length > 0 && (
        <div className="bg-slate-50 rounded-xl p-3 mb-3">
          <div className="text-xs font-medium text-slate-600 mb-2">🌱 财富成长护照 · 已达成 {levelAchievements.length} 级</div>
          <div className="flex flex-wrap gap-1.5">
            {levelAchievements.map((a) => (
              <span key={a.levelId} className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-600">
                {WEALTH_LEVELS.find((l) => l.name === a.levelName)?.badge ?? '🏅'} {a.levelName}
                <span className="text-slate-400"> · {a.reachedAt}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
        {WEALTH_LEVELS.map((level) => {
          const idx = getLevelIndex(level);
          const isCurrent = idx === currentIdx;
          const done = idx < currentIdx;
          const ach = achievedMap.get(level.name);
          return (
            <button
              key={level.name}
              onClick={() => setDetail(level)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                isCurrent
                  ? 'border-emerald-400 bg-emerald-50/60'
                  : done
                    ? 'border-slate-200 bg-white hover:bg-slate-50'
                    : 'border-slate-100 bg-white opacity-60 hover:opacity-90 hover:bg-slate-50'
              }`}
              style={isCurrent ? { borderColor: 'var(--wealth-primary)', background: 'var(--wealth-surface)' } : undefined}
            >
              <span className="text-2xl shrink-0" aria-hidden>{level.badge}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{level.name}</span>
                  {isCurrent && <Badge tone="emerald">当前</Badge>}
                  {done && <span className="text-emerald-500" aria-label="已完成">✓</span>}
                </div>
                <div className="text-xs text-slate-500 tabular">{formatLevelRange(level)}</div>
                {ach && <div className="text-[11px] text-slate-400">首次达成 {ach.reachedAt}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="h-4 w-4 rounded-full" style={{ background: level.tokens.primary }} aria-hidden />
                <span className="text-slate-300" aria-hidden>›</span>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function LevelDetail({
  level,
  total,
  currentIdx,
  achievement,
  previewing,
  onPreview,
  onBack,
}: {
  level: WealthLevel;
  total: number;
  currentIdx: number;
  achievement?: { reachedAt: string; firstAmount: number };
  previewing: boolean;
  onPreview: () => void;
  onBack: () => void;
}) {
  const idx = getLevelIndex(level);
  const reached = idx <= currentIdx;
  const need = level.minAmount - total;
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">← 返回等级列表</button>
      <div className="flex items-center gap-3">
        <span className="text-4xl" aria-hidden>{level.badge}</span>
        <div>
          <div className="text-lg font-semibold text-slate-800">{level.name}</div>
          <div className="text-sm text-slate-500 tabular">{formatLevelRange(level)}</div>
        </div>
      </div>

      <div className="bg-slate-50 rounded-xl p-3">
        <div className="text-xs text-slate-400 mb-1">等级寓意</div>
        <p className="text-sm text-slate-700">{level.description}</p>
      </div>

      {achievement && (
        <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
          🌱 首次达成：<span className="font-medium">{achievement.reachedAt}</span>（当时资产 {formatCNY(achievement.firstAmount)}）
        </div>
      )}

      <div>
        <div className="text-xs text-slate-400 mb-2">主题色</div>
        <div className="flex flex-wrap gap-2">
          {[level.tokens.primary, level.tokens.secondary, level.tokens.accent, level.tokens.chartAccent].map((c, i) => (
            <span key={i} className="h-8 w-8 rounded-lg border border-slate-200" style={{ background: c }} aria-label={c} />
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-2" onClick={onPreview}>
          {previewing ? '✓ 正在预览此主题' : '👁 预览主题'}
        </Button>
        <p className="text-[11px] text-slate-400 mt-1">预览仅临时切换视觉，不改变真实财富等级；关闭后恢复。</p>
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-2">里程碑</div>
        <div className="grid grid-cols-3 gap-2">
          {level.milestones.map((m) => (
            <div key={m.percentage} className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
              <div className="text-base" aria-hidden>{m.emoji}</div>
              <div className="text-xs text-slate-600">{m.name}</div>
              <div className="text-[10px] text-slate-400">{m.percentage}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 text-sm text-slate-600">
        {reached ? (
          <p className="text-emerald-600">✓ 已达成该等级</p>
        ) : (
          <p>
            进入该等级需要达到 <span className="font-semibold tabular">{formatCNY(level.minAmount)}</span>，还差{' '}
            <span className="font-semibold tabular">{formatCNY(need)}</span>。
          </p>
        )}
      </div>
    </div>
  );
}
