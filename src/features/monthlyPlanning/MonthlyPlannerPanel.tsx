import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { MoneyField, SelectField, TextArea, TextField } from '../../components/ui/form';
import { useAppStore } from '../../store/appStore';
import { useNavigationStore } from '../../store/navigationStore';
import { AIActionButton } from '../ai/AIActionButton';
import { todayString } from '../../utils/date';
import { formatCNY } from '../../utils/money';
import { totalAssets } from '../../utils/channels';
import { moneyDiff, roundMoney, sumMoney, ratioText } from '../../domain/portfolio/decimal';
import { portfolioTotals, ratioWithBase } from '../../domain/portfolio/totals';
import { cashflowSummary, usableCash } from '../../domain/portfolio/cashflow';
import { reconcile } from '../../domain/portfolio/reconcile';
import { evaluatePolicy } from '../../domain/portfolio/policy';
import { generateProposal, type ProposalPosition } from '../../domain/portfolio/proposals';
import { goalScenarios, impliedAnnualRate, requiredMonthlyContribution } from '../../domain/portfolio/goalScenarios';
import {
  advanceSession, clearAutoExtractedFacts, confirmBlockers, createDraftSession, monthlyPlanKey,
} from '../../domain/portfolio/session';
import { buildDraftInput } from './sessionDraft';
import { validateMonthlySession, type SessionIssue } from '../../domain/portfolio/invariants';
import { carryOverPlan, markCarryOverStale, summarizeCarryOver, checkPeriodContinuity, type CarriedItem } from '../../domain/portfolio/carryOver';
import { getAttachment } from '../../services/monthlyPlanning/attachments';
import { importDocuments, rebuildCandidatesFromDocuments, type DocumentImportOutcome, type FileLike } from '../../services/monthlyPlanning/importDocuments';
import { scopeSummary } from './scope';
import { researchLookupAI, visionExtractAI, type ResearchSource } from '../../services/ai/client';
import { useAIConnectionStore } from '../../store/aiConnectionStore';
import { buildVisionRequest, existingResearchUrls, parseUrlLines, researchEvidenceFrom, visionMimeFor } from './aiEntry';
import type {
  CashFlowEvent, InvestmentPolicy, MonthlyReview, ProposedAction, ResearchEvidence, SourceDocument,
} from '../../domain/portfolio/types';

