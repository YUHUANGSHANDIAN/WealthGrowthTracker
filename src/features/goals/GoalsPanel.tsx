import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { Goal, GoalDisplayMode } from '../../types';
import { totalAssets } from '../../utils/channels';
import { formatCNY, parseMoney } from '../../utils/money';
import { todayString, addDays } from '../../utils/date';
import { getLevelByAmount } from '../../constants/levels';
import { useNow } from '../../hooks/useNow';
import { computeCountdownState, countdownDuration, formatCountdown, getDefaultTimezone, TIMEZONE_OPTIONS } from '../../utils/countdown';
import { goalAmountProgress, goalStatusOf, validateGoal, makeGoal } from '../../utils/goals';
import { useNavigationStore } from '../../store/navigationStore';
import { Card, Button, Badge, ProgressBar, EmptyState } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { MoneyField, TextField, SelectField } from '../../components/ui/form';
import { SliderField } from '../../components/ui/Slider';
import { LineChart } from '../../components/charts/LineChart';
import { PREDICTION } from '../../components/charts/palette';
import { AIActionButton } from '../ai/AIActionButton';

const GOAL_ICONS = ['🎯', '💵', '🏠', '🚗', '✈️', '💎', '🎓', '💍', '🏖️', '🍼', '📱', '🎁'];
const GOAL_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#D4AF37'];

const STATUS_META: Record<Goal['status'], { label: string; tone: 'emerald' | 'blue' | 'amber' | 'slate' | 'red' }> = {
  'not-started': { label: '未开始', tone: 'slate' },
  active: { label: '进行中', tone: 'blue' },
  achieved: { label: '已达成', tone: 'emerald' },
  expired: { label: '已过期', tone: 'red' },
  archived: { label: '已归档', tone: 'slate' },
};

