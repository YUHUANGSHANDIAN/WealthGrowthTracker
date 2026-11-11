import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useNavigationStore } from '../../store/navigationStore';
import { Card, Button, EmptyState } from '../../components/ui/primitives';
import { MetricCard, PageHeader } from '../../components/ui/workspace';
import { LineChart } from '../../components/charts/LineChart';
import { totalAssets, channelAmount as channelTotal } from '../../utils/channels';
import { formatCNY } from '../../utils/money';
import { addDays, todayString } from '../../utils/date';
import { WealthHeroCard } from './WealthHeroCard';
import { buildWorkQueue } from '../workspace/workQueue';
import { taskKindOf } from '../../domain/portfolio/session';

export function OverviewPanel({ onOpenLevels }: { onOpenLevels: () => void }) {
  const channels = useAppStore((state) => state.channels);
  const history = useAppStore((state) => state.history);
  const reports = useAppStore((state) => state.reports);
  const goals = useAppStore((state) => state.goals);
  const primaryGoalId = useAppStore((state) => state.primaryGoalId);
  const levelAchievements = useAppStore((state) => state.levelAchievements);
  const lottery = useAppStore((state) => state.lottery);
  const monthlyPlanning = useAppStore((state) => state.monthlyPlanning);
  const assetClassification = useAppStore((state) => state.assetClassification);
  const healthReviews = useAppStore((state) => state.healthReviews.records);
  const ledgerId = useAppStore((state) => state.ledgerIdentity.ledgerId);
  const drafts = useAppStore((state) => state.workspaceDrafts);
  const dataRevision = useAppStore((state) => state.dataRevision);
  const hiddenModules = useAppStore((state) => state.workspaceViews.overviewHiddenModules);
  const setOverviewHiddenModules = useAppStore((state) => state.setOverviewHiddenModules);
  const navigate = useNavigationStore((state) => state.navigate);
  const [showAllWork, setShowAllWork] = useState(false);
  const today = todayString();
  const points = useMemo(() => history.filter((point) => point.date <= today).sort((a, b) => a.date.localeCompare(b.date)), [history, today]);
  const recent = points.filter((point) => point.date >= addDays(today, -30));
  const latest = points[points.length - 1];
  const first = recent[0];
  const change = first && latest && first.date !== latest.date ? latest.totalAmount - first.totalAmount : null;
  const total = totalAssets(channels);
  const workQueue = useMemo(() => buildWorkQueue({
    channels, history, reports, goals, primaryGoalId, levelAchievements, lottery,
    monthlyPlanning, assetClassification, healthReviews, ledgerId, drafts, dataRevision,
  }), [assetClassification, channels, dataRevision, drafts, goals, healthReviews, history, ledgerId, levelAchievements, lottery, monthlyPlanning, primaryGoalId, reports]);
  const visibleWork = showAllWork ? workQueue : workQueue.slice(0, 5);
  const latestReports = useMemo(() => [...reports].sort((a, b) => b.endDate.localeCompare(a.endDate)).slice(0, 3), [reports]);
  const financeTasks = useMemo(() => monthlyPlanning.sessions
    .filter((task) => !['archived', 'cancelled'].includes(task.state))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)), [monthlyPlanning.sessions]);
  const primaryGoal = goals.find((goal) => goal.id === primaryGoalId) ?? goals.find((goal) => goal.status !== 'archived');

  function hideModule(id: string) {
    setOverviewHiddenModules([...new Set([...hiddenModules, id])]);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="当前工作台"
        title="现在怎样，接下来做什么"
        description="关键金额、待处理事项和跨页面入口集中在首屏；展开区域再查看解释与历史。"
        context={<><span>业务日期 {today}</span><span>·</span><span>当前余额与历史快照分开显示</span></>}
        primaryAction={<Button onClick={() => navigate({ tab: 'assets' })}>更新资产</Button>}
        secondaryActions={<Button variant="outline" onClick={() => navigate({ tab: 'data' })}>打开核对工作台</Button>}
      />
      <WealthHeroCard onOpenLevels={onOpenLevels} />
      <div className="overview-stats">
        <MetricCard
          label="最近 30 天资产变化"
          value={change === null ? '数据不足' : `${change >= 0 ? '+' : ''}${formatCNY(change)}`}
          detail={first && latest ? `${first.date} → ${latest.date}，基于真实历史快照` : '至少需要两个不同日期的记录'}
          tone={change === null ? 'unknown' : change >= 0 ? 'positive' : 'negative'}
          context={{ basis: '历史快照', asOf: latest?.date, status: change === null ? 'unknown' : 'confirmed', scope: '全部渠道' }}
        />
        <MetricCard
          label="最新真实快照"
          value={latest?.date ?? '尚未记录'}
          detail={latest?.date === today ? '今天已有记录' : '当前渠道余额与最后一次历史快照可能不同'}
          tone={latest ? 'neutral' : 'unknown'}
          context={{ basis: '历史观察', asOf: latest?.date, status: latest ? 'confirmed' : 'unknown', scope: '全部渠道' }}
          action={<button type="button" onClick={() => navigate({ tab: 'history', historyDate: latest?.date })}>查看来源</button>}
        />
        <MetricCard
          label="需要处理"
          value={`${workQueue.length} 项`}
          detail="按完整性、任务阻塞和数据变化排序"
          tone={workQueue.length ? 'warning' : 'positive'}
          context={{ basis: '数据健康与任务状态', status: workQueue.length ? 'pending' : 'confirmed', scope: '不含已解决项' }}
          action={<button type="button" onClick={() => navigate({ tab: 'data' })}>查看全部</button>}
        />
      </div>
      <div className="overview-grid">
        <div className="space-y-5">
          {!hiddenModules.includes('work') && (
            <Card className="overview-section">
              <div className="flex items-start justify-between gap-3"><div><h3>待办事项</h3><p className="mt-1 text-xs text-slate-500">来自真实任务、报告、健康问题与过期草稿，不建立第二份待办账本。</p></div><Button size="sm" variant="ghost" aria-label="隐藏待办事项" onClick={() => hideModule('work')}>隐藏</Button></div>
              {visibleWork.length === 0 ? <EmptyState icon="✓" title="当前没有需要处理的事项" description="仍建议定期核对备份和资产来源。" /> : (
                <div className="mt-3 divide-y divide-slate-100">{visibleWork.map((item) => (
                  <button key={item.id} type="button" className="flex w-full items-start gap-3 py-3 text-left" onClick={() => navigate(item.route)}>
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.priority === 'critical' ? 'bg-red-500' : item.priority === 'high' ? 'bg-amber-500' : 'bg-slate-400'}`} aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-800">{item.title}</span><span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{item.description}</span></span>
                    <span className="shrink-0 text-xs font-medium text-emerald-700">{item.actionLabel} ›</span>
                  </button>
                ))}</div>
              )}
              {workQueue.length > 5 && <Button className="mt-2" size="sm" variant="ghost" onClick={() => setShowAllWork((value) => !value)}>{showAllWork ? '收起' : `查看全部 ${workQueue.length} 项`}</Button>}
            </Card>
          )}
          {!hiddenModules.includes('trend') && (
            <Card className="overview-section">
              <div className="flex items-center justify-between gap-3"><div><h3>资产轨迹</h3><p className="mt-1 text-xs text-slate-500">最近 30 天真实历史快照；实时余额不混入曲线。</p></div><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => hideModule('trend')}>隐藏</Button><Button size="sm" variant="outline" onClick={() => navigate({ tab: 'analysis', startDate: addDays(today, -30), endDate: today })}>深入分析</Button></div></div>
              {recent.length ? <LineChart series={[{ id: 'total', name: '总资产', color: 'var(--wealth-primary)', points: recent.map((point) => ({ date: point.date, value: point.totalAmount })), area: true }]} ariaLabel="最近三十天资产轨迹" /> : <EmptyState title="开始记录你的资产轨迹" description="更新渠道金额后，今日快照会出现在这里。" action={<Button onClick={() => navigate({ tab: 'assets' })}>建立资产记录</Button>} />}
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card className="overview-section">
            <div className="flex items-start justify-between gap-2"><div><h3>本期理财</h3><p className="mt-1 text-xs text-slate-500">继续原任务，不复制新任务。</p></div><Button size="sm" variant="ghost" onClick={() => navigate({ tab: 'monthly', financeTaskKind: 'monthly-review' })}>全部</Button></div>
            {financeTasks.slice(0, 3).map((task) => <button key={task.key} type="button" className="mt-3 flex w-full items-center justify-between gap-3 text-left" onClick={() => navigate({ tab: 'monthly', financeTaskKind: taskKindOf(task), financeTaskId: task.key })}><span className="min-w-0"><span className="block truncate text-sm font-medium">{task.title || task.key}</span><span className="text-xs text-slate-500">{task.snapshotAsOf} · revision {task.revision}</span></span><span className="shrink-0 text-xs text-emerald-700">继续 ›</span></button>)}
            {!financeTasks.length && <p className="mt-3 text-sm text-slate-500">当前没有进行中的理财任务。</p>}
          </Card>
          <Card className="overview-section">
            <h3>目标进度</h3>
            {primaryGoal ? <button className="mt-3 block w-full text-left" type="button" onClick={() => navigate({ tab: 'goals', goalId: primaryGoal.id })}><span className="text-sm font-medium">{primaryGoal.icon} {primaryGoal.name}</span><p className="mt-1 text-xs text-slate-500">目标 {formatCNY(primaryGoal.targetAmount)} · 当前共同资产基数 {formatCNY(total)}</p></button> : <p className="mt-3 text-sm text-slate-500">尚未建立目标。</p>}
          </Card>
          {!hiddenModules.includes('reports') && <Card className="overview-section"><div className="flex items-center justify-between"><h3>最近报告</h3><Button size="sm" variant="ghost" onClick={() => hideModule('reports')}>隐藏</Button></div>{latestReports.map((report) => <button key={report.id} type="button" className="mt-3 block w-full text-left" onClick={() => navigate({ tab: 'reports', reportId: report.id })}><span className="block text-sm font-medium">{report.title}</span><span className="text-xs text-slate-500">数据截至 {report.dataAsOf ?? report.endDate} · {formatCNY(report.totalAmount)}</span></button>)}{!latestReports.length && <p className="mt-3 text-sm text-slate-500">还没有周期报告。</p>}</Card>}
          <Card className="overview-section"><h3>资产分布</h3><div className="mt-2 space-y-3">{channels.filter((channel) => !channel.archived).map((channel) => <button key={channel.id} type="button" className="block w-full text-left" onClick={() => navigate({ tab: 'assets', channelId: channel.id })}><div className="flex justify-between gap-3 text-sm"><span>{channel.emoji} {channel.name}</span><span className="tabular">{formatCNY(channelTotal(channel))}</span></div><div className="mt-1.5 h-1.5 rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${total > 0 ? Math.max(0, Math.min(100, channelTotal(channel) / total * 100)) : 0}%`, background: channel.color }} /></div></button>)}</div></Card>
        </div>
      </div>
      {hiddenModules.length > 0 && <button type="button" className="text-xs text-slate-500 underline" onClick={() => setOverviewHiddenModules([])}>恢复所有总览模块</button>}
    </div>
  );
}
