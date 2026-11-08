import { Badge, Button, Card } from '../../components/ui/primitives';
import { FINANCE_TASK_KIND_LABELS, taskKindOf } from '../../domain/portfolio/session';
import type { FinanceTaskKind } from '../../domain/portfolio/types';
import { useNavigationStore } from '../../store/navigationStore';
import { useAIConnectionStore } from '../../store/aiConnectionStore';
import { MonthlyPlannerPanel } from '../monthlyPlanning/MonthlyPlannerPanel';
import { FinanceTaskPanel } from './FinanceTaskPanel';
import { useAppStore } from '../../store/appStore';
import { PageHeader } from '../../components/ui/workspace';

const TASK_CARDS: Array<{
  kind: FinanceTaskKind;
  description: string;
  outcome: string;
}> = [
  { kind: 'initial-reconciliation', description: '从旧的或现有的渠道资料建立真实期初基线。', outcome: '渠道映射、差异、缺项与确认基线' },
  { kind: 'monthly-review', description: '对照上月快照、现金流、策略和人工回执完成月结。', outcome: '变化归因、执行偏差与正式月记录' },
  { kind: 'ad-hoc-rebalance', description: '处理现金需求、事件驱动调整和约束冲突。', outcome: '可解释候选、人工回执与复核' },
  { kind: 'fund-analysis', description: '核对基金代码、份额类别、成本、费用与流动性。', outcome: '来源卡片、风险重叠与适配约束' },
  { kind: 'take-profit-review', description: '按参考份额、已实现和在途量审查止盈台阶。', outcome: '不重复执行的新增可执行量' },
  { kind: 'market-intelligence', description: '抓取你明确提供的公开 HTTPS 来源并保存时点。', outcome: '发布日期、获取日期、相关性与计划影响' },
  { kind: 'special-research', description: '围绕明确问题整理本地事实和选定证据。', outcome: '可复用、可追溯的只读研究结果' },
];

export function FinanceWorkbench() {
  const kind = useNavigationStore((state) => state.financeTaskKind ?? 'monthly-review');
  const taskId = useNavigationStore((state) => state.financeTaskId);
  const navigate = useNavigationStore((state) => state.navigate);
  const aiEnabled = useAIConnectionStore((state) => state.enabled);
  const aiBusy = useAIConnectionStore((state) => state.busy);
  const connections = useAIConnectionStore((state) => state.profiles);
  const currentId = useAIConnectionStore((state) => state.activeProfileId);
  const activate = useAIConnectionStore((state) => state.activate);
  const sessions = useAppStore((state) => state.monthlyPlanning.sessions);
  const current = connections.find((item) => item.profileId === currentId);
  const enabledConnections = connections.filter((item) => item.enabled);
  const selected = TASK_CARDS.find((item) => item.kind === kind) ?? TASK_CARDS[1]!;
  const latestTask = [...sessions]
    .filter((task) => !['archived', 'cancelled'].includes(task.state))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="连续理财工作区"
        title={selected ? FINANCE_TASK_KIND_LABELS[kind] : '理财工作台'}
        description="从证据、核对、方案到人工回执与归档使用同一份权威账本；AI 关闭时仍可完成本地工作。"
        context={<><span>{sessions.filter((task) => !['archived', 'cancelled'].includes(task.state)).length} 个进行中任务</span><span>·</span><span>当前连接 {current?.label ?? 'AI 已关闭/未选择'}</span></>}
        primaryAction={latestTask ? (
          <Button onClick={() => navigate({ tab: 'monthly', financeTaskKind: taskKindOf(latestTask), financeTaskId: latestTask.key })}>
            继续上次工作
          </Button>
        ) : <Button onClick={() => navigate({ tab: 'monthly', financeTaskKind: 'monthly-review' })}>开始月度复盘</Button>}
      />
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">理财工作台</h2>
            <p className="mt-1 text-sm text-slate-600">从证据到人工回执，全程使用同一权威账本；没有 AI 时仍可完成对账、计算、方案和归档。</p>
          </div>
          <Badge tone="blue">{selected.outcome}</Badge>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {TASK_CARDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => navigate({ tab: 'monthly', financeTaskKind: item.kind })}
              aria-pressed={kind === item.kind}
              className={`rounded-xl border p-3 text-left transition ${kind === item.kind
                ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <strong className="block text-sm text-slate-900">{FINANCE_TASK_KIND_LABELS[item.kind]}</strong>
              <span className="mt-1 block text-xs text-slate-600">{item.description}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm">
          <span className="font-medium">当前连接</span>
          {current
            ? <Badge tone={aiEnabled ? 'emerald' : 'slate'}>{current.label}</Badge>
            : <Badge tone="slate">{aiEnabled ? '未选择' : 'AI 已关闭'}</Badge>}
          {aiEnabled && enabledConnections.filter((item) => item.profileId !== currentId).map((connection) => (
            <Button key={connection.profileId} size="sm" variant="outline" disabled={aiBusy}
              onClick={() => void activate(connection.profileId).catch(() => {})}>
              切到 {connection.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => navigate({ tab: 'ai', settingsSection: 'ai' })}>管理连接</Button>
        </div>
      </Card>

      {kind === 'monthly-review'
        ? <MonthlyPlannerPanel />
        : <FinanceTaskPanel key={`${kind}:${taskId ?? ''}`} kind={kind} initialTaskId={taskId} />}
    </div>
  );
}
