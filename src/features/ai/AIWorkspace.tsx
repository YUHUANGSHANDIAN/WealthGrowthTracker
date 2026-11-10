import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Badge } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { TextArea } from '../../components/ui/form';
import { useAIWorkspaceStore, type AIWorkspaceTarget } from '../../store/aiWorkspaceStore';
import { useAIConnectionStore } from '../../store/aiConnectionStore';
import { useAppStore } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useNavigationStore } from '../../store/navigationStore';
import { prepareAIOperation, runAuthorizedAI, validateExplanation, prepareAIChange, confirmAIChange,
  type AuthorizedOperation, type ChangeProposal, type Explanation } from '../../services/ai/business';
import { cancelAI, type AITask, type InferenceResult } from '../../services/ai/client';
import { saveAIAnnotation } from '../../services/ai/annotations';
import { formatCNY } from '../../utils/money';
import { todayString } from '../../utils/date';
import { ExplanationView } from './ExplanationView';

const labels: Record<AITask, string> = {
  'report-interpretation': '报告解读', 'analysis-question': '分析问答', 'entry-draft': '自然语言余额录入',
  'data-health-explanation': '数据健康解释', 'data-health-assistant': '数据健康助手', 'goal-scenario': '目标情景解释',
  'document-extraction': '资料结构化提取（需视觉模型）', 'attribution-explanation': '归属解释',
  'research-summary': '研究摘要', 'monthly-narrative': '月度叙述',
};
const questions: Record<AITask, string> = {
  'report-interpretation': '请解释这份报告的资产变化、覆盖限制，以及我需要核对的事实。',
  'analysis-question': '请解释所选区间的资产变化和数据覆盖；没有现金流依据时不要推断原因。',
  'entry-draft': '', 'data-health-explanation': '请解释这些数据覆盖指标代表什么，并建议我在数据中心检查哪些项目。不要执行修复。',
  'data-health-assistant': '请解释当前数据健康问题，并只引用已授权事实。',
  'goal-scenario': '请根据我授权的确定性事实解释目标情景的假设和限制。',
  'document-extraction': '请把已授权的资料内容按结构化字段返回；无法确定的字段标记为未知，不要猜测金额。',
  'attribution-explanation': '请解释这些持仓的归属判断依据与不确定之处，不要改变任何金额。',
  'research-summary': '请只根据我授权的研究来源摘要，标注发布日期与适用范围，不要编造链接。',
  'monthly-narrative': '请根据本次授权的月度事实解释计划与限制，不要给出可执行的交易指令。',
};

export function AIWorkspace() {
  const target = useAIWorkspaceStore(s => s.target);
  return target ? <WorkspaceSession key={JSON.stringify(target)} target={target} /> : null;
}