export function GoalsPanel() {
  const channels = useAppStore((s) => s.channels);
  const history = useAppStore((s) => s.history);
  const goals = useAppStore((s) => s.goals);
  const primaryGoalId = useAppStore((s) => s.primaryGoalId);
  const countdown = useAppStore((s) => s.countdown);
  const goalAchieved = useAppStore((s) => s.goalAchieved);
  const coinRainConfig = useAppStore((s) => s.coinRainConfig);
  const { setCoinRainConfig, triggerCoinRain, markGoalAchieved, upsertGoal, deleteGoal, setPrimaryGoal, pushToast } = useAppStore();

  const [editor, setEditor] = useState<{ open: boolean; goal: Goal | null }>({ open: false, goal: null });
  const now = useNow();

  const total = totalAssets(channels);
  const level = getLevelByAmount(total);
  const primary = goals.find((g) => g.id === primaryGoalId) ?? goals[0] ?? null;

  const amountProgress = countdown.targetAmount > 0 ? Math.min(100, (total / countdown.targetAmount) * 100) : 0;
  const cdState = computeCountdownState(now, countdown);
  const cdDur = countdownDuration(now, countdown);
  const cdText = formatCountdown(cdDur, countdown.displayMode ?? 'calendar', countdown.showSeconds);

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

  const activeGoals = goals.filter((g) => g.status !== 'archived');

  return (
    <div className="space-y-4">
      {/* 主目标 Hero */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-slate-800">{primary ? `${primary.icon} ${primary.name}` : '财富目标'}</h2>
            <p className="text-xs text-slate-500">主目标 · 时区 {countdown.timezone || getDefaultTimezone()}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => triggerCoinRain()}>🪙 金币雨</Button>
            <Button variant="outline" size="sm" onClick={() => useNavigationStore.getState().navigate({ tab: 'prediction', goalId: primary?.id })}>🔭 查看预测</Button>
            {primary && <AIActionButton task="goal-scenario" goalId={primary.id}>AI 解释目标情景</AIActionButton>}
            <Button variant="outline" size="sm" onClick={() => setEditor({ open: true, goal: primary })}>✎ 编辑主目标</Button>
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

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1"><span>时间进度</span><span className="tabular">{cdState.timeProgress.toFixed(0)}%</span></div>
            <ProgressBar value={cdState.timeProgress} barClassName="bg-gradient-to-r from-blue-400 to-cyan-500" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1"><span>金额进度</span><span className="tabular">{amountProgress.toFixed(0)}%</span></div>
            <ProgressBar value={amountProgress} barClassName="bg-gradient-to-r from-emerald-400 to-emerald-600" />
          </div>
        </div>

        {goalAchieved.hasAchievedGoal && (
          <div className="mt-3 text-center"><Badge tone="amber">🏆 已达成目标！</Badge></div>
        )}
      </Card>

      {/* 多目标列表 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">我的目标（{activeGoals.length}）</h2>
          <Button size="sm" onClick={() => setEditor({ open: true, goal: null })}>＋ 新建目标</Button>
        </div>
        {activeGoals.length === 0 ? (
          <EmptyState icon="🎯" title="还没有目标" description="建立百万目标、应急金目标、旅行资金等资产目标。" />
        ) : (
          <div className="space-y-2">
            {activeGoals.map((g) => {
              const status = goalStatusOf(g, now, total);
              const pct = goalAmountProgress(total, g.targetAmount);
              const isPrimary = g.id === primaryGoalId;
              return (
                <div key={g.id} className={`border rounded-xl p-3 ${isPrimary ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xl" aria-hidden>{g.icon}</span>
                    <span className="font-medium text-slate-800 flex-1 min-w-0 truncate">{g.name}</span>
                    <Badge tone={STATUS_META[status].tone}>{STATUS_META[status].label}</Badge>
                    {isPrimary && <Badge tone="emerald">主目标</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    <span className="tabular">{formatCNY(total)} / {formatCNY(g.targetAmount)}</span>
                    <span className="tabular">{pct.toFixed(1)}%</span>
                    <span className="ml-auto text-slate-400">{g.targetDateTime.slice(0, 10)}</span>
                  </div>
                  <ProgressBar value={pct} className="mt-2" barClassName="bg-gradient-to-r from-emerald-400 to-emerald-600" />
                  <div className="flex gap-3 mt-2 text-xs">
                    <button className="text-slate-500 hover:text-emerald-600" onClick={() => setEditor({ open: true, goal: g })}>编辑</button>
                    {!isPrimary && <button className="text-slate-500 hover:text-blue-600" onClick={() => { setPrimaryGoal(g.id); pushToast(`已设为主目标：${g.name}`, 'success'); }}>设为主目标</button>}
                    <button className="text-slate-400 hover:text-red-500" onClick={() => deleteGoal(g.id)}>删除</button>
                  </div>
                </div>
              );
            })}
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
            <SliderField label="风力" min={0} max={1} step={0.05} value={coinRainConfig.windStrength} onChange={(v) => setCoinRainConfig({ ...coinRainConfig, windStrength: v })} format={(v) => `${Math.round(v * 100)}%`} ariaLabel="风力" />
          </div>
        </div>
      </Card>

      <GoalEditor
        open={editor.open}
        goal={editor.goal}
        total={total}
        onClose={() => setEditor({ open: false, goal: null })}
        onSave={(g) => { upsertGoal(g); setEditor({ open: false, goal: null }); pushToast('目标已保存', 'success'); }}
      />
    </div>
  );
}

function GoalEditor({ open, goal, total, onClose, onSave }: {
  open: boolean;
  goal: Goal | null;
  total: number;
  onClose: () => void;
  onSave: (g: Goal) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🎯');
  const [color, setColor] = useState('#3B82F6');
  const [targetAmount, setTargetAmount] = useState('');
  const [startDate, setStartDate] = useState(todayString());
  const [startTime, setStartTime] = useState('00:00');
  const [targetDate, setTargetDate] = useState(addDays(todayString(), 365));
  const [targetTime, setTargetTime] = useState('00:00');
  const [timezone, setTimezone] = useState(getDefaultTimezone());
  const [displayMode, setDisplayMode] = useState<GoalDisplayMode>('calendar');
  const [showSeconds, setShowSeconds] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (goal) {
      setName(goal.name);
      setIcon(goal.icon);
      setColor(goal.color);
      setTargetAmount(String(goal.targetAmount));
      setStartDate(goal.startDateTime.slice(0, 10));
      setStartTime(goal.startDateTime.slice(11, 16));
      setTargetDate(goal.targetDateTime.slice(0, 10));
      setTargetTime(goal.targetDateTime.slice(11, 16));
      setTimezone(goal.timezone || getDefaultTimezone());
      setDisplayMode(goal.displayMode);
      setShowSeconds(goal.showSeconds);
      setNotes(goal.notes ?? '');
    } else {
      setName('');
      setIcon('🎯');
      setColor('#3B82F6');
      setTargetAmount('');
      setStartDate(todayString());
      setStartTime('00:00');
      setTargetDate(addDays(todayString(), 365));
      setTargetTime('00:00');
      setTimezone(getDefaultTimezone());
      setDisplayMode('calendar');
      setShowSeconds(true);
      setNotes('');
    }
    setError('');
  }, [open, goal]);

  function submit() {
    const amt = parseMoney(targetAmount);
    if (amt === null) { setError('请输入有效的目标金额'); return; }
    const startDateTime = `${startDate}T${startTime}`;
    const targetDateTime = `${targetDate}T${targetTime}`;
    const v = validateGoal({ targetAmount: amt, startDateTime, targetDateTime, timezone });
    if (!v.ok) { setError(v.errors[0] ?? '目标信息无效'); return; }
    const g = goal ?? makeGoal();
    onSave({
      ...g,
      name: name.trim() || '财富目标',
      icon,
      color,
      targetAmount: amt,
      startDateTime,
      targetDateTime,
      timezone,
      displayMode,
      showSeconds,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={goal ? '编辑目标' : '新建目标'} size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={submit}>保存</Button>
      </>}>
      <div className="space-y-4">
        {amtBelowTotal(total, targetAmount) && <p className="text-xs text-amber-600">提示：当前资产已达或超过目标金额，保存后该目标将被视为「已达成」。</p>}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="目标名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：存下第一个一百万" />
          <SelectField label="图标" value={icon} onChange={(e) => setIcon(e.target.value)} options={GOAL_ICONS.map((i) => ({ value: i, label: i }))} />
        </div>
        <MoneyField label="目标金额" value={targetAmount === '' ? '' : Number(targetAmount)} onChange={(v) => setTargetAmount(v === '' ? '' : String(v))} error={error} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="起始日期" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextField label="起始时间" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <TextField label="目标日期" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          <TextField label="目标时间" type="time" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} />
        </div>
        <SelectField label="时区" value={timezone} onChange={(e) => setTimezone(e.target.value)}
          options={[...new Set([timezone, getDefaultTimezone(), ...TIMEZONE_OPTIONS])].map((t) => ({ value: t, label: t }))} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="显示格式" value={displayMode} onChange={(e) => setDisplayMode(e.target.value as GoalDisplayMode)}
            options={[
              { value: 'calendar', label: '年/月/日/时分秒' },
              { value: 'days', label: '日/时分秒' },
              { value: 'hours', label: '总小时' },
              { value: 'simple', label: '简洁（天）' },
            ]} />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">颜色</label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {GOAL_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className="h-7 w-7 rounded-full border-2" style={{ background: c, borderColor: color === c ? '#0f172a' : 'transparent' }} aria-label={c} />
              ))}
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showSeconds} onChange={(e) => setShowSeconds(e.target.checked)} className="h-4 w-4 text-emerald-600 rounded" />
          <span className="text-sm text-slate-700">显示秒</span>
        </label>
        <TextField label="备注（可选）" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="如：应急金、旅行基金…" />
      </div>
    </Modal>
  );
}

function amtBelowTotal(total: number, targetAmount: string): boolean {
  const amt = parseMoney(targetAmount);
  return amt !== null && total >= amt;
}
