import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Badge, Button, Card, EmptyState } from '../../components/ui/primitives';
import { SelectField, TextArea, TextField } from '../../components/ui/form';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { useNavigationStore } from '../../store/navigationStore';
import { useAppStore } from '../../store/appStore';
import { useAIConnectionStore } from '../../store/aiConnectionStore';
import { todayString } from '../../utils/date';
import { sumMoney } from '../../domain/portfolio/decimal';
import { cashflowSummary, usableCash } from '../../domain/portfolio/cashflow';
import { generateProposal, type ProposalPosition } from '../../domain/portfolio/proposals';
import {
  FINANCE_TASK_KIND_LABELS,
  advanceSession,
  createFinanceDraftSession,
  taskKindOf,
  transitionSession,
} from '../../domain/portfolio/session';
import type {
  ExecutionRecord,
  FinanceTaskKind,
  FinanceTaskResult,
  InvestmentPolicy,
  MonthlyReview,
  ProposedAction,
  ResearchEvidence,
} from '../../domain/portfolio/types';
import { importDocuments, type FileLike } from '../../services/monthlyPlanning/importDocuments';
import { researchEvidenceFrom, parseUrlLines } from '../monthlyPlanning/aiEntry';
import { researchLookupAI } from '../../services/ai/client';
import { projectMonthlyPlanningClassification } from '../../domain/assets/classification';
import { useWorkspaceDraft } from '../../hooks/useWorkspaceDraft';
import { DraftStatusBar } from '../../components/ui/DraftStatusBar';
import { TaskStepper } from '../../components/ui/workspace';
import { formatCNY } from '../../utils/money';

const TRADE_TASKS = new Set<FinanceTaskKind>(['ad-hoc-rebalance', 'take-profit-review']);
const RESULT_STAGES = new Set<string>(['reviewing', 'ready', 'planned', 'confirmed', 'reviewed', 'blocked']);

const STAGE_LABELS: Record<MonthlyReview['state'], string> = {
  draft: '新建',
  extracting: '整理资料',
  reviewing: '核对中',
  ready: '结果就绪',
  planned: '待确认',
  confirmed: '已批准',
  reviewed: '已复核',
  archived: '已归档',
  blocked: '受阻',
  cancelled: '已取消',
};

function defaultPolicy(now: string): InvestmentPolicy {
  return {
    id: 'policy-default',
    version: 1,
    effectiveFrom: now,
    approvedByUser: false,
    targetAllocation: {},
    riskLimits: [],
    liquidityFloor: null,
    minTradeAmount: 100,
    minTradeShares: null,
    cooldownDays: 0,
    feeRate: null,
    takeProfit: null,
    planLevelExecution: false,
  };
}

function latestPolicy(policies: readonly InvestmentPolicy[], policyId: string | null | undefined): InvestmentPolicy | null {
  const scoped = policyId ? policies.filter((item) => item.id === policyId) : [];
  return (scoped.length ? scoped : policies).reduce<InvestmentPolicy | null>(
    (latest, item) => (!latest || item.version > latest.version ? item : latest),
    null,
  );
}

function resultOf(task: MonthlyReview): FinanceTaskResult {
  return task.result ?? { summary: '', findings: [], noAction: false };
}

const TASK_STEPS: Record<Exclude<FinanceTaskKind, 'monthly-review'>, string[]> = {
  'initial-reconciliation': ['任务与范围', '资料与候选', '差异核对', '确认基线', '归档'],
  'ad-hoc-rebalance': ['范围与策略', '候选计算', '方案比较', '用户批准', '人工回执', '复核归档'],
  'fund-analysis': ['身份与来源', '持仓重叠', '分析结论', '复核归档'],
  'take-profit-review': ['规则与资格', '候选计算', '方案比较', '用户批准', '人工回执', '复核归档'],
  'market-intelligence': ['来源范围', '抓取与日期', '影响摘要', '复核归档'],
  'special-research': ['问题范围', '证据整理', '研究结论', '限制复核', '归档'],
};

function taskStepIndex(state: MonthlyReview['state'], length: number): number {
  if (state === 'archived') return length;
  if (state === 'reviewed') return Math.max(0, length - 1);
  if (state === 'confirmed') return Math.max(0, length - 2);
  if (state === 'ready' || state === 'planned') return Math.min(length - 2, 2);
  if (state === 'reviewing') return Math.min(length - 2, 1);
  if (state === 'extracting') return Math.min(length - 2, 1);
  return 0;
}