function WorkspaceSession({ target }: { target: AIWorkspaceTarget }) {
  const channels = useAppStore(s => s.channels);
  const reports = useAppStore(s => s.reports);
  const revision = useAppStore(s => s.dataRevision);
  const hidden = useWorkspaceStore(s => s.amountsHidden);
  const enabled = useAIConnectionStore(s => s.enabled);
  const profiles = useAIConnectionStore(s => s.profiles);
  const activeId = useAIConnectionStore(s => s.activeProfileId);
  const profile = profiles.find(p => p.profileId === activeId);
  const [question, setQuestion] = useState(questions[target.task]);
  const [amounts, setAmounts] = useState(target.task !== 'entry-draft' && target.task !== 'data-health-explanation');
  const [includeChannels, setIncludeChannels] = useState(target.task === 'entry-draft');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [operation, setOperation] = useState<AuthorizedOperation | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [change, setChange] = useState<ChangeProposal | null>(null);
  const [usage, setUsage] = useState<InferenceResult['usage'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const runId = useRef(0);
  const pendingId = useRef<string | null>(null);
  const report = reports.find(r => r.id === target.reportId);
  const choices = useMemo(() => (target.reportId ? report?.channels ?? [] : channels).flatMap(c =>
    target.task === 'entry-draft' && c.children?.length
      ? c.children.map(child => ({ id: child.id, label: `${c.name} / ${child.name}` }))
      : [{ id: c.id, label: c.name }, ...(target.task === 'entry-draft' ? [] : (c.children ?? []).map(child => ({ id: child.id, label: `${c.name} / ${child.name}` })))])
    , [channels, report, target.reportId, target.task]);

  function invalidate() {
    runId.current++;
    if (pendingId.current) void cancelAI(pendingId.current).catch(() => {});
    pendingId.current = null;
    setBusy(false); setOperation(null); setExplanation(null); setChange(null); setUsage(null); setSaved(false);
  }
  useEffect(() => {
    // The ref objects never change identity; bumping the counter invalidates in-flight runs.
    const generation = runId;
    const pending = pendingId;
    generation.current++;
    if (pending.current) void cancelAI(pending.current).catch(() => {});
    pending.current = null;
    setBusy(false); setOperation(null); setExplanation(null); setChange(null); setUsage(null);
    return () => {
      generation.current++;
      if (pending.current) void cancelAI(pending.current).catch(() => {});
      pending.current = null;
    };
  }, [revision, hidden]);

  function close() { invalidate(); useAIWorkspaceStore.getState().close(); }
  function requestClose() {
    if (busy || explanation || change || question !== questions[target.task]) setConfirmClose(true);
    else close();
  }
  function prepare() {
    invalidate(); setError(null);
    try {
      if (includeChannels && selectedIds.length === 0) throw new Error('请至少选择一个渠道');
      const next = prepareAIOperation(target.task, {
        ...(target.reportId ? { reportId: target.reportId } : {}),
        ...(target.range ? { range: target.range } : {}),
        includeGoal: target.task === 'goal-scenario', ...(target.goalId ? { goalId: target.goalId } : {}),
        includeChannels, ...(includeChannels ? { channelIds: selectedIds } : {}), includeHistory: false,
        includeLottery: false, includeAmounts: amounts, includeDataHealth: target.task === 'data-health-explanation',
        includeRangeSummary: target.task === 'analysis-question',
      }, question);
      if (!next.pack.facts.length) throw new Error('所选范围没有可发送的事实');
      setOperation(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法准备上下文'); }
  }
  async function send() {
    if (!operation || busy) return;
    const current = ++runId.current; pendingId.current = operation.requestId;
    setBusy(true); setError(null); setExplanation(null); setChange(null); setSaved(false);
    try {
      const result = await runAuthorizedAI(operation);
      if (current !== runId.current) return;
      if (target.task === 'entry-draft') setChange(prepareAIChange(result.text, operation));
      else setExplanation(validateExplanation(result.text, operation.pack));
      setUsage(result.usage);
    } catch (cause) { if (current === runId.current) setError(cause instanceof Error ? cause.message : '请求失败，请重新授权后重试'); }
    finally { if (current === runId.current) { setBusy(false); pendingId.current = null; } }
  }
  async function save() {
    if (busy || saved || !operation) return;
    setBusy(true); setError(null);
    try {
      if (change) { await confirmAIChange(change); setChange(null); useAppStore.getState().pushToast('已确认余额变更并保存快照', 'success'); close(); }
      else if (explanation && target.task === 'report-interpretation') { await saveAIAnnotation(operation, explanation); setSaved(true); useAppStore.getState().pushToast('已保存独立 AI 附注', 'success'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  }
  const boundProfile = operation
    ? profiles.find((item) => item.profileId === operation.profileId) ?? profile
    : profile;
  const ready = enabled && boundProfile?.enabled && ['configured', 'tested'].includes(boundProfile.state);
  return <>
    <Modal open onClose={requestClose} title={labels[target.task]} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={ready ? 'emerald' : 'amber'}>{ready ? boundProfile.label : '连接未就绪'}</Badge><span className="text-xs text-slate-500">{boundProfile ? `${boundProfile.providerId} · ${boundProfile.modelId} · config r${boundProfile.configRevision}` : '请先配置连接中心'}</span></div>
        {!ready && <div className="rounded-lg bg-slate-50 p-4 text-sm"><p>连接测试仅使用合成消息。财务上下文由你在此逐次授权。</p><Button className="mt-3" variant="outline" onClick={() => { close(); useNavigationStore.getState().navigate({ tab: 'ai' }); }}>打开连接中心</Button></div>}
        {hidden ? <p role="status">金额隐私已开启，业务 AI 已暂停。</p> : <>
          <div className="text-sm text-slate-500">{target.reportId ? `报告：${report?.title ?? '报告已删除'}` : target.range ? `区间：${target.range.start} — ${target.range.end}` : target.task === 'entry-draft' ? `更新日期：${todayString()}（今天的渠道余额）` : '仅数据覆盖统计'} · revision {revision}</div>
          <TextArea label={target.task === 'entry-draft' ? '描述今天的渠道余额' : '你的问题'} value={question} maxLength={4_000} rows={3}
            placeholder={target.task === 'entry-draft' ? '例如：把现金余额更新为 1200 元。请明确余额，避免只写“收入 100”。' : undefined}
            disabled={busy} onChange={event => { invalidate(); setQuestion(event.target.value); }} />
          <fieldset className="space-y-3 text-sm" disabled={busy}><legend className="font-semibold mb-2">授权数据范围</legend>
            <p className="text-xs text-slate-500">不发送用户备注、彩票、其他报告或未选历史。下方会列出本次完整事实和用户问题。</p>
            {target.task !== 'entry-draft' && target.task !== 'data-health-explanation' && <label className="flex items-center gap-2"><input type="checkbox" checked={amounts} onChange={event => { invalidate(); setAmounts(event.target.checked); }} />允许发送金额与区间指标</label>}
            {target.task !== 'data-health-explanation' && <label className="flex items-center gap-2"><input type="checkbox" checked={includeChannels} disabled={target.task === 'entry-draft'} onChange={event => { invalidate(); setIncludeChannels(event.target.checked); }} />{target.task === 'entry-draft' ? '选择允许更新的渠道（只发送 ID 和名称）' : '附加所选渠道的金额与名称'}</label>}
            {includeChannels && <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg p-3 space-y-2">{choices.map(item => <label key={item.id} className="flex items-center gap-2 break-all"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => { invalidate(); setSelectedIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id)); }} />{item.label}</label>)}{!choices.length && <p>没有可选渠道，请先建立渠道。</p>}</div>}
          </fieldset>
          <Button variant="outline" disabled={!ready || busy || !question.trim()} onClick={prepare}>预览本次发送内容</Button>
          {operation && <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-3 text-sm" aria-label="ContextManifest">
            <h3 className="font-semibold">本次授权清单</h3>
            <p>目的地：{operation.providerId} / {operation.profileId} / {operation.modelId}<br />数据版本：{operation.pack.manifest.baseRevision} · 金额：{operation.pack.manifest.includeAmounts ? '允许' : '不发送'} · 事实：{operation.pack.facts.length} 条</p>
            <details><summary>查看完整字段、值与来源</summary><p className="mt-2 whitespace-pre-wrap break-all">问题：{operation.question}</p><dl className="mt-3 space-y-2">{operation.pack.facts.map(fact => <div key={fact.factId}><dt className="font-medium">{fact.label} · {fact.factId}</dt><dd className="break-all">{fact.value} {fact.unit}<br /><span className="text-xs text-slate-500">{fact.source}{fact.asOf ? ` · 截至 ${fact.asOf}` : ''}</span></dd></div>)}</dl></details>
            <p className="text-xs text-slate-500">这次授权只用于当前任务。提供商可能处理这些数据，并按自己的权益或账单计费。已列出的字段和值将与本地日期、固定结构化指令一起发送。</p>
            <div className="flex flex-wrap gap-2"><Button disabled={busy || !!explanation || !!change} onClick={() => void send()}>{busy ? '正在处理…' : '授权发送这一次'}</Button>{busy && <Button variant="outline" onClick={() => { invalidate(); setError('已取消，未保存 AI 结果。'); }}>取消请求</Button>}</div>
          </section>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {explanation && operation && <section className="space-y-3" aria-label="AI 解读结果"><h3 className="font-semibold">解读草稿</h3><ExplanationView explanation={explanation} references={operation.pack.facts} />
            {target.task === 'report-interpretation' && <Button disabled={busy || saved} onClick={() => void save()}>{saved ? '已保存独立附注' : '保存为独立 AI 附注'}</Button>}
          </section>}
          {change && <section className="space-y-3" aria-label="AI 余额变更预览"><h3 className="font-semibold">确认余额变更</h3><p className="text-sm">AI 草稿已经过本地域校验。确认后创建备份并保存余额与日快照。</p>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th scope="col" className="text-left">渠道</th><th scope="col">原余额</th><th scope="col">新余额</th></tr></thead><tbody>{change.proposal.changes.map((row, index) => <tr key={index}><th scope="row" className="text-left py-2">{row.path}</th><td className="tabular text-right">{formatCNY(row.before)}</td><td className="tabular text-right">{formatCNY(row.after)}</td></tr>)}</tbody></table></div>
            <p className="text-sm">总资产：{formatCNY(change.proposal.oldTotal)} → {formatCNY(change.proposal.newTotal)}</p>
            {change.warnings.map((warning, index) => <p className="text-sm text-amber-700" key={index}>{warning}</p>)}
            <Button disabled={busy} onClick={() => void save()}>确认余额并保存</Button>
          </section>}
          {usage && <p className="text-xs text-slate-500">本次输入 tokens：{usage.inputTokens ?? '服务未提供'} · 输出 tokens：{usage.outputTokens ?? '服务未提供'}。实际费用与订阅额度以提供商账单为准。</p>}
        </>}
      </div>
    </Modal>
    <ConfirmDialog open={confirmClose} title="关闭 AI 工作区" message="未保存的解读或录入草稿将丢弃，进行中的请求会取消。" confirmLabel="丢弃并关闭" onConfirm={close} onCancel={() => setConfirmClose(false)} />
  </>;
}
