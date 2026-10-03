import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { totalAssets } from '../../utils/channels';
import { formatCNY } from '../../utils/money';
import { WEALTH_LEVELS, getLevelByAmount, getLevelIndex } from '../../constants/levels';
import type { WealthLevel } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/primitives';

/** 格式化等级资产范围（最高级显示 +，不显示 Infinity）。 */
export function formatLevelRange(level: WealthLevel): string {
  if (level.maxAmount === Number.POSITIVE_INFINITY) return `${formatCNY(level.minAmount)}+`;
  return `${formatCNY(level.minAmount)} - ${formatCNY(level.maxAmount)}`;
}

export function LevelExplorer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const channels = useAppStore((s) => s.channels);
  const [detail, setDetail] = useState<WealthLevel | null>(null);

  const total = totalAssets(channels);
  const current = getLevelByAmount(total);
  const currentIdx = getLevelIndex(current);

  if (detail) {
    return (
      <Modal open={open} onClose={() => { setDetail(null); onClose(); }} title="等级详情" size="sm">
        <LevelDetail level={detail} total={total} currentIdx={currentIdx} onBack={() => setDetail(null)} />
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="财富等级体系" size="lg">
      <p className="text-xs text-slate-500 mb-3">
        本等级体系是应用的<strong>游戏化成长体系</strong>，不代表投资能力评级、信用评级或真实社会财富地位。
      </p>
      <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
        {WEALTH_LEVELS.map((level) => {
          const idx = getLevelIndex(level);
          const isCurrent = idx === currentIdx;
          const done = idx < currentIdx;
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
  onBack,
}: {
  level: WealthLevel;
  total: number;
  currentIdx: number;
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

      <div>
        <div className="text-xs text-slate-400 mb-2">主题色</div>
        <div className="flex flex-wrap gap-2">
          {[level.tokens.primary, level.tokens.secondary, level.tokens.accent, level.tokens.chartAccent].map((c, i) => (
            <span key={i} className="h-8 w-8 rounded-lg border border-slate-200" style={{ background: c }} aria-label={c} />
          ))}
        </div>
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