function comparisonMetrics(actions: readonly ProposedAction[]) {
  let cashUse = 0;
  let unknownAmounts = 0;
  for (const action of actions) {
    if (action.amount === null) {
      unknownAmounts += 1;
      continue;
    }
    if (action.kind === 'sell' || action.kind === 'take-profit') cashUse -= action.amount;
    else if (action.kind === 'buy' || action.kind === 'rebalance') cashUse += action.amount;
  }
  return {
    actionCount: actions.length,
    cashUse,
    unknownAmounts,
    blockers: actions.reduce((sum, action) => sum + action.blockers.length, 0),
    constraints: actions.reduce((sum, action) => sum + action.constraintsApplied.length, 0),
  };
}

export function FinanceTaskPanel({
  kind,
  initialTaskId,
}: {
  kind: Exclude<FinanceTaskKind, 'monthly-review'>;
  initialTaskId?: string;
}) {
  const rawPlanning = useAppStore((state) => state.monthlyPlanning);
  const assetClassification = useAppStore((state) => state.assetClassification);
  const planning = useMemo(
    () => projectMonthlyPlanningClassification(rawPlanning, assetClassification),
    [rawPlanning, assetClassification],
  );
  const channels = useAppStore((state) => state.channels);
  const dataRevision = useAppStore((state) => state.dataRevision);
  const upsertTask = useAppStore((state) => state.upsertMonthlySession);
  const savePolicy = useAppStore((state) => state.saveMonthlyPolicy);
  const recordExecution = useAppStore((state) => state.recordMonthlyExecution);
  const deleteTask = useAppStore((state) => state.deleteMonthlySession);
  const pushToast = useAppStore((state) => state.pushToast);
  const routeEvidenceId = useNavigationStore((state) => state.financeEvidenceId);

  const aiEnabled = useAIConnectionStore((state) => state.enabled);
  const profiles = useAIConnectionStore((state) => state.profiles);
  const activeProfileId = useAIConnectionStore((state) => state.activeProfileId);
  const activeConnection = aiEnabled ? profiles.find((item) => item.profileId === activeProfileId) : undefined;

  const tasks = useMemo(
    () => planning.sessions
      .filter((task) => taskKindOf(task) === kind)
      .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1)),
    [kind, planning.sessions],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    tasks.some((task) => task.key === initialTaskId) ? initialTaskId ?? null : tasks[0]?.key ?? null,
  );
  const selected = tasks.find((task) => task.key === selectedId) ?? tasks[0] ?? null;
  const policy = latestPolicy(planning.policies, selected?.policyId);
  const [title, setTitle] = useState(selected?.title ?? FINANCE_TASK_KIND_LABELS[kind]);
  const [note, setNote] = useState(selected?.note ?? '');
  const [snapshotAsOf, setSnapshotAsOf] = useState(selected?.snapshotAsOf ?? todayString());
  const [deadlineAt, setDeadlineAt] = useState(selected?.deadlineAt ?? '');
  const [resultSummary, setResultSummary] = useState(selected ? resultOf(selected).summary : '');
  const [findings, setFindings] = useState(selected ? resultOf(selected).findings.join('\n') : '');
  const [noAction, setNoAction] = useState(selected ? resultOf(selected).noAction : false);
  const [importChannelId, setImportChannelId] = useState(channels[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [researchUrl, setResearchUrl] = useState('');
  const [receiptAction, setReceiptAction] = useState<ProposedAction | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<ExecutionRecord['status']>('executed');
  const [receiptAmount, setReceiptAmount] = useState<number | ''>('');
  const [comparisonSelection, setComparisonSelection] = useState<string[] | null>(null);
  const [applyComparisonOpen, setApplyComparisonOpen] = useState(false);

  const editableTask = selected && !['archived', 'cancelled'].includes(selected.state) ? selected : null;
  const draftBaseline = useMemo(() => ({
    title: editableTask?.title ?? '',
    note: editableTask?.note ?? '',
    snapshotAsOf: editableTask?.snapshotAsOf ?? '',
    deadlineAt: editableTask?.deadlineAt ?? '',
    resultSummary: editableTask ? resultOf(editableTask).summary : '',
    findings: editableTask ? resultOf(editableTask).findings.join('\n') : '',
    noAction: editableTask ? resultOf(editableTask).noAction : false,
  }), [editableTask]);
  const draftPayload = useMemo(() => ({
    title, note, snapshotAsOf, deadlineAt, resultSummary, findings, noAction,
  }), [deadlineAt, findings, noAction, note, resultSummary, snapshotAsOf, title]);
  const draft = useWorkspaceDraft({
    kind: 'finance-task',
    targetId: editableTask?.key ?? '',
    baseRevision: dataRevision,
    baseEntityRevision: editableTask?.revision ?? 0,
    baseline: draftBaseline,
    payload: draftPayload,
    enabled: Boolean(editableTask),
    onRestore: (restored) => {
      if (typeof restored.title === 'string') setTitle(restored.title);
      if (typeof restored.note === 'string') setNote(restored.note);
      if (typeof restored.snapshotAsOf === 'string') setSnapshotAsOf(restored.snapshotAsOf);
      if (typeof restored.deadlineAt === 'string') setDeadlineAt(restored.deadlineAt);
      if (typeof restored.resultSummary === 'string') setResultSummary(restored.resultSummary);
      if (typeof restored.findings === 'string') setFindings(restored.findings);
      if (typeof restored.noAction === 'boolean') setNoAction(restored.noAction);
    },
  });
  const proposalActionIds = useMemo(
    () => (selected?.proposal?.actions ?? []).map((action) => action.id),
    [selected?.proposal?.actions],
  );
  const comparisonBaseline = useMemo(
    () => ({ selectedActionIds: proposalActionIds }),
    [proposalActionIds],
  );
  const comparisonPayload = useMemo(
    () => ({ selectedActionIds: comparisonSelection ?? proposalActionIds }),
    [comparisonSelection, proposalActionIds],
  );
  const comparisonDraft = useWorkspaceDraft({
    kind: 'finance-comparison',
    targetId: selected?.key ? `${selected.key}:comparison` : '',
    baseRevision: dataRevision,
    baseEntityRevision: selected?.revision ?? 0,
    baseline: comparisonBaseline,
    payload: comparisonPayload,
    enabled: Boolean(selected?.proposal),
    onRestore: (restored) => {
      if (Array.isArray(restored.selectedActionIds)) {
        setComparisonSelection(restored.selectedActionIds.filter((id): id is string => typeof id === 'string'));
      }
    },
  });

  useEffect(() => {
    setComparisonSelection(null);
  }, [selected?.proposal?.id]);
  useEffect(() => {
    if (!routeEvidenceId || !selected) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`finance-evidence-${routeEvidenceId.replace(/[^0-9A-Za-z_-]/g, '_')}`)?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [routeEvidenceId, selected]);

  function choose(task: MonthlyReview | null) {
    setSelectedId(task?.key ?? null);
    setTitle(task?.title ?? FINANCE_TASK_KIND_LABELS[kind]);
    setNote(task?.note ?? '');
    setSnapshotAsOf(task?.snapshotAsOf ?? todayString());
    setDeadlineAt(task?.deadlineAt ?? '');
    setResultSummary(task ? resultOf(task).summary : '');
    setFindings(task ? resultOf(task).findings.join('\n') : '');
    setNoAction(task ? resultOf(task).noAction : false);
    setError(null);
  }

  useEffect(() => {
    if (!initialTaskId) return;
    const target = tasks.find((task) => task.key === initialTaskId);
    if (target) choose(target);
    // Navigation selection is an entry intent; ordinary store updates must not reset the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);

  async function persist(next: MonthlyReview, label: string, increment = true): Promise<MonthlyReview | null> {
    setBusy(true);
    setError(null);
    const updated = { ...next, revision: next.revision + (increment ? 1 : 0) };
    try {
      await upsertTask(updated, label);
      choose(updated);
      return updated;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createTask() {
    const now = new Date().toISOString();
    const created = createFinanceDraftSession({
      taskKind: kind,
      planningMonth: snapshotAsOf.slice(0, 7) || todayString().slice(0, 7),
      timezone: planning.settings.timezone,
      today: snapshotAsOf || todayString(),
      now,
      title: title || FINANCE_TASK_KIND_LABELS[kind],
    });
    const saved = await persist(created, '正在创建理财任务');
    if (saved) pushToast(`${FINANCE_TASK_KIND_LABELS[kind]}已创建`, 'success');
  }

  async function saveDetails() {
    if (!selected) return;
    const saved = await persist({
      ...selected,
      title: title.trim() || FINANCE_TASK_KIND_LABELS[kind],
      note,
      snapshotAsOf,
      valuationAsOf: selected.valuationAsOf ?? snapshotAsOf,
      deadlineAt: deadlineAt || undefined,
    }, '正在保存任务说明');
    if (saved) await draft.clear();
  }

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    if (!selected) return;
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      let started = selected;
      if (started.state === 'draft' || started.state === 'blocked') {
        started = advanceSession(started, 'extracting', { now: new Date().toISOString() });
        const saved = await persist(started, '正在登记资料');
        if (!saved) return;
        started = saved;
      }
      const imported = await importDocuments({
        session: started,
        files: picked as FileLike[],
        channelId: importChannelId || null,
        now: new Date().toISOString(),
      });
      let next = imported.session;
      if (next.state === 'extracting') next = advanceSession(next, 'reviewing', { now: new Date().toISOString() });
      await persist(next, '正在保存资料候选');
      const ok = imported.outcomes.filter((item) => item.status === 'imported').length;
      const duplicate = imported.outcomes.filter((item) => item.status === 'duplicate').length;
      const failed = imported.outcomes.filter((item) => item.status === 'failed').length;
      pushToast(`资料处理：入库 ${ok}、重复 ${duplicate}、失败 ${failed}`, failed ? 'error' : 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '资料处理失败');
    } finally {
      setBusy(false);
    }
  }

  async function moveToReview() {
    if (!selected) return;
    const reviewing = advanceSession(selected, 'reviewing', { now: new Date().toISOString() });
    await persist(reviewing, '正在进入复核');
  }

  function saveResultOn(task: MonthlyReview): MonthlyReview {
    const summary = resultSummary.trim() || (noAction ? '本期无需进一步操作。' : '');
    if (!summary) throw new Error('请填写任务结果，或明确选择“无需操作”');
    return {
      ...task,
      result: {
        summary,
        findings: findings.split('\n').map((item) => item.trim()).filter(Boolean),
        noAction,
        confirmedAt: new Date().toISOString(),
        approvedPolicyVersion: task.policyVersion,
      },
    };
  }

  async function generateResult() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      let next = saveResultOn(selected);
      if (TRADE_TASKS.has(kind)) {
        let activePolicy = policy;
        if (!activePolicy) {
          activePolicy = defaultPolicy(todayString());
          await savePolicy(activePolicy);
        }
        const positions: ProposalPosition[] = next.holdings.map((holding) => ({
          holdingId: holding.id,
          label: holding.originalName,
          ...(holding.planId ? { planId: holding.planId } : {}),
          marketValue: next.observations.find((item) => item.holdingId === holding.id)?.marketValue ?? null,
          exposureTags: holding.exposureTags,
          takeProfitEligible: kind === 'take-profit-review' && holding.productType === 'fund',
        }));
        const investableTotal = sumMoney(next.observations.map((item) => item.marketValue ?? 0));
        const unknown = next.observations.filter((item) => item.marketValue === null).length;
        next = {
          ...next,
          policyId: activePolicy.id,
          policyVersion: activePolicy.version,
          proposal: generateProposal(activePolicy, {
            investableTotal,
            availableCash: usableCash(null, cashflowSummary(next.cashFlows)),
            positions,
            dataRed: unknown > 0,
            ...(unknown ? { dataRedReasons: [`${unknown} 条观察值金额未知`] } : {}),
          }, { sessionKey: next.key, now: new Date().toISOString() }),
        };
      }
      next = advanceSession(next, 'ready', { now: new Date().toISOString() });
      const saved = await persist(next, '正在生成任务结果');
      if (saved) await draft.clear();
      pushToast('任务结果已生成；尚未批准或执行', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成结果失败');
    } finally {
      setBusy(false);
    }
  }

  async function approveProposal() {
    if (!selected || (!TRADE_TASKS.has(kind) && kind !== 'initial-reconciliation')) return;
    setBusy(true);
    setError(null);
    try {
      const approved = advanceSession(selected, 'confirmed', {
        now: new Date().toISOString(),
        baseDataRevision: dataRevision,
      });
      const saved = await persist(approved, '正在批准任务方案');
      if (saved) await draft.clear();
      pushToast(kind === 'initial-reconciliation' ? '期初基线已确认' : '方案已批准；仍需你在金融平台手工执行并登记回执', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批准失败');
    } finally {
      setBusy(false);
    }
  }

  async function applyAdjustedProposal() {
    if (!selected?.proposal || adjustedComparisonActions.length === 0) return;
    const adjusted: MonthlyReview = {
      ...selected,
      proposal: {
        ...selected.proposal,
        id: crypto.randomUUID(),
        summary: `用户调整方案：保留 ${adjustedComparisonActions.length} 项候选，未勾选项不执行。`,
        actions: adjustedComparisonActions,
      },
    };
    const saved = await persist(adjusted, '正在保存用户调整方案');
    if (!saved) return;
    await comparisonDraft.clear();
    setApplyComparisonOpen(false);
    pushToast('已把用户调整方案设为当前候选；仍需明确批准后才会进入人工回执', 'success');
  }

  async function completeReview() {
    if (!selected) return;
    try {
      const withResult = saveResultOn(selected);
      const reviewed = advanceSession(withResult, 'reviewed', { now: new Date().toISOString() });
      const saved = await persist(reviewed, '正在完成复核');
      if (saved) await draft.clear();
      pushToast('任务已复核，可归档', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '复核失败');
    }
  }

  async function archive() {
    if (!selected) return;
    try {
      const saved = await persist(advanceSession(selected, 'archived', { now: new Date().toISOString() }), '正在归档任务');
      if (saved) await draft.clear();
      pushToast('任务已归档', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '归档失败');
    }
  }

  async function reopen() {
    if (!selected) return;
    try {
      const reopened = transitionSession(selected, 'reviewing', { now: new Date().toISOString(), bumpRevision: true });
      const saved = await persist(reopened, '正在重开任务', false);
      if (saved) await draft.clear();
      pushToast('已作为新修订重开，旧归档版本仍保留', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重开失败');
    }
  }

  async function cancel() {
    if (!selected) return;
    try {
      await persist(advanceSession(selected, 'cancelled', { now: new Date().toISOString() }), '正在取消任务');
      pushToast('任务已取消；未产生任何执行记录', 'info');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取消失败');
    }
  }

  async function remove() {
    if (!selected) return;
    if (!window.confirm(`确认删除“${selected.title}”？已归档修订也会一并删除。`)) return;
    try {
      await deleteTask(selected.key);
      choose(null);
      pushToast('任务已删除', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败');
    }
  }

  async function saveReceipt() {
    if (!selected || !receiptAction) return;
    try {
      await recordExecution(selected.key, {
        id: crypto.randomUUID(),
        proposalId: selected.proposal?.id ?? '',
        actionId: receiptAction.id,
        status: receiptStatus,
        ...(receiptStatus === 'executed' || receiptStatus === 'partially-executed' ? { executedAt: new Date().toISOString() } : {}),
        ...(receiptAmount === '' ? {} : { actualAmount: Number(receiptAmount) }),
        evidence: [],
      });
      setReceiptAction(null);
      setReceiptAmount('');
      pushToast('执行回执已保存；回执不等于应用自动成交', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存回执失败');
    }
  }

  async function fetchResearch() {
    if (!selected || !activeConnection) {
      setError('请先在设置中启用 AI 并选择当前连接；离线时仍可手工填写结果。');
      return;
    }
    const parsed = parseUrlLines(researchUrl);
    if (!parsed.urls.length) {
      setError('请填写至少一个公开 HTTPS 来源');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await researchLookupAI({
        requestId: crypto.randomUUID(),
        profileId: activeConnection.profileId,
        providerId: activeConnection.providerId,
        urls: parsed.urls,
      });
      const now = new Date().toISOString();
      const known = new Set(selected.research.map((item) => item.sourceUrl));
      const added: ResearchEvidence[] = [];
      for (const [index, source] of found.results.entries()) {
        if (known.has(source.url)) continue;
        const evidence = researchEvidenceFrom(source, now, index);
        if (evidence) added.push(evidence);
      }
      if (!added.length) throw new Error('没有新的可保存来源');
      await persist({ ...selected, research: [...selected.research, ...added] }, '正在保存来源核验');
      setResearchUrl('');
      pushToast(`已保存 ${added.length} 条来源`, 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '来源核验失败');
    } finally {
      setBusy(false);
    }
  }

  const canCreate = !selected || ['reviewed', 'archived', 'cancelled'].includes(selected.state);
  const canEdit = selected && !['confirmed', 'reviewed', 'archived', 'cancelled'].includes(selected.state);
  const activeActions = selected?.proposal?.actions ?? [];
  const workflowLabels = TASK_STEPS[kind];
  const workflowIndex = selected ? taskStepIndex(selected.state, workflowLabels.length) : 0;
  const comparisonIds = new Set(comparisonSelection ?? proposalActionIds);
  const originalComparisonActions = selected?.proposal?.actions ?? [];
  const adjustedComparisonActions = originalComparisonActions.filter((action) => comparisonIds.has(action.id));
  const originalMetrics = comparisonMetrics(originalComparisonActions);
  const adjustedMetrics = comparisonMetrics(adjustedComparisonActions);
  const originalFee = policy?.feeRate !== null && policy?.feeRate !== undefined
    ? Math.max(0, originalMetrics.cashUse) * policy.feeRate
    : null;
  const adjustedFee = policy?.feeRate !== null && policy?.feeRate !== undefined
    ? Math.max(0, adjustedMetrics.cashUse) * policy.feeRate
    : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{FINANCE_TASK_KIND_LABELS[kind]}</h3>
          <Button size="sm" variant="outline" disabled={busy || !canCreate} onClick={() => void createTask()}>新建任务</Button>
        </div>
        {!tasks.length
          ? <EmptyState title="还没有任务" description="新建后可以导入证据、填写结论、复核并归档。" />
          : <div className="mt-3 space-y-2">{tasks.map((task) => (
            <button
              key={task.key}
              type="button"
              onClick={() => choose(task)}
              className={`w-full rounded-lg border p-3 text-left ${task.key === selected?.key
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <span className="block text-sm font-medium">{task.title || FINANCE_TASK_KIND_LABELS[kind]}</span>
              <span className="mt-1 flex flex-wrap gap-1 text-xs text-slate-500">
                <Badge tone={task.state === 'archived' ? 'emerald' : task.state === 'blocked' ? 'amber' : 'blue'}>
                  {STAGE_LABELS[task.state]}
                </Badge>
                <span>{task.snapshotAsOf} · rev {task.revision}</span>
              </span>
            </button>
          ))}</div>}
      </Card>

      {!selected ? (
        <Card className="p-5">
          <EmptyState
            title={`新建${FINANCE_TASK_KIND_LABELS[kind]}`}
            description="先建立任务并填写真实观察时点；导入资料不会自动覆盖权威渠道账本。"
            action={<Button disabled={busy} onClick={() => void createTask()}>新建任务</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{selected.title || FINANCE_TASK_KIND_LABELS[kind]}</h3>
                  <Badge tone={selected.state === 'archived' ? 'emerald' : selected.state === 'blocked' ? 'amber' : 'blue'}>
                    {STAGE_LABELS[selected.state]}
                  </Badge>
                  <span className="text-xs text-slate-500">revision {selected.revision}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">观察时点 {selected.valuationAsOf ?? selected.snapshotAsOf} · 当前连接 {activeConnection?.label ?? 'AI 关闭/未选择'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.state === 'archived' && <Button size="sm" variant="outline" onClick={() => void reopen()}>修订重开</Button>}
                {['draft', 'reviewing', 'ready', 'blocked'].includes(selected.state) && <Button size="sm" variant="ghost" onClick={() => void cancel()}>取消任务</Button>}
                <Button size="sm" variant="ghost" onClick={() => void remove()}>删除</Button>
              </div>
            </div>
            {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="mt-3">
              <DraftStatusBar
                status={draft.status}
                error={draft.error}
                staleDraft={draft.staleDraft}
                onSave={() => void draft.saveNow()}
                onDiscard={() => {
                  void draft.discard();
                  choose(selected);
                }}
                onRebase={() => draft.applyStaleDraft(draft.staleDraft?.payload as typeof draftPayload)}
              />
            </div>
            <TaskStepper
              steps={workflowLabels.map((label, index) => ({
                id: `${kind}:${index}`,
                label,
                state: selected.state === 'archived' ? 'complete'
                  : selected.state === 'blocked' && index === workflowIndex ? 'blocked'
                    : index < workflowIndex ? 'complete'
                      : index === workflowIndex ? 'current'
                        : 'pending',
                detail: selected.state === 'blocked' && index === workflowIndex ? '任务存在阻塞项' : undefined,
              }))}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <TextField label="任务名称" value={title} maxLength={120} disabled={!canEdit || busy} onChange={(event) => setTitle(event.target.value)} />
              <TextField label="观察/估值日" type="date" max={todayString()} value={snapshotAsOf} disabled={!canEdit || busy} onChange={(event) => setSnapshotAsOf(event.target.value)} />
              <TextField label="截止时点（可选）" type="date" value={deadlineAt} disabled={!canEdit || busy} onChange={(event) => setDeadlineAt(event.target.value)} />
              <SelectField
                label="资料归属渠道"
                value={importChannelId}
                disabled={!canEdit || busy}
                onChange={(event) => setImportChannelId(event.target.value)}
                options={[{ value: '', label: '（不归属渠道／仅作资料）' }, ...channels.map((channel) => ({ value: channel.id, label: channel.name }))]}
              />
            </div>
            <TextArea label="任务问题、范围与说明" value={note} rows={3} maxLength={8_000} disabled={!canEdit || busy} onChange={(event) => setNote(event.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={!canEdit || busy} onClick={() => void saveDetails()}>保存说明</Button>
              <label className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm ${!canEdit || busy ? 'pointer-events-none opacity-50' : 'hover:bg-slate-50'}`}>
                导入资料
                <input className="hidden" type="file" multiple disabled={!canEdit || busy} onChange={(event) => void importFiles(event)} />
              </label>
              {selected.state === 'draft' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void moveToReview()}>无资料，直接复核</Button>}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold">证据与候选</h3>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
              <span>资料 {selected.documents.length} 份</span>
              <span>持仓候选 {selected.holdings.length} 条</span>
              <span>金额未知 {selected.observations.filter((item) => item.marketValue === null).length} 条</span>
            </div>
            {selected.documents.length > 0 && <ul className="mt-3 divide-y divide-slate-100 text-sm">{selected.documents.map((document) => (
              <li
                id={`finance-evidence-${document.id.replace(/[^0-9A-Za-z_-]/g, '_')}`}
                key={document.id}
                className={`flex flex-wrap justify-between gap-2 py-2 ${routeEvidenceId === document.id ? 'bg-emerald-50 px-2' : ''}`}
              >
                <span className="break-all">{document.originalName}</span>
                <span className="text-xs text-slate-500">{document.declaredDate ?? '日期未知'} · {document.integrity === 'ok' ? '完整性通过' : document.integrity}</span>
              </li>
            ))}</ul>}
            {!selected.documents.length && <p className="mt-3 text-sm text-slate-500">可以只用本地事实和人工输入完成任务；不会为凑步骤强制上传文件。</p>}
          </Card>

          {(kind === 'market-intelligence' || kind === 'special-research' || kind === 'fund-analysis') && (
            <Card className="p-4">
              <h3 className="font-semibold">来源核验</h3>
              <p className="mt-1 text-xs text-slate-500">只抓取你明确给出的公开 HTTPS 链接；这是来源核验，不冒充通用网页搜索。</p>
              <TextArea label="公开来源链接（每行一个，最多 5 个）" value={researchUrl} rows={3} disabled={busy || selected.state === 'archived'} onChange={(event) => setResearchUrl(event.target.value)} />
              <Button className="mt-2" size="sm" variant="outline" disabled={busy || selected.state === 'archived'} onClick={() => void fetchResearch()}>核验并保存来源</Button>
              {selected.research.length > 0 && <ul className="mt-3 space-y-2 text-sm">{selected.research.map((source) => (
                <li key={source.id} className="rounded-lg border border-slate-200 p-2">
                  <a className="break-all text-blue-700 underline" href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceUrl}</a>
                  <p className="mt-1 text-xs text-slate-500">发布 {source.publishedDate ?? '未知'} · 获取 {source.retrievedAt}</p>
                </li>
              ))}</ul>}
            </Card>
          )}

          <Card className="p-4">
            <h3 className="font-semibold">结果与复核</h3>
            <TextArea label="结论摘要" value={resultSummary} rows={4} maxLength={8_000} disabled={!canEdit && selected.state !== 'ready' && selected.state !== 'confirmed'} onChange={(event) => setResultSummary(event.target.value)} />
            <TextArea label="发现与限制（每行一条）" value={findings} rows={4} maxLength={8_000} disabled={selected.state === 'archived' || selected.state === 'cancelled'} onChange={(event) => setFindings(event.target.value)} />
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noAction} disabled={selected.state === 'archived' || selected.state === 'cancelled'} onChange={(event) => setNoAction(event.target.checked)} />
              本期无需交易或进一步操作
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {RESULT_STAGES.has(selected.state) && selected.state !== 'reviewed' && (
                <Button size="sm" disabled={busy || selected.state === 'confirmed'} onClick={() => void generateResult()}>
                  生成结构化结果
                </Button>
              )}
              {TRADE_TASKS.has(kind) && selected.state === 'ready' && (
                <Button size="sm" disabled={busy} onClick={() => void approveProposal()}>批准方案</Button>
              )}
              {kind === 'initial-reconciliation' && selected.state === 'ready' && (
                <Button size="sm" disabled={busy} onClick={() => void approveProposal()}>确认基线</Button>
              )}
              {TRADE_TASKS.has(kind) && selected.state === 'confirmed' && activeActions.map((action) => (
                <Button key={action.id} size="sm" variant="outline" onClick={() => setReceiptAction(action)}>
                  登记回执：{action.kind} {action.amount === null ? `${action.shares ?? '?'} 份` : `¥${action.amount}`}
                </Button>
              ))}
              {['ready', 'confirmed'].includes(selected.state) && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void completeReview()}>完成复核</Button>
              )}
              {selected.state === 'reviewed' && <Button size="sm" onClick={() => void archive()}>归档任务</Button>}
            </div>
            {selected.proposal && (
              <>
                <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-medium">本地候选 · 策略 v{selected.proposal.policyVersion}</p>
                  <p className="mt-1 text-slate-600">{selected.proposal.summary}</p>
                  {selected.proposal.conflicts.map((conflict) => <p key={conflict} className="mt-1 text-amber-700">{conflict}</p>)}
                </div>
                <div className="mt-4 rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-slate-800">方案比较</h4>
                      <p className="mt-1 text-xs text-slate-500">同一策略、同一数据基线和同一候选集合下比较。比较不会产生交易或批准。</p>
                    </div>
                    <DraftStatusBar
                      status={comparisonDraft.status}
                      error={comparisonDraft.error}
                      staleDraft={comparisonDraft.staleDraft}
                      onSave={() => void comparisonDraft.saveNow()}
                      onDiscard={() => {
                        void comparisonDraft.discard();
                        setComparisonSelection(null);
                      }}
                      onRebase={() => comparisonDraft.applyStaleDraft(comparisonDraft.staleDraft?.payload as typeof comparisonPayload)}
                    />
                  </div>
                  <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full min-w-[660px] text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500"><tr>
                        <th scope="col" className="px-3 py-2 font-medium">口径</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">当前候选</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">维持现状</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">用户调整</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr><th scope="row" className="px-3 py-2 text-left font-normal">动作数量</th><td className="px-3 py-2 text-right tabular">{originalMetrics.actionCount}</td><td className="px-3 py-2 text-right tabular">0</td><td className="px-3 py-2 text-right tabular">{adjustedMetrics.actionCount}</td></tr>
                        <tr><th scope="row" className="px-3 py-2 text-left font-normal">净现金占用</th><td className="px-3 py-2 text-right tabular">{formatCNY(originalMetrics.cashUse)}</td><td className="px-3 py-2 text-right tabular">{formatCNY(0)}</td><td className="px-3 py-2 text-right tabular">{formatCNY(adjustedMetrics.cashUse)}</td></tr>
                        <tr><th scope="row" className="px-3 py-2 text-left font-normal">估算费用</th><td className="px-3 py-2 text-right tabular">{originalFee === null ? '费率未设' : formatCNY(originalFee)}</td><td className="px-3 py-2 text-right tabular">{formatCNY(0)}</td><td className="px-3 py-2 text-right tabular">{adjustedFee === null ? '费率未设' : formatCNY(adjustedFee)}</td></tr>
                        <tr><th scope="row" className="px-3 py-2 text-left font-normal">未知金额 / 阻塞</th><td className="px-3 py-2 text-right tabular">{originalMetrics.unknownAmounts} / {originalMetrics.blockers}</td><td className="px-3 py-2 text-right">不计算适用性</td><td className="px-3 py-2 text-right tabular">{adjustedMetrics.unknownAmounts} / {adjustedMetrics.blockers}</td></tr>
                        <tr><th scope="row" className="px-3 py-2 text-left font-normal">已应用约束</th><td className="px-3 py-2 text-right tabular">{originalMetrics.constraints}</td><td className="px-3 py-2 text-right tabular">0</td><td className="px-3 py-2 text-right tabular">{adjustedMetrics.constraints}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 space-y-2">
                    {selected.proposal.actions.map((action) => (
                      <label key={action.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={comparisonIds.has(action.id)}
                          disabled={selected.state === 'archived' || selected.state === 'confirmed'}
                          onChange={(event) => {
                            const next = new Set(comparisonIds);
                            if (event.target.checked) next.add(action.id);
                            else next.delete(action.id);
                            setComparisonSelection([...next]);
                          }}
                        />
                        <span className="min-w-0">
                          <strong className="block text-slate-700">{action.kind} · {action.amount === null ? `${action.shares ?? '?'} 份` : formatCNY(action.amount)}</strong>
                          <span>{action.rationale}</span>
                          {action.blockers.length > 0 && <span className="mt-1 block text-amber-700">阻塞：{action.blockers.join('；')}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy || adjustedComparisonActions.length === 0 || !['ready', 'blocked'].includes(selected.state)} onClick={() => setApplyComparisonOpen(true)}>
                      将用户调整设为当前候选
                    </Button>
                    <span className="text-xs text-slate-500">“维持现状”只作为零动作基线，不代表已评估未来适配性。</span>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <Modal open={receiptAction !== null} onClose={() => setReceiptAction(null)} title="登记人工执行回执" size="sm">
        <p className="text-sm text-slate-600">请按金融平台的实际状态记录；应用不会下单，也不把建议当成交。</p>
        <SelectField
          label="实际状态"
          value={receiptStatus}
          onChange={(event) => setReceiptStatus(event.target.value as ExecutionRecord['status'])}
          options={[
            { value: 'submitted', label: '已向平台提交' },
            { value: 'partially-executed', label: '部分成交' },
            { value: 'executed', label: '已成交' },
            { value: 'cancelled', label: '已撤销' },
            { value: 'deferred', label: '延期执行' },
            { value: 'rejected', label: '放弃执行' },
            { value: 'not-needed', label: '无需交易' },
          ]}
        />
        <TextField label="实际金额（可选）" type="number" min="0" step="0.01" value={receiptAmount} onChange={(event) => setReceiptAmount(event.target.value === '' ? '' : Number(event.target.value))} />
        <Button className="mt-3" onClick={() => void saveReceipt()}>保存回执</Button>
      </Modal>
      <ConfirmDialog
        open={applyComparisonOpen}
        title="应用用户调整方案"
        message="这会更新任务的当前候选方案，但不会批准、执行或产生交易。原候选仍可从任务修订历史追溯。"
        confirmLabel="更新当前候选"
        onCancel={() => setApplyComparisonOpen(false)}
        onConfirm={() => void applyAdjustedProposal()}
        danger={false}
      />
    </div>
  );
}
