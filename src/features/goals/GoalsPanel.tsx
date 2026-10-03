import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { CountdownData } from '../../types';
import { totalAssets } from '../../utils/channels';
import { formatCNY, parseMoney } from '../../utils/money';
import { todayString } from '../../utils/date';
import { getLevelByAmount } from '../../constants/levels';
import { useNow } from '../../hooks/useNow';
import { computeCountdownState, countdownDuration, formatCountdown, getDefaultTimezone, TIMEZONE_OPTIONS } from '../../utils/countdown';
import { Card, Button, Badge, ProgressBar, EmptyState } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { MoneyField, TextField, SelectField } from '../../components/ui/form';
import { LineChart } from '../../components/charts/LineChart';
import { PREDICTION } from '../../components/charts/palette';

export function GoalsPanel() {
  const channels = useAppStore((s) => s.channels);
  const history = useAppStore((s) => s.history);
  const countdown = useAppStore((s) => s.countdown);
  const goalAchieved = useAppStore((s) => s.goalAchieved);
  const coinRainConfig = useAppStore((s) => s.coinRainConfig);
  const { setCountdown, setCoinRainConfig, triggerCoinRain, markGoalAchieved, pushToast } = useAppStore();

  const [editOpen, setEditOpen] = useState(false);
  const now = useNow();

  const total = totalAssets(channels);
  const level = getLevelByAmount(total);
  const amountProgress = countdown.targetAmount > 0 ? Math.min(100, (total / countdown.targetAmount) * 100) : 0;

  const cdState = computeCountdownState(now, countdown);
  const cdDur = countdownDuration(now, countdown);
  const cdText = formatCountdown(cdDur, countdown.displayMode ?? 'calendar', countdown.showSeconds);

  // 目标达成自动触发（跨越检测已在 store 的 setAmount 里完成；这里兜底处理已有状态）
  useEffect(() => {
    if (countdown.targetAmount > 0 && total >= countdown.targetAmount && !goalAchieved.hasAchievedGoal) {
      markGoalAchieved();
      triggerCoinRain();
      pushToast('🎉 恭喜达成财富目标！', 'success');
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

  return (
    <div className="space-y-4">
      {/* 目标进度 + 倒计时 */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-slate-800">{countdown.targetName || '财富目标'}</h2>
            <p className="text-xs text-slate-500">时区 {countdown.timezone || getDefaultTimezone()}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => triggerCoinRain()}>🪙 金币雨</Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>✎ 编辑目标</Button>
          </div>
        </div>

        <div className="text-center py-2">
          <div className="text-4xl font-bold tabular" style={{ color: 'var(--wealth-primary)' }}>{amountProgress.toFixed(1)}%</div>
          <div className="text-sm text-slate-500 mt-1 tabular">{formatCNY(total)} / {formatCNY(countdown.targetAmount)}</div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-400 mb-1">倒计时（{cdState.status === 'running' ? '进行中' : cdState.status === 'ended' ? '已到期' : '未开始'}）</div>
            <div className="text-lg font-bold text-slate-800 tabular">{cdText}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-xs text-slate-400 mb-1">剩余金额</div>
            <div className="text-lg font-bold text-slate-800 tabular">{formatCNY(Math.max(0, countdown.targetAmount - total))}</div>
          </div>
        </div>

        {/* 时间进度 vs 金额进度 */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>时间进度</span><span className="tabular">{cdState.timeProgress.toFixed(0)}%</span>
            </div>
            <ProgressBar value={cdState.timeProgress} barClassName="bg-gradient-to-r from-blue-400 to-cyan-500" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>金额进度</span><span className="tabular">{amountProgress.toFixed(0)}%</span>
            </div>
            <ProgressBar value={amountProgress} barClassName="bg-gradient-to-r from-emerald-400 to-emerald-600" />
          </div>
        </div>

        {goalAchieved.hasAchievedGoal && (
          <div className="mt-3 text-center"><Badge tone="amber">🏆 已达成目标！</Badge></div>
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
            <div key={m.percentage} className={`px-2.5 py-1.5 rounded-lg text-xs ${amountProgress >= m.percentage ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400'}`}>
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
              { value: 'off', label: '关闭' },
              { value: 'low', label: '低' },
              { value: 'medium', label: '中' },
              { value: 'high', label: '高' },
            ]}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              风力 <span className="text-slate-400 tabular">{Math.round(coinRainConfig.windStrength * 100)}%</span>
            </label>
            <input type="range" min={0} max={1} step={0.05} value={coinRainConfig.windStrength}
              onChange={(e) => setCoinRainConfig({ ...coinRainConfig, windStrength: Number(e.target.value) })}
              className="w-full accent-emerald-600" aria-label="风力" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              弹跳系数 <span className="text-slate-400 tabular">{Math.round(coinRainConfig.bounceFactor * 100)}%</span>
            </label>
            <input type="range" min={0} max={1} step={0.05} value={coinRainConfig.bounceFactor}
              onChange={(e) => setCoinRainConfig({ ...coinRainConfig, bounceFactor: Number(e.target.value) })}
              className="w-full accent-emerald-600" aria-label="弹跳系数" />
          </div>
        </div>
      </Card>

      <CountdownEditor open={editOpen} onClose={() => setEditOpen(false)} onSave={(cd) => { setCountdown(cd); setEditOpen(false); pushToast('目标已更新', 'success'); }} />
    </div>
  );
}

function CountdownEditor({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (cd: CountdownData) => void }) {
  const countdown = useAppStore((s) => s.countdown);
  const [targetName, setTargetName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [startDate, setStartDate] = useState(todayString());
  const [startTime, setStartTime] = useState('00:00');
  const [targetDate, setTargetDate] = useState(todayString());
  const [targetTime, setTargetTime] = useState('00:00');
  const [timezone, setTimezone] = useState(getDefaultTimezone());
  const [displayMode, setDisplayMode] = useState<CountdownData['displayMode']>('calendar');
  const [showSeconds, setShowSeconds] = useState(true);
  const [amountError, setAmountError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTargetName(countdown.targetName ?? '');
    setTargetAmount(String(countdown.targetAmount));
    setStartDate(countdown.startDate ?? todayString());
    setStartTime((countdown.startDateTime ?? `${countdown.startDate ?? todayString()}T00:00`).slice(11, 16));
    setTargetDate(countdown.targetDate ?? todayString());
    setTargetTime((countdown.targetDateTime ?? `${countdown.targetDate ?? todayString()}T00:00`).slice(11, 16));
    setTimezone(countdown.timezone || getDefaultTimezone());
    setDisplayMode(countdown.displayMode ?? 'calendar');
    setShowSeconds(countdown.showSeconds ?? true);
    setAmountError('');
  }, [open, countdown]);

  function submit() {
    const amt = parseMoney(targetAmount);
    if (amt === null || amt <= 0) {
      setAmountError('请输入有效的目标金额');
      return;
    }
    const cd: CountdownData = {
      targetAmount: amt,
      targetDate,
      startDate,
      targetName: targetName.trim() || undefined,
      timezone,
      startDateTime: `${startDate}T${startTime}`,
      targetDateTime: `${targetDate}T${targetTime}`,
      displayMode,
      showSeconds,
    };
    onSave(cd);
  }

  return (
    <Modal open={open} onClose={onClose} title="编辑目标与倒计时" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={submit}>保存</Button>
      </>}>
      <div className="space-y-4">
        <TextField label="目标名称（可选）" value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="例如：存下第一个一百万" />
        <MoneyField label="目标金额" value={targetAmount === '' ? '' : Number(targetAmount)} onChange={(v) => setTargetAmount(v === '' ? '' : String(v))} error={amountError} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="起始日期" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextField label="起始时间" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <TextField label="目标日期" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          <TextField label="目标时间" type="time" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} />
        </div>
        <SelectField label="时区" value={timezone} onChange={(e) => setTimezone(e.target.value)}
          options={[...new Set([timezone, getDefaultTimezone(), ...TIMEZONE_OPTIONS])].map((t) => ({ value: t, label: t }))} />
        <SelectField label="显示格式" value={displayMode ?? 'calendar'} onChange={(e) => setDisplayMode(e.target.value as CountdownData['displayMode'])}
          options={[
            { value: 'calendar', label: '年/月/日/时分秒（如 1年 2个月 16天 08:35:42）' },
            { value: 'days', label: '日/时分秒（如 441天 08:35:42）' },
            { value: 'hours', label: '总小时（如 10,592 小时）' },
            { value: 'simple', label: '简洁（如 441 天）' },
          ]} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showSeconds} onChange={(e) => setShowSeconds(e.target.checked)} className="h-4 w-4 text-emerald-600 rounded" />
          <span className="text-sm text-slate-700">显示秒</span>
        </label>
      </div>
    </Modal>
  );
}
