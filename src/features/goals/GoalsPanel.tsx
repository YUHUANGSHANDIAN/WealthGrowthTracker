import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { totalAssets } from '../../utils/channels';
import { formatCNY, parseMoney } from '../../utils/money';
import { daysBetween, todayString } from '../../utils/date';
import { Card, Button, Badge, ProgressBar, EmptyState } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { MoneyField, TextField, SelectField } from '../../components/ui/form';
import { LineChart } from '../../components/charts/LineChart';
import { PREDICTION } from '../../components/charts/palette';
import { getLevelByAmount } from '../../constants/levels';

export function GoalsPanel() {
  const channels = useAppStore((s) => s.channels);
  const history = useAppStore((s) => s.history);
  const countdown = useAppStore((s) => s.countdown);
  const goalAchieved = useAppStore((s) => s.goalAchieved);
  const coinRainConfig = useAppStore((s) => s.coinRainConfig);
  const { setCountdown, setCoinRainConfig, triggerCoinRain, markGoalAchieved, pushToast } = useAppStore();

  const [editOpen, setEditOpen] = useState(false);
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState(todayString());
  const [amountError, setAmountError] = useState('');

  const total = totalAssets(channels);
  const level = getLevelByAmount(total);
  const progress = countdown.targetAmount > 0 ? Math.min(100, (total / countdown.targetAmount) * 100) : 0;
  const daysRemaining = daysBetween(todayString(), countdown.targetDate);

  // 达成目标自动触发金币雨（仅一次）
  useEffect(() => {
    if (countdown.targetAmount > 0 && total >= countdown.targetAmount && !goalAchieved.hasAchievedGoal) {
      markGoalAchieved();
      triggerCoinRain();
      pushToast('🎉 恭喜达成百万财富目标！', 'success');
    }
  }, [total, countdown.targetAmount, goalAchieved.hasAchievedGoal, markGoalAchieved, triggerCoinRain, pushToast]);

  const progressSeries = useMemo(() => {
    const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (sorted.length === 0 || countdown.targetAmount <= 0) return [];
    return [
      {
        id: 'progress',
        name: '目标进度',
        color: PREDICTION,
        points: sorted.map((p) => ({ date: p.date, value: (p.totalAmount / countdown.targetAmount) * 100 })),
        area: true,
      },
    ];
  }, [history, countdown.targetAmount]);

  function openEdit() {
    setTargetAmount(String(countdown.targetAmount));
    setTargetDate(countdown.targetDate);
    setAmountError('');
    setEditOpen(true);
  }
  function submitEdit() {
    const amt = parseMoney(targetAmount);
    if (amt === null || amt <= 0) {
      setAmountError('请输入有效的目标金额');
      return;
    }
    setCountdown({ targetAmount: amt, targetDate, startDate: countdown.startDate || todayString() });
    setEditOpen(false);
    pushToast('目标已更新', 'success');
  }

  return (
    <div className="space-y-4">
      {/* 目标进度 */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-slate-800">百万财富目标</h2>
            <p className="text-xs text-slate-500">可视化你的财富积累进度</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { triggerCoinRain(); }}>
              🪙 金币雨
            </Button>
            <Button variant="outline" size="sm" onClick={openEdit}>
              ✎ 编辑目标
            </Button>
          </div>
        </div>

        <div className="text-center py-2">
          <div className="text-4xl font-bold text-emerald-600 tabular">{progress.toFixed(1)}%</div>
          <div className="text-sm text-slate-500 mt-1 tabular">
            {formatCNY(total)} / {formatCNY(countdown.targetAmount)}
          </div>
        </div>

        <ProgressBar value={progress} className="h-3 mt-3" barClassName="bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600" />

        <div className="grid grid-cols-3 gap-3 mt-4 text-center">
          <div className="bg-slate-50 rounded-xl py-2.5">
            <div className="text-xs text-slate-400">剩余金额</div>
            <div className="text-sm font-semibold text-slate-800 tabular">
              {formatCNY(Math.max(0, countdown.targetAmount - total))}
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl py-2.5">
            <div className="text-xs text-slate-400">目标日期</div>
            <div className="text-sm font-semibold text-slate-800 tabular">{countdown.targetDate}</div>
          </div>
          <div className="bg-slate-50 rounded-xl py-2.5">
            <div className="text-xs text-slate-400">倒计时</div>
            <div className="text-sm font-semibold text-slate-800 tabular">
              {daysRemaining > 0 ? `${daysRemaining} 天` : daysRemaining === 0 ? '今天' : '已过期'}
            </div>
          </div>
        </div>

        {goalAchieved.hasAchievedGoal && (
          <div className="mt-3 text-center">
            <Badge tone="amber">🏆 已达成目标！</Badge>
          </div>
        )}
      </Card>

      {/* 进度趋势 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-3">目标进度趋势</h2>
        {progressSeries.length > 0 ? (
          <LineChart series={progressSeries} ariaLabel="目标进度趋势图" valueFormatter={(v) => `${v.toFixed(1)}%`} />
        ) : (
          <EmptyState icon="📈" title="暂无进度数据" />
        )}
      </Card>

      {/* 财富等级 */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl" aria-hidden>{level.badge}</span>
          <div>
            <h2 className="font-semibold text-slate-800">{level.name}</h2>
            <p className="text-xs text-slate-500">{level.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {level.milestones.map((m) => (
            <div key={m.percentage} className={`px-2.5 py-1.5 rounded-lg text-xs ${progress >= m.percentage ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400'}`}>
              {m.emoji} {m.name} ({m.percentage}%)
            </div>
          ))}
        </div>
      </Card>

      {/* 金币雨设置 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-3">金币雨设置</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="强度"
            value={coinRainConfig.intensity}
            onChange={(e) => setCoinRainConfig({ ...coinRainConfig, intensity: e.target.value as typeof coinRainConfig.intensity })}
            options={[
              { value: 'low', label: '低' },
              { value: 'medium', label: '中' },
              { value: 'high', label: '高' },
            ]}
          />
          <label className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={coinRainConfig.autoCollect}
              onChange={(e) => setCoinRainConfig({ ...coinRainConfig, autoCollect: e.target.checked })}
              className="h-4 w-4 text-emerald-600 rounded"
            />
            <span className="text-sm text-slate-700">自动收集金币</span>
          </label>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              风力 <span className="text-slate-400 tabular">{Math.round(coinRainConfig.windStrength * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={coinRainConfig.windStrength}
              onChange={(e) => setCoinRainConfig({ ...coinRainConfig, windStrength: Number(e.target.value) })}
              className="w-full accent-emerald-600"
              aria-label="风力"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              弹跳系数 <span className="text-slate-400 tabular">{Math.round(coinRainConfig.bounceFactor * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={coinRainConfig.bounceFactor}
              onChange={(e) => setCoinRainConfig({ ...coinRainConfig, bounceFactor: Number(e.target.value) })}
              className="w-full accent-emerald-600"
              aria-label="弹跳系数"
            />
          </div>
        </div>
      </Card>

      {/* 编辑目标 */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑目标"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={submitEdit}>保存</Button>
          </>
        }
      >
        <div className="space-y-4">
          <MoneyField label="目标金额" value={targetAmount === '' ? '' : Number(targetAmount)} onChange={(v) => setTargetAmount(v === '' ? '' : String(v))} error={amountError} />
          <TextField label="目标日期" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