const SECTIONS = [
  { id: 'overview', label: '本期总览' },
  { id: 'import', label: '资料与对账' },
  { id: 'holdings', label: '渠道与持仓' },
  { id: 'funds', label: '资金与风险' },
  { id: 'plan', label: '计划与执行' },
  { id: 'intel', label: '情报与目标' },
  { id: 'archive', label: '月度归档' },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

const EXPOSURE_TAGS = ['equity', 'gold', 'bond', 'cash', 'theme'] as const;

const qualityBadges = (quality: { source: string; attribution: string; valuation: string; review: string }) => [
  quality.source === 'evidence' ? '证据' : quality.source === 'user-confirmed' ? '用户确认' : quality.source === 'computed' ? '计算结果' : '旧 AI',
  quality.attribution === 'confirmed' ? '归属已确认' : quality.attribution === 'conditional' ? '归属推定' : '未归属',
  quality.valuation === 'observed' ? '观察值' : quality.valuation === 'rule-estimated' ? '估算值' : '金额未知',
  quality.review === 'passed' ? '已核对' : quality.review === 'conflict' ? '存在冲突' : '待核对',
];

function currentMonth(): string {
  return todayString().slice(0, 7);
}

function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) return month;
  return mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, '0')}`;
}

/** 策略按版本追加保存，取“该 id 的最高版本”；没有指定 id 时取全局最高版本。 */
function latestPolicy(policies: readonly InvestmentPolicy[], policyId: string | null | undefined): InvestmentPolicy | null {
  const scoped = policyId ? policies.filter((item) => item.id === policyId) : [];
  const pool = scoped.length ? scoped : policies;
  return pool.reduce<InvestmentPolicy | null>((acc, item) => (!acc || item.version > acc.version ? item : acc), null);
}

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
    takeProfit: { referenceShares: '100.0000', steps: [{ cumulativeTarget: 0.2, label: '一阶' }, { cumulativeTarget: 0.5, label: '二阶' }], executedCumulative: 0 },
    planLevelExecution: false,
  };
}

export function MonthlyPlannerPanel() {
  const planning = useAppStore((s) => s.monthlyPlanning);
  const channels = useAppStore((s) => s.channels);
  const goals = useAppStore((s) => s.goals);
  const primaryGoalId = useAppStore((s) => s.primaryGoalId);
  const dataRevision = useAppStore((s) => s.dataRevision);
  const upsertMonthlySession = useAppStore((s) => s.upsertMonthlySession);
  const saveMonthlyPolicy = useAppStore((s) => s.saveMonthlyPolicy);
  const recordMonthlyExecution = useAppStore((s) => s.recordMonthlyExecution);
  const setMonthlySettings = useAppStore((s) => s.setMonthlySettings);
  const deleteMonthlySession = useAppStore((s) => s.deleteMonthlySession);
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigationStore((s) => s.navigate);

  const [month, setMonth] = useState(currentMonth);
  const [snapshotDate, setSnapshotDate] = useState('');
  const [section, setSection] = useState<SectionId>('overview');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importChannelId, setImportChannelId] = useState(channels[0]?.id ?? '');
  const [sourceTotal, setSourceTotal] = useState<number | ''>('');
  const [liabilityTotal, setLiabilityTotal] = useState<number | ''>('');
  const [restrictedTotal, setRestrictedTotal] = useState<number | ''>('');
  const [goalMonths, setGoalMonths] = useState<number | ''>(12);
  const [goalContribution, setGoalContribution] = useState<number | ''>(0);
  const [goalAnnualRate, setGoalAnnualRate] = useState<number | ''>(0.05);
  const [carry, setCarry] = useState<CarriedItem[]>([]);
  const [executionTarget, setExecutionTarget] = useState<ProposedAction | null>(null);
  const [flowForm, setFlowForm] = useState<{ kind: CashFlowEvent['kind']; amount: number | '' }>({ kind: 'external-income', amount: '' });
  const [visionResult, setVisionResult] = useState<{ name: string; text: string; modelId: string } | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [researchUrls, setResearchUrls] = useState('');
  const [researchResults, setResearchResults] = useState<ResearchSource[] | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<DocumentImportOutcome[] | null>(null);

  const aiEnabled = useAIConnectionStore((state) => state.enabled);
  const aiProfiles = useAIConnectionStore((state) => state.profiles);
  const aiActiveProfileId = useAIConnectionStore((state) => state.activeProfileId);
  const activeConnection = aiEnabled
    ? aiProfiles.find((profile) => profile.profileId === aiActiveProfileId) ?? null
    : null;
  const primaryGoal = goals.find((goal) => goal.id === primaryGoalId) ?? goals.find((goal) => goal.status !== 'archived') ?? null;

  const session = planning.sessions.find((item) => item.key === monthlyPlanKeySafe(month)) ?? null;
  const previous = planning.sessions.find((item) => item.key === monthlyPlanKeySafe(previousMonth(month)) && (item.state === 'confirmed' || item.state === 'archived')) ?? null;
  const monthlyTasks = planning.sessions.filter((item) => item.taskKind === undefined || item.taskKind === 'monthly-review');
  const policy = latestPolicy(planning.policies, session?.policyId);
  const sessionKey = session?.key;
  const [policyDraft, setPolicyDraft] = useState<InvestmentPolicy | null>(policy);

  useEffect(() => {
    setPolicyDraft(policy);
  }, [policy, sessionKey]);

  useEffect(() => {
    if (!importChannelId && channels[0]) setImportChannelId(channels[0].id);
  }, [channels, importChannelId]);

  useEffect(() => {
    try {
      const result = carryOverPlan({ previous, nextKey: monthlyPlanKeySafe(month), nextRevision: 1 });
      const revisions = new Map(planning.sessions.map((item) => [item.key, item.revision]));
      setCarry(markCarryOverStale(result.items, revisions));
    } catch {
      setCarry([]);
    }
  }, [previous, month, planning.sessions]);

  const annualIncomeByMonth = useMemo(() => {
    const flows = session?.cashFlows ?? [];
    return cashflowSummary(flows);
  }, [session]);

  const issues: SessionIssue[] = useMemo(() => {
    if (!session) return [];
    return validateMonthlySession(session, {
      parentChannelIds: new Set(channels.map((channel) => channel.id)),
      childIdsByParent: new Map(channels.map((channel) => [channel.id, new Set((channel.children ?? []).map((child) => child.id))])),
    });
  }, [session, channels]);

  const hardErrors = issues.filter((issue) => issue.severity === 'error');
  const confirmationBlockers = confirmBlockers({ session, issues, currentPolicyVersion: policy?.version ?? null });
  const currentMonthValue = todayString().slice(0, 7);
  const dueToday = planning.settings.reminderEnabled
    && todayString().slice(8, 10) >= String(planning.settings.reminderDay).padStart(2, '0')
    && planning.settings.lastReminderMonth !== currentMonthValue;

  /** 保存会话；成功时返回落库后的对象（revision 已递增），失败返回 null。 */
  async function save(next: MonthlyReview, label?: string): Promise<MonthlyReview | null> {
    setBusy(true); setError(null);
    const updated: MonthlyReview = { ...next, revision: next.revision + 1 };
    try {
      await upsertMonthlySession(updated, label);
      return updated;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openOrCreate() {
    if (session) { pushToast('本月会话已存在，直接编辑', 'info'); return; }
    const built = buildDraftInput({
      planningMonth: month, snapshotDate, previous, timezone: planning.settings.timezone, now: new Date().toISOString(),
    });
    if (!built.ok) { setError(built.message); return; }
    if (built.notice) pushToast(built.notice, 'info');
    await save(createDraftSession(built.input), '正在创建月度会话');
  }

  async function handleFiles(picked: readonly FileLike[]) {
    if (!picked.length || !session) return;
    if (session.state === 'planned' || session.state === 'confirmed' || session.state === 'archived') {
      setError('会话已进入计划或已完成，如需重新导入请先删除会话，或先清空自动候选再重来');
      return;
    }
    const startedAt = new Date().toISOString();
    // 先落一次 extracting：导入中断时留下可见的阶段痕迹，而不是只报错不留痕。
    const started = await save(advanceSession(session, 'extracting', { now: startedAt }), '正在提取资料');
    if (!started) return;
    setBusy(true); setError(null);
    try {
      const result = await importDocuments({
        session: started,
        files: picked,
        channelId: importChannelId || null,
        now: new Date().toISOString(),
      });
      setOutcomes(result.outcomes);
      await save(advanceSession(result.session, 'reviewing', { now: new Date().toISOString() }), '正在保存导入资料');
      const imported = result.outcomes.filter((item) => item.status === 'imported').length;
      const duplicate = result.outcomes.filter((item) => item.status === 'duplicate').length;
      const failed = result.outcomes.filter((item) => item.status === 'failed').length;
      pushToast(`导入完成：入库 ${imported}、内容重复 ${duplicate}、失败 ${failed}（详情见下方清单）`, failed ? 'error' : 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  async function savePolicyDraft() {
    if (!policyDraft) return;
    const base = policy ?? defaultPolicy(todayString());
    const next: InvestmentPolicy = {
      ...base,
      ...policyDraft,
      id: base.id,
      version: base.version + 1,
      approvedByUser: true,
      effectiveFrom: todayString(),
    };
    setBusy(true); setError(null);
    try { await saveMonthlyPolicy(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '策略保存失败'); }
    finally { setBusy(false); }
  }

  function buildPositions(current: MonthlyReview): ProposalPosition[] {
    return current.holdings.map((holding) => {
      const observation = current.observations.find((item) => item.holdingId === holding.id);
      return {
        holdingId: holding.id,
        label: holding.originalName,
        ...(holding.planId ? { planId: holding.planId } : {}),
        marketValue: observation?.marketValue ?? null,
        exposureTags: holding.exposureTags,
        takeProfitEligible: holding.exposureTags.includes('equity'),
      };
    });
  }

  async function generate() {
    if (!session) return;
    const now = new Date().toISOString();
    try {
      // 默认策略必须先落库再使用，否则会话记录的策略版本查不到，健康检查会报“策略版本缺失”。
      let active = policy;
      if (!active) {
        active = defaultPolicy(todayString());
        await saveMonthlyPolicy(active);
      }
      const positions = buildPositions(session);
      const investable = investableTotalOf(session, restrictedTotal);
      const unknownCount = session.observations.filter((observation) => observation.marketValue === null).length;
      const proposal = generateProposal(active, {
        investableTotal: investable,
        availableCash: usableCash(liabilityTotal === '' ? null : Number(liabilityTotal), annualIncomeByMonth),
        positions,
        dataRed: unknownCount > 0 && session.observations.length > 0,
        ...(unknownCount ? { dataRedReasons: [`存在 ${unknownCount} 条金额未知的持仓，请先补齐或标记为未知`] } : {}),
      }, { sessionKey: session.key, now });
      const ready = advanceSession(
        { ...session, proposal, policyId: active.id, policyVersion: active.version },
        'ready',
        { now },
      );
      await save(ready, '正在保存候选方案');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成候选失败');
    }
  }

  async function confirmPlan() {
    if (!session) return;
    const blockers = confirmBlockers({ session, issues, currentPolicyVersion: policy?.version ?? null });
    if (blockers.length) { setError(blockers.join('；')); return; }
    try {
      const now = new Date().toISOString();
      const confirmed = advanceSession(session, 'confirmed', { now, baseDataRevision: dataRevision, issues });
      await save(confirmed, '正在确认月度计划');
      pushToast('月度计划已确认（未成交，需要你手工执行）', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '确认失败');
    }
  }

  /** 清空自动提取的持仓与观察，保留资料、附件与手工内容。 */
  async function clearAutoCandidates() {
    if (!session) return;
    try {
      const result = clearAutoExtractedFacts(session, new Date().toISOString());
      const saved = await save(result.session, '正在清空自动提取的候选');
      if (!saved) return;
      pushToast(`已清空 ${result.removedHoldings} 条自动提取的持仓、${result.removedObservations} 条观察；资料与附件保留`, 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清空失败');
    }
  }

  /** 用已入库的 DOCX 重新解析并补齐候选（importDocuments 的幂等补充路径）。 */
  async function rebuildCandidates() {
    if (!session) return;
    if (!importChannelId) { setError('请先选择归属父渠道，再生成候选'); return; }
    setBusy(true); setError(null);
    try {
      const result = await rebuildCandidatesFromDocuments({
        session, channelId: importChannelId, now: new Date().toISOString(),
      });
      if (!result.scanned && !result.created) {
        pushToast('没有需要重新解析的 DOCX：候选已存在，或资料里没有 DOCX', 'info');
        return;
      }
      await save(result.session, '正在补生成候选');
      pushToast(`已解析 ${result.scanned} 份 DOCX，补齐 ${result.created} 条候选${result.skipped.length ? `；跳过：${result.skipped.join('；')}` : ''}`, result.created ? 'success' : 'info');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成候选失败');
    } finally {
      setBusy(false);
    }
  }

  /** 视觉提取：只把图片交给被声明为可读图的连接，结果只读展示，绝不写回事实。 */
  async function runVision(document: SourceDocument) {
    if (!activeConnection) { pushToast('请先在 AI 连接中心启用 AI 并选中一个连接', 'error'); return; }
    setVisionBusy(true);
    try {
      const bytes = await getAttachment({ key: document.relativePath, sha256: document.sha256 });
      const request = buildVisionRequest({
        document, bytes, profileId: activeConnection.profileId, providerId: activeConnection.providerId,
        requestId: crypto.randomUUID(),
      });
      const result = await visionExtractAI(request);
      setVisionResult({ name: document.originalName, text: result.text, modelId: result.modelId });
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '视觉识别失败', 'error');
    } finally {
      setVisionBusy(false);
    }
  }

  /** 网页检索：只抓用户给出的公网 HTTPS 链接，结果需显式保存才成为研究记录。 */
  async function runResearch() {
    if (!session) return;
    if (!activeConnection) { pushToast('请先在 AI 连接中心启用 AI 并选中一个连接', 'error'); return; }
    const parsed = parseUrlLines(researchUrls);
    if (!parsed.urls.length) { setError('请至少填写一个公网 HTTPS 链接'); return; }
    if (parsed.dropped) pushToast(`最多检索 ${parseUrlLines(researchUrls, Number.MAX_SAFE_INTEGER).urls.length} 个链接，已忽略多余的 ${parsed.dropped} 个`, 'info');
    setResearchBusy(true);
    try {
      const result = await researchLookupAI({
        requestId: crypto.randomUUID(), profileId: activeConnection.profileId,
        providerId: activeConnection.providerId, urls: parsed.urls,
      });
      setResearchResults(result.results);
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '检索失败', 'error');
    } finally {
      setResearchBusy(false);
    }
  }

  /** 把检索到的来源存成研究记录：只有你点了这个按钮才会写入会话。 */
  async function saveResearch() {
    if (!session || !researchResults) return;
    const now = new Date().toISOString();
    const known = existingResearchUrls(session.research);
    const added: ResearchEvidence[] = [];
    let skipped = 0;
    for (const [index, source] of researchResults.entries()) {
      if (known.has(source.url)) { skipped += 1; continue; }
      const evidence = researchEvidenceFrom(source, now, index);
      if (!evidence) { skipped += 1; continue; }
      added.push(evidence);
    }
    if (!added.length) { pushToast('没有可保存的来源：已存在或没有可用内容', 'error'); return; }
    await save({ ...session, research: [...session.research, ...added] }, '正在保存研究记录');
    pushToast(`已保存 ${added.length} 条研究记录${skipped ? `，跳过 ${skipped} 条（已存在或无可用内容）` : ''}`, 'success');
    setResearchResults(null);
    setResearchUrls('');
  }

  function totalsOf(current: MonthlyReview) {
    const values = current.observations.map((observation) => observation.marketValue);
    const assets = values.some((value) => value === null) ? null : sumMoney(values as number[]);
    const liabilities = liabilityTotal === '' ? null : Number(liabilityTotal);
    const restricted = restrictedTotal === '' ? null : Number(restrictedTotal);
    return portfolioTotals({ allAssets: assets, liabilities, liabilitiesUnknown: liabilities === null, restricted });
  }

  const reconciliation = useMemo(() => {
    if (!session) return null;
    return reconcile({
      sourceTotal: sourceTotal === '' ? null : Number(sourceTotal),
      rows: session.observations.map((observation) => ({
        id: observation.id,
        label: observation.holdingId,
        amount: observation.marketValue,
        kind: observation.marketValue === null ? 'unassigned' as const : 'matched' as const,
      })),
      scopeNote: session.documents.map((document) => document.scopeNote ?? '').join(' '),
    });
  }, [session, sourceTotal]);

  const exposures = useMemo(() => {
    const map: Record<string, number> = {};
    for (const holding of session?.holdings ?? []) {
      const value = session?.observations.find((observation) => observation.holdingId === holding.id)?.marketValue ?? null;
      if (value === null) continue;
      for (const tag of holding.exposureTags) map[tag] = roundMoney((map[tag] ?? 0) + value);
    }
    return map;
  }, [session]);

  const investable = session ? investableTotalOf(session, restrictedTotal) : null;
  const scope = session ? scopeSummary(session, channelsTotal(channels), todayString()) : null;
  const breaches = policy ? evaluatePolicy(policy, { exposures, exposureBase: investable }).breaches : [];
  const carrySummary = summarizeCarryOver(carry);
  const continuity = checkPeriodContinuity({ previous, nextReviewPeriodStart: session?.reviewPeriodStart ?? null });
  const editablePolicy = policyDraft ?? policy ?? defaultPolicy(todayString());

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <TextField label="规划月份" type="month" value={month} onChange={(event) => setMonth(event.target.value || currentMonth())} />
          <TextField label="快照日（留空＝今天）" type="date" max={todayString()} value={snapshotDate}
            disabled={Boolean(session) || busy}
            hint={session ? '本月会话已存在；要改日期请先在「月度归档」删除该会话' : '补录历史月份时填写资料的真实日期，例如 2026-07-20'}
            onChange={(event) => setSnapshotDate(event.target.value)} />
          <div className="text-sm text-slate-600">
            会话：{session ? <Badge tone={session.state === 'confirmed' || session.state === 'archived' ? 'emerald' : 'blue'}>{session.state}</Badge> : '未创建'}
            {session && <span className="ml-2 text-xs text-slate-500">revision {session.revision} · 快照 {session.snapshotAsOf}</span>}
          </div>
          <Button disabled={busy} onClick={() => void openOrCreate()}>{session ? '本月会话已存在' : '创建本月会话'}</Button>
          <Button variant="outline" disabled={!session || busy || confirmationBlockers.length > 0} onClick={() => void confirmPlan()}>确认月度计划</Button>
          <div className="ml-auto text-xs text-slate-500">
            提醒：每月 {planning.settings.reminderDay} 日 {planning.settings.reminderTime}（{planning.settings.timezone}）
            <label className="ml-2 inline-flex items-center gap-1">
              <input type="checkbox" checked={planning.settings.reminderEnabled} onChange={(event) => void setMonthlySettings({ reminderEnabled: event.target.checked })} />
              应用内提醒
            </label>
          </div>
        </div>
        {dueToday && session?.state !== 'confirmed' && session?.state !== 'archived' && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <span>已到本月提醒日：现在开始月度流程。提醒不等于工资到账、负债清零或基金净值已结算，请在「快照确认」逐项核对。</span>
            <Button size="sm" variant="outline" onClick={() => void setMonthlySettings({ lastReminderMonth: currentMonthValue })}>
              记住本月已提示
            </Button>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        {!error && session && confirmationBlockers.length > 0 && (
          <p className="mt-3 text-sm text-slate-600">还不能确认月度计划：{confirmationBlockers.join('；')}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
              className={`px-3 py-1.5 text-xs rounded-lg ${section === item.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </Card>

      {section === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="font-semibold mb-2">月初承接（可追溯）</h3>
            {!previous && <p className="text-sm text-slate-500">首期初始化：不承接上月内容，也不伪造上期收益。</p>}
            {previous && (
              <>
                <p className="text-xs text-slate-500 mb-2">来源会话 {previous.key} · revision {previous.revision} · 快照 {previous.snapshotAsOf}；承接 {carrySummary.open} 项，其中 {carrySummary.stale} 项来源已修订。</p>
                {!continuity.ok && <p className="text-sm text-amber-700 mb-2">{continuity.message}</p>}
                <ul className="space-y-2 text-sm max-h-72 overflow-y-auto">
                  {carry.map((item) => (
                    <li key={item.id} className="rounded-lg border border-slate-200 p-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={item.stale ? 'amber' : 'slate'}>{item.kind}</Badge>
                        <span className="font-medium">{item.label}</span>
                        {item.stale && <span className="text-xs text-amber-700">来源已修订，请重新确认</span>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
                      <p className="mt-1 text-[11px] text-slate-400">来源：{item.origin.sessionKey}@{item.origin.revision} · {item.origin.itemId} · 快照 {item.origin.snapshotAsOf}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold mb-2">数据状态</h3>
            {hardErrors.length === 0 && <p className="text-sm text-emerald-700">未发现错误级问题，可以继续确认流程。</p>}
            <ul className="mt-2 space-y-1 text-sm">
              {issues.slice(0, 8).map((issue) => (
                <li key={`${issue.code}:${issue.entityId ?? ''}`} className={issue.severity === 'error' ? 'text-red-600' : issue.severity === 'warning' ? 'text-amber-700' : 'text-slate-500'}>
                  [{issue.severity}] {issue.message}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {section === 'import' && (
        <Card className="p-4 space-y-3">
          <h3 className="font-semibold">资料与对账</h3>
          <div className="flex flex-wrap items-end gap-3">
            <SelectField label="默认归属父渠道（可留空）" value={importChannelId}
              onChange={(event) => setImportChannelId(event.target.value)}
              options={[
                { value: '', label: '（不归属任何渠道／仅作为资料）' },
                ...channels.map((channel) => ({ value: channel.id, label: channel.name })),
              ]} />
            <label className="text-sm">
                选择文件（DOCX / 图片 / CSV / Markdown / TXT）
                <input type="file" multiple className="block mt-1 text-xs" disabled={!session || busy}
                  onChange={(event) => {
                    // FileList 会在把 value 置空时被清空，所以先同步快照成数组，再清空输入框。
                    const picked = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    void handleFiles(picked);
                  }} />
            </label>
            <MoneyField label="来源声明总额（可选）" value={sourceTotal} onChange={setSourceTotal} />
          </div>
          <p className="text-xs text-slate-500">
            各类资料的作用：<strong>渠道 DOCX</strong> 会解析出持仓候选（需要选归属父渠道）；<strong>截图/长图</strong>
            只作为证据留存，要用「视觉识别」需要先配置可读图的模型；<strong>md / txt / CSV</strong> 只作为范围声明与说明，
            不产生任何持仓。留空父渠道时资料照样入库，只是不生成候选，之后可以用「从已入库资料生成候选」补上。
            导入到本地不等于同意外发。
          </p>
          {outcomes && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs">
              <div className="mb-1 font-medium text-slate-700">上次导入结果（每份文件都会列出）</div>
              <ul className="space-y-0.5">
                {outcomes.map((outcome, index) => (
                  <li key={`${outcome.name}:${index}`} className={outcome.status === 'failed' ? 'text-red-600' : 'text-slate-600'}>
                    [{outcome.status === 'imported' ? '已入库' : outcome.status === 'duplicate' ? '内容重复' : '失败'}]
                    {' '}{outcome.name}
                    {outcome.candidates !== undefined ? ` · 候选 ${outcome.candidates} 条${outcome.createdFacts ? '（已生成本地候选）' : ''}` : ''}
                    {outcome.note ? ` · ${outcome.note}` : ''}
                    {outcome.error ? ` · ${outcome.error}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {session?.documents.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th>文件</th><th>平台</th><th>导出日 / 值日</th><th>完整性</th><th>解析</th><th>范围声明</th><th>AI</th></tr></thead>
              <tbody>
                {session.documents.map((document) => (
                  <tr key={document.id} className="border-t border-slate-100">
                    <td className="py-1.5 break-all">{document.originalName}<div className="text-[11px] text-slate-400">{document.relativePath}</div></td>
                    <td>{document.platform}</td>
                      <td className="text-xs tabular">
                        {document.declaredDate ?? '未注明'}
                        <div className="text-[11px] text-slate-400">
                          值日 {(() => {
                            const dates = session.observations
                              .filter((observation) => observation.evidence.some((ref) => ref.sourceId === document.id))
                              .map((observation) => observation.navDate)
                              .filter((value): value is string => Boolean(value))
                              .sort();
                            return dates.length ? `${dates[0]}${dates.length > 1 ? ` ~ ${dates[dates.length - 1]}` : ''}` : '未注明';
                          })()}
                        </div>
                      </td>
                    <td>{document.integrity === 'ok' ? '正常' : '异常'}</td>
                    <td>{document.parseState}</td>
                    <td className="text-xs">{document.scopeNote ?? '—'}</td>
                    <td>
                      {visionMimeFor(document) ? (
                        <Button size="sm" variant="outline" disabled={busy || visionBusy}
                          onClick={() => void runVision(document)}>视觉识别</Button>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon="📄" title="还没有资料" description="选择微信/支付宝/京东导出的 DOCX 或截图，或使用手工补充。" />}
          {reconciliation && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p>对账状态：<strong>{reconciliation.status}</strong>（匹配 {formatCNY(reconciliation.matchedAmount)} · 未归属 {formatCNY(reconciliation.unassignedAmount)} · 未知 {reconciliation.unknownCount} 条 · 差额 {reconciliation.difference === null ? '不可判定' : formatCNY(reconciliation.difference)} · 容差 {reconciliation.tolerance} 元）</p>
              {reconciliation.notes.map((note) => <p key={note} className="text-xs text-slate-500 mt-1">{note}</p>)}
            </div>
          )}
        </Card>
      )}

      {section === 'holdings' && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">渠道与持仓</h3>
          {session && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline"
                disabled={busy || ['planned', 'confirmed', 'archived'].includes(session.state)}
                onClick={() => void clearAutoCandidates()}>清空自动提取的候选</Button>
              <Button size="sm" variant="outline" disabled={busy || !importChannelId}
                onClick={() => void rebuildCandidates()}>从已入库资料生成候选</Button>
              <span className="text-xs text-slate-500">
                {['planned', 'confirmed', 'archived'].includes(session.state)
                  ? '已进入计划或已完成，如需重来请先删除会话。'
                  : importChannelId
                    ? '「清空」删除自动提取的持仓与观察（保留资料与附件）；「生成候选」用已入库的 DOCX 重新解析并补齐缺失的候选。'
                    : '「清空」删除自动提取的持仓与观察；要生成候选请先在上面选择归属父渠道。'}
              </span>
            </div>
          )}
          {!session?.holdings.length ? <EmptyState icon="📊" title="还没有持仓" description="先导入资料，或在下方手工补充。" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th>代码/名称</th><th>市值</th><th>份额</th><th>值日</th><th>状态</th><th>暴露标签</th></tr></thead>
                <tbody>
                  {session.holdings.map((holding) => {
                    const observation = session.observations.find((item) => item.holdingId === holding.id);
                    return (
                      <tr key={holding.id} className="border-t border-slate-100">
                        <td className="py-1.5">{holding.fundCode ?? '—'} · {holding.originalName}</td>
                        <td className="tabular">{observation?.marketValue === null || observation?.marketValue === undefined ? '未知' : formatCNY(observation.marketValue)}</td>
                        <td className="tabular">{observation?.shares ?? '未知'}</td>
                          <td className="text-xs tabular">
                            {observation
                              ? observation.navDate ?? <span className="text-slate-400">{session.snapshotAsOf}（快照）</span>
                              : '—'}
                          </td>
                        <td className="text-xs">
                          {observation ? qualityBadges(observation.quality).map((label) => <Badge key={label} tone="slate" className="mr-1">{label}</Badge>) : '无观察'}
                        </td>
                        <td>
                          {EXPOSURE_TAGS.map((tag) => (
                            <label key={tag} className="mr-2 text-xs">
                              <input type="checkbox" checked={holding.exposureTags.includes(tag)} disabled={busy}
                                onChange={(event) => {
                                  const tags = event.target.checked ? [...holding.exposureTags, tag] : holding.exposureTags.filter((item) => item !== tag);
                                  void save({ ...session, holdings: session.holdings.map((item) => item.id === holding.id ? { ...item, exposureTags: tags } : item) });
                                }} /> {tag}
                            </label>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {section === 'funds' && session && (
        <div className="space-y-4">
          {scope && (
            <Card className="p-4">
              <h3 className="font-semibold mb-2">口径对照：本期证据 ≠ 当前渠道资产</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">本期证据口径（来自文档观察值）</div>
                  <div className="text-lg font-semibold tabular">{formatCNY(scope.evidence.total)}</div>
                  <div className="text-[11px] text-slate-500">
                    {scope.evidence.count} 条观察{scope.evidence.unknownCount ? `，其中 ${scope.evidence.unknownCount} 条金额未知` : ''}
                    {scope.evidence.from
                      ? ` · 值日 ${scope.evidence.from}${scope.evidence.to && scope.evidence.to !== scope.evidence.from ? ` ~ ${scope.evidence.to}` : ''}`
                      : ' · 尚无观察值'}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">主应用渠道资产（资产页维护）</div>
                  <div className="text-lg font-semibold tabular">{formatCNY(scope.channels.total)}</div>
                  <div className="text-[11px] text-slate-500">截至 {scope.channels.asOf} · 仅作参照，不参与本会话计算</div>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                差额：
                <span className="tabular">{scope.difference === null ? '不可判定（尚无观察值）' : formatCNY(scope.difference)}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                平台导出的资产证明是某日冻结的快照，申购确认、净值更新与在途资金都有延迟；导出日与表内净值日也可能不同。
                两者不相等是正常的，**不要把渠道资产回写进本期观察值**，也不要把文档金额当成当前渠道余额。
              </p>
            </Card>
          )}
          <Card className="p-4">
            <h3 className="font-semibold mb-2">四种口径（公式与范围）</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {totalsOf(session).entries.map((entry) => (
                <div key={entry.key} className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">{entry.label}</div>
                  <div className="text-sm font-semibold tabular">{entry.amount === null ? '不可确定' : formatCNY(entry.amount)}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{entry.formula}</div>
                  {entry.unknowns.length > 0 && <div className="text-[11px] text-amber-700 mt-1">缺少：{entry.unknowns.join('、')}</div>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <MoneyField label="已确认负债合计（留空＝未知）" value={liabilityTotal} onChange={setLiabilityTotal} />
              <MoneyField label="受限/用途专属资金" value={restrictedTotal} onChange={setRestrictedTotal} />
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold mb-2">资金流</h3>
            <div className="flex flex-wrap items-end gap-3">
              <SelectField label="事件类型" value={flowForm.kind}
                onChange={(event) => setFlowForm({ ...flowForm, kind: event.target.value as CashFlowEvent['kind'] })}
                options={[
                  { value: 'external-income', label: '外部收入' }, { value: 'external-out', label: '外部支出' },
                  { value: 'internal-transfer', label: '内部转账' }, { value: 'investment-buy', label: '投资买入' },
                  { value: 'investment-sell', label: '投资卖出' }, { value: 'credit-spend', label: '信用消费' },
                  { value: 'debt-repayment', label: '还款' }, { value: 'refund', label: '退款' },
                  { value: 'interest', label: '利息' }, { value: 'fee', label: '费用' },
                  { value: 'pending-buy', label: '在途申购' }, { value: 'pending-sell', label: '在途赎回' },
                  { value: 'lottery-out', label: '转出到彩票（外部）' },
                ]} />
              <MoneyField label="金额" value={flowForm.amount} onChange={(value) => setFlowForm({ ...flowForm, amount: value })} />
              <Button variant="outline" disabled={busy || flowForm.amount === ''}
                onClick={() => {
                  const event: CashFlowEvent = {
                    id: `flow:${Date.now()}`, kind: flowForm.kind, date: todayString(), amount: Number(flowForm.amount),
                    scope: 'all', evidence: [],
                    quality: { source: 'user-confirmed', attribution: 'confirmed', valuation: 'observed', time: 'observed', review: 'pending' },
                    ...(flowForm.kind === 'pending-buy' || flowForm.kind === 'pending-sell' ? { alreadyIncludedInBalance: false } : {}),
                  };
                  void save({ ...session, cashFlows: [...session.cashFlows, event] });
                  setFlowForm({ kind: flowForm.kind, amount: '' });
                }}>记录事件</Button>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              外部收入 {formatCNY(annualIncomeByMonth.externalIncome)} · 支出 {formatCNY(annualIncomeByMonth.expenses)} · 净外部 {formatCNY(annualIncomeByMonth.netExternal)} ·
              内部转账 {formatCNY(annualIncomeByMonth.internalTransfers)} · 在途未入账 {formatCNY(annualIncomeByMonth.pendingNotIncludedBuy + annualIncomeByMonth.pendingNotIncludedSell)}
            </p>
            <p className="text-xs text-slate-500 mt-1">内部转账与买卖不计入收支；信用消费同时确认支出与负债；还款不重复计支出。</p>
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold mb-2">风险与偏离（分母：可投资资产 {investable === null ? '未知' : formatCNY(investable)}）</h3>
            {Object.keys(exposures).length === 0 ? <p className="text-sm text-slate-500">尚未给持仓设置暴露标签。</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th>标签</th><th>金额</th><th>占比</th><th>上限</th></tr></thead>
                <tbody>
                  {Object.entries(exposures).map(([tag, value]) => {
                    const limit = policy?.riskLimits.find((item) => item.key === tag);
                    const share = ratioWithBase(value, investable, '可投资资产');
                    return (
                      <tr key={tag} className="border-t border-slate-100">
                        <td className="py-1.5">{tag}</td>
                        <td className="tabular">{formatCNY(value)}</td>
                        <td className="tabular">{share.text}{share.note ? `（${share.note}）` : ''}</td>
                        <td className="text-xs">软 {limit?.softLimit === null || limit?.softLimit === undefined ? '—' : ratioText(limit.softLimit)} / 硬 {limit?.hardLimit === null || limit?.hardLimit === undefined ? '—' : ratioText(limit.hardLimit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {breaches.length > 0 && (
              <ul className="mt-2 text-sm">
                {breaches.map((breach) => (
                  <li key={breach.key} className={breach.level === 'hard' ? 'text-red-600' : 'text-amber-700'}>
                    {breach.key}：{breach.level === 'hard' ? '超过硬上限' : '超过软上限'}（{formatCNY(breach.exposure)} / 上限 {formatCNY(breach.limit)}）
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {section === 'plan' && session && (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-2">策略（用户政策，可版本化修改）</h3>
            <div className="flex flex-wrap items-end gap-3">
              <MoneyField label="最小交易额" value={editablePolicy.minTradeAmount ?? ''} onChange={(value) => setPolicyDraft({ ...editablePolicy, minTradeAmount: value === '' ? null : Number(value) })} />
              <MoneyField label="流动性底线" value={editablePolicy.liquidityFloor ?? ''} onChange={(value) => setPolicyDraft({ ...editablePolicy, liquidityFloor: value === '' ? null : Number(value) })} />
              <TextField label="冷静期（天）" type="number" value={String(editablePolicy.cooldownDays ?? 0)}
                onChange={(event) => setPolicyDraft({ ...editablePolicy, cooldownDays: Number(event.target.value) || 0 })} />
              <TextField label="费率（0–1）" type="number" min="0" max="1" step="0.001" value={String(editablePolicy.feeRate ?? '')}
                onChange={(event) => setPolicyDraft({ ...editablePolicy, feeRate: event.target.value === '' ? null : Number(event.target.value) })} />
              <TextField label="参考份额" value={editablePolicy.takeProfit?.referenceShares ?? ''}
                onChange={(event) => setPolicyDraft({
                  ...editablePolicy,
                  takeProfit: {
                    referenceShares: event.target.value.trim() || null,
                    steps: editablePolicy.takeProfit?.steps ?? [],
                    executedCumulative: editablePolicy.takeProfit?.executedCumulative ?? 0,
                  },
                })} />
              <TextField label="止盈台阶（累计比例，逗号分隔）" value={(editablePolicy.takeProfit?.steps ?? []).map((step) => step.cumulativeTarget).join(',')}
                onChange={(event) => {
                  const steps = event.target.value.split(',').map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value > 0 && value <= 1)
                    .map((value, index) => ({ cumulativeTarget: value, label: `第${index + 1}阶` }));
                  setPolicyDraft({ ...editablePolicy, takeProfit: { referenceShares: editablePolicy.takeProfit?.referenceShares ?? null, steps, executedCumulative: editablePolicy.takeProfit?.executedCumulative ?? 0 } });
                }} />
              <TextField label="已执行累计比例" type="number" step="0.01" value={String(editablePolicy.takeProfit?.executedCumulative ?? 0)}
                onChange={(event) => setPolicyDraft({ ...editablePolicy, takeProfit: { referenceShares: editablePolicy.takeProfit?.referenceShares ?? null, steps: editablePolicy.takeProfit?.steps ?? [], executedCumulative: Number(event.target.value) || 0 } })} />
              <TextField label="目标配比（标签:比例，逗号分隔）" value={Object.entries(editablePolicy.targetAllocation).map(([key, value]) => `${key}:${value}`).join(',')}
                onChange={(event) => {
                  const allocation: Record<string, number> = {};
                  for (const part of event.target.value.split(',')) {
                    const [key, value] = part.split(':').map((item) => item.trim());
                    const parsed = Number(value);
                    if (key && Number.isFinite(parsed) && parsed > 0 && parsed <= 1) allocation[key] = parsed;
                  }
                  setPolicyDraft({ ...editablePolicy, targetAllocation: allocation });
                }} />
              <TextField label="风险上限（标签:软:硬，逗号分隔）" value={editablePolicy.riskLimits.map((limit) => `${limit.key}:${limit.softLimit ?? ''}:${limit.hardLimit ?? ''}`).join(',')}
                onChange={(event) => {
                  const riskLimits = event.target.value.split(',').flatMap((part) => {
                    const [key, soft, hard] = part.split(':').map((item) => item.trim());
                    if (!key) return [];
                    const softLimit = soft === '' ? null : Number(soft);
                    const hardLimit = hard === '' ? null : Number(hard);
                    return [{
                      key,
                      softLimit: Number.isFinite(softLimit) ? softLimit : null,
                      hardLimit: Number.isFinite(hardLimit) ? hardLimit : null,
                      buffer: null,
                      consecutiveBreachesAllowed: null,
                    }];
                  });
                  setPolicyDraft({ ...editablePolicy, riskLimits });
                }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">策略是用户自己的政策（旧 v9 规则的版本化承接），不是通用投资建议；编辑不会自动写入，点击保存后才生成新版本。</p>
            <Button className="mt-3" size="sm" variant="outline" disabled={busy} onClick={() => void savePolicyDraft()}>保存新策略版本</Button>
          </Card>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void generate()}>生成候选（本地确定性计算）</Button>
              <span className="text-xs text-slate-500">只生成候选，不自动成交；数据为红时不产生可执行金额。</span>
            </div>
            {session.proposal && (
              <div className="mt-3 space-y-3">
                <p className="text-sm">
                  数据状态 <Badge tone={session.proposal.dataStatus === 'green' ? 'emerald' : 'red'}>{session.proposal.dataStatus}</Badge>
                  风险状态 <Badge tone={session.proposal.riskStatus === 'green' ? 'emerald' : session.proposal.riskStatus === 'red' ? 'red' : 'amber'}>{session.proposal.riskStatus}</Badge>
                  <span className="ml-2 text-slate-600">{session.proposal.summary}</span>
                </p>
                {session.proposal.conflicts.map((conflict) => <p key={conflict} className="text-sm text-amber-700">约束：{conflict}</p>)}
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th>候选</th><th>金额/份额</th><th>触发</th><th>执行回执</th></tr></thead>
                  <tbody>
                    {session.proposal.actions.map((action) => {
                      const record = session.executions.find((item) => item.actionId === action.id);
                      return (
                        <tr key={action.id} className="border-t border-slate-100">
                          <td className="py-1.5">{action.rationale}</td>
                          <td className="tabular">{action.amount === null ? `份额 ${action.shares ?? '未知'}` : formatCNY(action.amount)}</td>
                          <td className="text-xs">{action.triggers.join('、')}</td>
                          <td>{record ? <Badge tone={record.status === 'executed' ? 'emerald' : record.status === 'rejected' ? 'slate' : 'blue'}>{record.status}</Badge> : <Button size="sm" variant="outline" onClick={() => setExecutionTarget(action)}>登记</Button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {session.proposal.actions.length === 0 && <p className="text-sm text-slate-500">没有需要执行的动作。</p>}
              </div>
            )}
          </Card>
        </div>
      )}

      {section === 'intel' && session && (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-2">市场情报（需有来源与日期）</h3>
            <div className="mb-3 space-y-2">
              <TextArea label="公网 HTTPS 来源（每行一个，最多 5 个）" value={researchUrls}
                onChange={(event) => setResearchUrls(event.target.value)}
                placeholder={'https://example.com/article'} rows={2} />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled={busy || researchBusy} onClick={() => void runResearch()}>联网检索（需授权）</Button>
                {researchResults && (
                  <Button disabled={busy} onClick={() => void saveResearch()}>保存为研究记录</Button>
                )}
                <span className="text-xs text-slate-500">只抓取你给出的链接；桌面端可用，Web/移动端会如实提示不可用。结果只有点「保存为研究记录」才会写入会话。</span>
              </div>
              {researchResults && (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-500"><th>来源</th><th>标题</th><th>大小</th><th>结果</th></tr></thead>
                  <tbody>
                    {researchResults.map((source) => (
                      <tr key={source.url} className="border-t border-slate-100">
                        <td className="py-1 break-all">{source.url}</td>
                        <td className="break-all">{source.title ?? '—'}</td>
                        <td className="tabular">{source.bytes === undefined ? '—' : `${Math.round(source.bytes / 1024)} KB${source.truncated ? '（截断）' : ''}`}</td>
                        <td>{source.ok ? '已获取' : source.error ?? '失败'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {session.research.length === 0 ? <p className="text-sm text-slate-500">尚无研究记录；联网检索仅桌面可用，且必须记录来源、发布日期与检索日期。</p> : (
              <ul className="space-y-2 text-sm">
                {session.research.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-2">
                    <div className="font-medium">{item.publisher}</div>
                    <div className="text-xs text-slate-500 break-all">{item.sourceUrl} · 检索 {item.retrievedAt}{item.publishedDate ? ` · 发布 ${item.publishedDate}` : ''}</div>
                    <p className="mt-1">{item.excerpt}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <AIActionButton task="monthly-narrative" range={{ start: session.reviewPeriodStart, end: session.reviewPeriodEnd }}>AI 月度叙述（需授权）</AIActionButton>
              <Button variant="outline" onClick={() => navigate({ tab: 'ai', settingsSection: 'ai' })}>配置模型连接</Button>
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold mb-2">目标情景（复用现有目标口径）</h3>
            <div className="flex flex-wrap items-end gap-3">
              <TextField label="期限（月）" type="number" value={String(goalMonths)} onChange={(event) => setGoalMonths(Number(event.target.value) || 0)} />
              <MoneyField label="每月投入假设" value={goalContribution} onChange={setGoalContribution} />
              <TextField label="年化假设（0–1）" type="number" min="0" max="1" step="0.01" value={String(goalAnnualRate)} onChange={(event) => setGoalAnnualRate(event.target.value === '' ? '' : Number(event.target.value))} />
            </div>
            {!primaryGoal ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                <span>当前没有可复用的正式目标；不会用示例目标替代。</span>
                <Button size="sm" variant="outline" onClick={() => navigate({ tab: 'goals' })}>新建目标</Button>
              </div>
            ) : (() => {
              const basis = channelsTotal(channels);
              const months = Number(goalMonths) || 0;
              const contribution = Number(goalContribution) || 0;
              const annualRate = goalAnnualRate === '' ? null : Number(goalAnnualRate);
              const scenarios = goalScenarios(
                { goalId: primaryGoal.id, targetAmount: primaryGoal.targetAmount, basis: 'all-assets', baselineDate: todayString(), monthlyContribution: contribution, targetDate: primaryGoal.targetDateTime, scenarios: [{ id: 'user-assumption', label: '当前用户假设', annualRate }], quality: { source: 'computed', attribution: 'confirmed', valuation: 'observed', time: 'observed', review: 'pending' } },
                { months, baseAmount: basis },
              );
              const required = requiredMonthlyContribution({ target: primaryGoal.targetAmount, baseAmount: basis, months, annualRate });
              const implied = impliedAnnualRate({ target: primaryGoal.targetAmount, baseAmount: basis, monthlyContribution: contribution, months });
              return (
                <div className="mt-3 space-y-1 text-sm">
                  <p>目标：{primaryGoal.name} · {formatCNY(primaryGoal.targetAmount)}</p>
                  <p>当前基线（全部资产）：{formatCNY(basis)}</p>
                  <p>按当前假设所需月投入：{required === null ? '期限无效或不可计算' : formatCNY(required)}；当前假设月投入 {formatCNY(contribution)}</p>
                  <p>达到目标所需隐含年化：{implied === null ? '在可行范围内无解（不要包装成可实现计划）' : ratioText(implied, 2)}</p>
                  <ul className="text-xs text-slate-500">
                    {scenarios.map((scenario) => (
                      <li key={scenario.id}>{scenario.label}：{scenario.finalAmount === null ? '不可外推' : formatCNY(scenario.finalAmount)}{scenario.note ? `（${scenario.note}）` : ''}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </Card>
        </div>
      )}

      {section === 'archive' && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">月度归档</h3>
          {monthlyTasks.length === 0 ? <EmptyState icon="🗂️" title="还没有月度会话" description="创建本月会话后会出现在这里。" /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th>会话</th><th>状态</th><th>快照</th><th>候选/回执</th><th>操作</th></tr></thead>
              <tbody>
                {monthlyTasks.map((item) => (
                  <tr key={item.key} className="border-t border-slate-100">
                    <td className="py-1.5">{item.key}<div className="text-[11px] text-slate-400">revision {item.revision}</div></td>
                    <td>{item.state}</td>
                    <td>{item.snapshotAsOf}</td>
                    <td>{(item.proposal?.actions.length ?? 0)} / {item.executions.length}</td>
                    <td className="space-x-2">
                      <Button size="sm" variant="outline" onClick={() => setMonth(item.planningMonth)}>打开</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void deleteMonthlySession(item.key)}>删除</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-slate-500">导出与完整含附件备份在「数据中心」；删除会话不会删除已归档的原始证据文件。</p>
        </Card>
      )}

      {visionResult && (
        <Modal open onClose={() => setVisionResult(null)} title={`视觉识别结果 · ${visionResult.name}`} size="md"
          footer={<Button onClick={() => setVisionResult(null)}>关闭</Button>}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              模型 {visionResult.modelId} 的输出**未写入会话**：它不是事实层内容，请核对后手工录入，看不清的字段保持未知。
            </p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{visionResult.text}</pre>
          </div>
        </Modal>
      )}

      {executionTarget && session && (
        <ExecutionModal action={executionTarget} onClose={() => setExecutionTarget(null)}
          onSubmit={async (status, amount) => {
            await recordMonthlyExecution(session.key, {
              id: `exec:${Date.now()}`, proposalId: session.proposal?.id ?? 'proposal', actionId: executionTarget.id,
              status, executedAt: new Date().toISOString(), actualAmount: amount, evidence: [],
            });
            setExecutionTarget(null);
            pushToast('已登记执行回执', 'success');
          }} />
      )}
    </div>
  );
}

function ExecutionModal({ action, onClose, onSubmit }: { action: ProposedAction; onClose: () => void; onSubmit: (status: 'executed' | 'partially-executed' | 'deferred' | 'rejected', amount: number | null) => Promise<void> }) {
  const [status, setStatus] = useState<'executed' | 'partially-executed' | 'deferred' | 'rejected'>('executed');
  const [amount, setAmount] = useState<number | ''>(action.amount ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="登记执行回执" size="sm"
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
        <Button disabled={busy} onClick={() => { setBusy(true); void onSubmit(status, amount === '' ? null : Number(amount)).finally(() => setBusy(false)); }}>保存回执</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{action.rationale}</p>
        <SelectField label="实际结果" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}
          options={[
            { value: 'executed', label: '已执行' }, { value: 'partially-executed', label: '部分执行' },
            { value: 'deferred', label: '暂缓' }, { value: 'rejected', label: '不做' },
          ]} />
        <MoneyField label="实际金额（可留空）" value={amount} onChange={setAmount} />
        <p className="text-xs text-slate-500">只有登记回执才会增加累计已执行量；批准不等于成交。</p>
      </div>
    </Modal>
  );
}

function monthlyPlanKeySafe(month: string): string {
  try { return monthlyPlanKey(month); } catch { return 'monthly-planning:0000-01'; }
}

function channelsTotal(channels: ReturnType<typeof useAppStore.getState>['channels']): number {
  return totalAssets(channels);
}

/** 会话内的可投资分母只用本期观察值；没有观测就返回 null，绝不拿渠道资产顶替。 */
function investableTotalOf(session: MonthlyReview, restricted: number | ''): number | null {
  if (!session.observations.length || restricted === '' || session.observations.some((observation) => observation.marketValue === null)) return null;
  const observed = sumMoney(session.observations.map((observation) => observation.marketValue as number));
  if (!session.observations.length || !(observed > 0) || !Number.isFinite(observed)) return null;
  const restrictedValue = Number(restricted);
  const value = moneyDiff(observed, restrictedValue);
  return value > 0 ? value : null;
}

