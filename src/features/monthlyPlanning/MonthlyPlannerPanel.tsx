import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { MoneyField, SelectField, TextField } from '../../components/ui/form';
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
import { createDraftSession, monthlyPlanKey, transitionSession } from '../../domain/portfolio/session';
import { validateMonthlySession, type SessionIssue } from '../../domain/portfolio/invariants';
import { carryOverPlan, markCarryOverStale, summarizeCarryOver, checkPeriodContinuity, type CarriedItem } from '../../domain/portfolio/carryOver';
import { putAttachment } from '../../services/monthlyPlanning/attachments';
import { extractDocxFromPackage } from '../../services/documents/ooxml';
import { extractHoldingRows, type HoldingRowCandidate } from '../../services/documents/holdings';
import { assertIntakeAllowed, intakeDocument, sha256Hex, type DocumentKind } from '../../services/documents/intake';
import { detectScopeHints, planImageChunks } from '../../services/documents/image';
import type {
  CashFlowEvent, Holding, HoldingObservation, InvestmentPolicy, MonthlyReview, ProposedAction,
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
  const dataRevision = useAppStore((s) => s.dataRevision);
  const upsertMonthlySession = useAppStore((s) => s.upsertMonthlySession);
  const saveMonthlyPolicy = useAppStore((s) => s.saveMonthlyPolicy);
  const recordMonthlyExecution = useAppStore((s) => s.recordMonthlyExecution);
  const setMonthlySettings = useAppStore((s) => s.setMonthlySettings);
  const deleteMonthlySession = useAppStore((s) => s.deleteMonthlySession);
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigationStore((s) => s.navigate);

  const [month, setMonth] = useState(currentMonth);
  const [section, setSection] = useState<SectionId>('overview');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importChannelId, setImportChannelId] = useState(channels[0]?.id ?? '');
  const [sourceTotal, setSourceTotal] = useState<number | ''>('');
  const [liabilityTotal, setLiabilityTotal] = useState<number | ''>('');
  const [restrictedTotal, setRestrictedTotal] = useState<number | ''>('');
  const [goalMonths, setGoalMonths] = useState<number | ''>(12);
  const [goalContribution, setGoalContribution] = useState<number | ''>(0);
  const [carry, setCarry] = useState<CarriedItem[]>([]);
  const [executionTarget, setExecutionTarget] = useState<ProposedAction | null>(null);
  const [flowForm, setFlowForm] = useState<{ kind: CashFlowEvent['kind']; amount: number | '' }>({ kind: 'external-income', amount: '' });

  const session = planning.sessions.find((item) => item.key === monthlyPlanKeySafe(month)) ?? null;
  const previous = planning.sessions.find((item) => item.key === monthlyPlanKeySafe(previousMonth(month)) && (item.state === 'confirmed' || item.state === 'archived')) ?? null;
  const policy = planning.policies.find((item) => item.id === session?.policyId) ?? planning.policies[planning.policies.length - 1] ?? null;

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
  const dueToday = todayString().slice(8, 10) >= String(planning.settings.reminderDay).padStart(2, '0');

  async function save(next: MonthlyReview, label?: string) {
    setBusy(true); setError(null);
    try {
      await upsertMonthlySession({ ...next, revision: next.revision + 1 }, label);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function openOrCreate() {
    if (session) { pushToast('本月会话已存在，直接编辑', 'info'); return; }
    const draft = createDraftSession({ planningMonth: month, timezone: planning.settings.timezone, today: todayString(), now: new Date().toISOString() });
    await save(draft, '正在创建月度会话');
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length || !session) return;
    setBusy(true); setError(null);
    try {
      let next: MonthlyReview = { ...session };
      const documents = [...next.documents];
      const holdings = [...next.holdings];
      const observations = [...next.observations];
      const warnings: string[] = [];
      for (const file of Array.from(files)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const kind: DocumentKind = assertIntakeAllowed(file.name, bytes.byteLength);
        const hash = await sha256Hex(bytes);
        const intake = intakeDocument({
          id: `doc:${hash.slice(0, 12)}`, name: file.name, mime: file.type, byteLength: bytes.byteLength,
          hash, importedAt: new Date().toISOString(),
        }, documents);
        if (intake.duplicateOf) { warnings.push(`${file.name}：内容与已有资料相同，已跳过`); continue; }
        const attachment = await putAttachment({ name: file.name, mime: file.type || kind, bytes });
        const document = { ...intake.document, relativePath: attachment.key, parseState: 'parsed' as const };
        if (kind === 'docx') {
          const extraction = await extractDocxFromPackage(bytes);
          const { rows, duplicates } = extractHoldingRows(extraction.tables, {
            sourceId: document.id, extractor: 'ooxml', extractorVersion: '1',
          });
          if (duplicates) warnings.push(`${file.name}：忽略 ${duplicates} 行重复内容（替代表示或重复行）`);
          for (const candidate of rows) {
            const holdingId = `holding:${document.id}:${candidate.tableIndex}:${candidate.rowIndex}`;
            holdings.push(candidateToHolding(candidate, holdingId, importChannelId));
            observations.push(candidateToObservation(candidate, holdingId, session.key, document.id));
          }
          if (!rows.length) warnings.push(`${file.name}：未识别到持仓行，请手工补充`);
        } else if (kind === 'image') {
          let chunkNote = '';
          try {
            if (typeof createImageBitmap === 'function') {
              const bitmap = await createImageBitmap(file);
              const chunks = planImageChunks({ width: bitmap.width, height: bitmap.height });
              chunkNote = `图片 ${bitmap.width}×${bitmap.height}，分 ${chunks.length} 块（含重叠，识别后去重）`;
              bitmap.close?.();
            }
          } catch { chunkNote = '图片尺寸读取失败，请人工核对范围'; }
          warnings.push(`${file.name}：已记录图片与范围声明（${chunkNote || '未分块'}）；图片识别需要先在「模型连接」配置视觉模型，未配置时请手工录入`);
        } else if (kind === 'csv' || kind === 'markdown' || kind === 'text') {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          const hints = detectScopeHints(text);
          document.scopeNote = hints.notes.join('；') || undefined;
        }
        documents.push(document);
      }
      next = { ...next, documents, holdings, observations };
      await save(next, '正在保存导入资料');
      if (warnings.length) pushToast(warnings.join('；'), 'info');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  function candidateToHolding(candidate: HoldingRowCandidate, id: string, channelId: string): Holding {
    return {
      id,
      platform: 'manual',
      parentChannelId: channelId,
      fundCode: candidate.fundCode ?? undefined,
      originalName: candidate.name ?? candidate.fundCode ?? '未命名持仓',
      currency: 'CNY',
      productType: 'fund',
      exposureTags: [],
    };
  }

  function candidateToObservation(candidate: HoldingRowCandidate, holdingId: string, sessionKey: string, sourceId: string): HoldingObservation {
    return {
      id: `obs:${holdingId}`,
      holdingId,
      sessionKey,
      shares: candidate.shares,
      marketValue: candidate.marketValue,
      nav: candidate.nav,
      ...(candidate.nav ? { navDate: todayString() } : {}),
      evidence: candidate.evidence.map((ref) => ({ ...ref, sourceId })),
      quality: {
        source: 'evidence',
        attribution: importChannelId ? 'conditional' : 'unassigned',
        valuation: candidate.marketValue === null ? 'missing' : 'observed',
        time: 'observed',
        review: 'pending',
      },
    };
  }

  async function savePolicy(patch: Partial<InvestmentPolicy>) {
    const base = policy ?? defaultPolicy(todayString());
    const next: InvestmentPolicy = { ...base, ...patch, version: base.version + 1, approvedByUser: true, effectiveFrom: todayString() };
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
    const active = policy ?? defaultPolicy(todayString());
    const positions = buildPositions(session);
    const investable = investableTotalOf(session, channelsTotal(channels), restrictedTotal);
    const unknownCount = session.observations.filter((observation) => observation.marketValue === null).length;
    const proposal = generateProposal(active, {
      investableTotal: investable,
      availableCash: usableCash(liabilityTotal === '' ? null : Number(liabilityTotal), annualIncomeByMonth),
      positions,
      dataRed: unknownCount > 0 && session.observations.length > 0,
      ...(unknownCount ? { dataRedReasons: [`存在 ${unknownCount} 条金额未知的持仓，请先补齐或标记为未知`] } : {}),
    }, { sessionKey: session.key, now: new Date().toISOString() });
    await save({ ...session, proposal }, '正在保存候选方案');
  }

  async function confirmPlan() {
    if (!session) return;
    try {
      const planned = transitionSession(session, 'planned', { now: new Date().toISOString() });
      const confirmed = transitionSession(planned, 'confirmed', { now: new Date().toISOString(), baseDataRevision: dataRevision, issues });
      await save(confirmed, '正在确认月度计划');
      pushToast('月度计划已确认（未成交，需要你手工执行）', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '确认失败');
    }
  }

  function totalsOf(current: MonthlyReview) {
    const assets = sumMoney(current.observations.map((observation) => observation.marketValue ?? 0));
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

  const investable = session ? investableTotalOf(session, channelsTotal(channels), restrictedTotal) : null;
  const breaches = policy ? evaluatePolicy(policy, { exposures, exposureBase: investable }).breaches : [];
  const carrySummary = summarizeCarryOver(carry);
  const continuity = checkPeriodContinuity({ previous, nextReviewPeriodStart: session?.reviewPeriodStart ?? null });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <TextField label="规划月份" type="month" value={month} onChange={(event) => setMonth(event.target.value || currentMonth())} />
          <div className="text-sm text-slate-600">
            会话：{session ? <Badge tone={session.state === 'confirmed' || session.state === 'archived' ? 'emerald' : 'blue'}>{session.state}</Badge> : '未创建'}
            {session && <span className="ml-2 text-xs text-slate-500">revision {session.revision} · 快照 {session.snapshotAsOf}</span>}
          </div>
          <Button disabled={busy} onClick={() => void openOrCreate()}>{session ? '本月会话已存在' : '创建本月会话'}</Button>
          <Button variant="outline" disabled={!session || busy || hardErrors.length > 0} onClick={() => void confirmPlan()}>确认月度计划</Button>
          <div className="ml-auto text-xs text-slate-500">
            提醒：每月 {planning.settings.reminderDay} 日 {planning.settings.reminderTime}（{planning.settings.timezone}）
            <label className="ml-2 inline-flex items-center gap-1">
              <input type="checkbox" checked={planning.settings.reminderEnabled} onChange={(event) => void setMonthlySettings({ reminderEnabled: event.target.checked })} />
              应用内提醒
            </label>
          </div>
        </div>
        {dueToday && session?.state !== 'confirmed' && session?.state !== 'archived' && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            已到本月提醒日：现在开始月度流程。提醒不等于工资到账、负债清零或基金净值已结算，请在「快照确认」逐项核对。
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
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
            <SelectField label="默认归属父渠道（可行时再逐条调整）" value={importChannelId}
              onChange={(event) => setImportChannelId(event.target.value)}
              options={channels.length ? channels.map((channel) => ({ value: channel.id, label: channel.name })) : [{ value: '', label: '（请先在资产页建立渠道）' }]} />
            <label className="text-sm">
              选择文件（DOCX / 图片 / CSV / Markdown）
              <input type="file" multiple className="block mt-1 text-xs" disabled={!session || busy}
                onChange={(event) => { void handleFiles(event.target.files); event.target.value = ''; }} />
            </label>
            <MoneyField label="来源声明总额（可选）" value={sourceTotal} onChange={setSourceTotal} />
          </div>
          <p className="text-xs text-slate-500">导入到本地不等于同意外发；图片识别需要先在「模型连接」配置视觉模型，未配置时请手工录入。</p>
          {session?.documents.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th>文件</th><th>平台</th><th>完整性</th><th>解析</th><th>范围声明</th></tr></thead>
              <tbody>
                {session.documents.map((document) => (
                  <tr key={document.id} className="border-t border-slate-100">
                    <td className="py-1.5 break-all">{document.originalName}<div className="text-[11px] text-slate-400">{document.relativePath}</div></td>
                    <td>{document.platform}</td>
                    <td>{document.integrity === 'ok' ? '正常' : '异常'}</td>
                    <td>{document.parseState}</td>
                    <td className="text-xs">{document.scopeNote ?? '—'}</td>
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
          {!session?.holdings.length ? <EmptyState icon="📊" title="还没有持仓" description="先导入资料，或在下方手工补充。" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th>代码/名称</th><th>市值</th><th>份额</th><th>状态</th><th>暴露标签</th></tr></thead>
                <tbody>
                  {session.holdings.map((holding) => {
                    const observation = session.observations.find((item) => item.holdingId === holding.id);
                    return (
                      <tr key={holding.id} className="border-t border-slate-100">
                        <td className="py-1.5">{holding.fundCode ?? '—'} · {holding.originalName}</td>
                        <td className="tabular">{observation?.marketValue === null || observation?.marketValue === undefined ? '未知' : formatCNY(observation.marketValue)}</td>
                        <td className="tabular">{observation?.shares ?? '未知'}</td>
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
              <MoneyField label="最小交易额" value={policy?.minTradeAmount ?? ''} onChange={(value) => void savePolicy({ minTradeAmount: value === '' ? null : Number(value) })} />
              <TextField label="冷静期（天）" type="number" value={String(policy?.cooldownDays ?? 0)}
                onChange={(event) => void savePolicy({ cooldownDays: Number(event.target.value) || 0 })} />
              <TextField label="止盈台阶（累计比例，逗号分隔）" value={(policy?.takeProfit?.steps ?? []).map((step) => step.cumulativeTarget).join(',')}
                onChange={(event) => {
                  const steps = event.target.value.split(',').map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value > 0 && value <= 1)
                    .map((value, index) => ({ cumulativeTarget: value, label: `第${index + 1}阶` }));
                  void savePolicy({ takeProfit: { referenceShares: policy?.takeProfit?.referenceShares ?? '100.0000', steps, executedCumulative: policy?.takeProfit?.executedCumulative ?? 0 } });
                }} />
              <TextField label="已执行累计比例" type="number" step="0.01" value={String(policy?.takeProfit?.executedCumulative ?? 0)}
                onChange={(event) => void savePolicy({ takeProfit: { referenceShares: policy?.takeProfit?.referenceShares ?? '100.0000', steps: policy?.takeProfit?.steps ?? [], executedCumulative: Number(event.target.value) || 0 } })} />
              <TextField label="目标配比（标签:比例，逗号分隔）" value={Object.entries(policy?.targetAllocation ?? {}).map(([key, value]) => `${key}:${value}`).join(',')}
                onChange={(event) => {
                  const allocation: Record<string, number> = {};
                  for (const part of event.target.value.split(',')) {
                    const [key, value] = part.split(':').map((item) => item.trim());
                    const parsed = Number(value);
                    if (key && Number.isFinite(parsed) && parsed > 0 && parsed <= 1) allocation[key] = parsed;
                  }
                  void savePolicy({ targetAllocation: allocation });
                }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">策略是用户自己的政策（旧 v9 规则的版本化承接），不是通用投资建议；修改后生成新版本，旧结果仍可复现。</p>
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
              <Button variant="outline" onClick={() => navigate({ tab: 'ai' })}>配置模型连接</Button>
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold mb-2">目标情景（复用现有目标口径）</h3>
            <div className="flex flex-wrap items-end gap-3">
              <TextField label="期限（月）" type="number" value={String(goalMonths)} onChange={(event) => setGoalMonths(Number(event.target.value) || 0)} />
              <MoneyField label="每月投入假设" value={goalContribution} onChange={setGoalContribution} />
            </div>
            {(() => {
              const basis = channelsTotal(channels);
              const months = Number(goalMonths) || 0;
              const contribution = Number(goalContribution) || 0;
              const scenarios = goalScenarios(
                { goalId: null, targetAmount: 1_000_000, basis: 'all-assets', baselineDate: todayString(), monthlyContribution: contribution, scenarios: [{ id: 'legacy', label: '沿用旧假设（年化 5%）', annualRate: 0.05 }], quality: { source: 'computed', attribution: 'confirmed', valuation: 'observed', time: 'observed', review: 'pending' } },
                { months, baseAmount: basis },
              );
              const required = requiredMonthlyContribution({ target: 1_000_000, baseAmount: basis, months, annualRate: 0.05 });
              const implied = impliedAnnualRate({ target: 1_000_000, baseAmount: basis, monthlyContribution: contribution, months });
              return (
                <div className="mt-3 space-y-1 text-sm">
                  <p>当前基线（全部资产）：{formatCNY(basis)}</p>
                  <p>按 5% 年化所需月投入：{required === null ? '期限无效或不可计算' : formatCNY(required)}；当前假设月投入 {formatCNY(contribution)}</p>
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
          {planning.sessions.length === 0 ? <EmptyState icon="🗂️" title="还没有月度会话" description="创建本月会话后会出现在这里。" /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th>会话</th><th>状态</th><th>快照</th><th>候选/回执</th><th>操作</th></tr></thead>
              <tbody>
                {planning.sessions.map((item) => (
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

function investableTotalOf(session: MonthlyReview, fallbackTotal: number, restricted: number | ''): number | null {
  const observed = sumMoney(session.observations.filter((observation) => observation.marketValue !== null).map((observation) => observation.marketValue as number));
  const base = observed > 0 ? observed : fallbackTotal;
  if (!Number.isFinite(base)) return null;
  const restrictedValue = restricted === '' ? 0 : Number(restricted);
  const value = moneyDiff(base, restrictedValue);
  return value > 0 ? value : null;
}

