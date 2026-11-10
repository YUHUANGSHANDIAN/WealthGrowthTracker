import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { TextArea } from '../../components/ui/form';
import type { DataIssue } from '../../utils/dataHealth';
import { useAppStore } from '../../store/appStore';
import { useAIConnectionStore } from '../../store/aiConnectionStore';
import { useHealthAssistantStore } from '../../store/healthAssistantStore';
import { useNavigationStore } from '../../store/navigationStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  prepareAIOperation,
  runAuthorizedAI,
  validateHealthAssistantReply,
  type AuthorizedOperation,
  type HealthAssistantReply,
} from '../../services/ai/business';
import { cancelAI } from '../../services/ai/client';
import {
  HEALTH_ASSISTANT_BOUNDED_CONTEXT,
  HEALTH_ASSISTANT_MAX_MESSAGES,
} from '../../domain/healthAssistant/state';
import type {
  HealthAssistantConversation,
  HealthAssistantMessage,
  HealthAssistantRetention,
} from '../../domain/healthAssistant/types';

const RETENTIONS: Array<{ value: HealthAssistantRetention; label: string }> = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天（默认）' },
  { value: 90, label: '90 天' },
  { value: 365, label: '1 年' },
  { value: 'forever', label: '永久' },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '健康助手请求失败';
}

function nowIso(): string {
  return new Date().toISOString();
}

export function HealthAssistantDrawer({
  open,
  issue,
  onClose,
  onPreviewFix,
}: {
  open: boolean;
  issue: DataIssue | null;
  onClose: () => void;
  onPreviewFix: (issue: DataIssue) => void;
}) {
  const ledgerId = useAppStore((state) => state.ledgerIdentity.ledgerId);
  const dataRevision = useAppStore((state) => state.dataRevision);
  const amountsHidden = useWorkspaceStore((state) => state.amountsHidden);
  const aiEnabled = useAIConnectionStore((state) => state.enabled);
  const profiles = useAIConnectionStore((state) => state.profiles);
  const activeProfileId = useAIConnectionStore((state) => state.activeProfileId);
  const assistant = useHealthAssistantStore();
  const navigate = useNavigationStore((state) => state.navigate);
  const profile = profiles.find((item) => item.profileId === activeProfileId);
  const ready = aiEnabled && profile?.enabled && ['configured', 'tested'].includes(profile.state);

  const [question, setQuestion] = useState('');
  const [includeEvidence, setIncludeEvidence] = useState(false);
  const [operation, setOperation] = useState<AuthorizedOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState<HealthAssistantConversation | null>(null);
  const busyRef = useRef(busy);
  const operationRef = useRef(operation);
  busyRef.current = busy;
  operationRef.current = operation;

  const issueKey = issue ? `${issue.id}:${issue.fingerprint}` : 'free-question';
  const existing = useMemo(() => assistant.state.conversations.find((conversation) =>
    conversation.ledgerId === ledgerId
    && conversation.issueId === (issue?.id ?? null)
    && conversation.issueFingerprint === (issue?.fingerprint ?? null)), [assistant.state.conversations, issue, ledgerId]);

  useEffect(() => {
    if (open) void assistant.load();
  }, [assistant, open]);

  useEffect(() => {
    setOperation(null);
    setError('');
    setQuestion('');
    setIncludeEvidence(false);
    setSession(existing ?? null);
  }, [issueKey, open, existing]);

  useEffect(() => {
    setOperation(null);
    if (busyRef.current && operationRef.current) void cancelAI(operationRef.current.requestId).catch(() => {});
  }, [dataRevision, amountsHidden]);

  const connectionChanged = Boolean(session && profile
    && (session.profileId !== profile.profileId || session.modelId !== profile.modelId || session.providerId !== profile.providerId));
  const conversationStale = Boolean(session
    && (session.baseRevision !== dataRevision || (issue && session.issueFingerprint !== issue.fingerprint)));

  function startCleanSession() {
    setSession(null);
    setOperation(null);
    setError('');
  }

  function prepare() {
    setOperation(null);
    setError('');
    if (!question.trim()) {
      setError('请输入要询问的数据健康问题');
      return;
    }
    if (!ready) {
      setError('请先在连接中心启用并选择可用连接；人工健康检查和修复不受影响');
      return;
    }
    if (connectionChanged) {
      setError('当前连接或模型与本地会话不同。请开始新会话，避免把历史上下文发送给另一提供商');
      return;
    }
    try {
      const recent = (session?.messages ?? []).slice(-HEALTH_ASSISTANT_BOUNDED_CONTEXT).map((message) => ({
        role: message.role,
        text: message.text,
      }));
      const next = prepareAIOperation('data-health-assistant', {
        includeChannels: false,
        includeHistory: false,
        includeLottery: false,
        includeAmounts: false,
        includeDataHealth: true,
        ...(issue ? {
          healthIssueId: issue.id,
          healthIssueFingerprint: issue.fingerprint,
          includeHealthEvidence: includeEvidence,
        } : {}),
      }, question, recent);
      setOperation(next);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function send() {
    if (!operation || !profile || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await runAuthorizedAI(operation);
      const reply: HealthAssistantReply = validateHealthAssistantReply(result.text, operation.pack, operation);
      if (operation.pack.manifest.healthIssueId && issue
        && operation.pack.manifest.healthIssueFingerprint !== issue.fingerprint) {
        throw new Error('问题证据已变化，迟到的 AI 回复未保存');
      }
      const createdAt = nowIso();
      const userMessage: HealthAssistantMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text: operation.question,
        createdAt,
      };
      const assistantMessage: HealthAssistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: reply.message,
        createdAt,
        citations: reply.citations,
        limitations: reply.limitations,
        ...(reply.proposal ? { proposal: reply.proposal } : {}),
      };
      const base = session && !connectionChanged ? session : null;
      const next: HealthAssistantConversation = base ? {
        ...base,
        messages: [...base.messages, userMessage, assistantMessage].slice(-HEALTH_ASSISTANT_MAX_MESSAGES),
        baseRevision: operation.pack.manifest.baseRevision,
        authorization: {
          issueId: issue?.id ?? null,
          issueFingerprint: issue?.fingerprint ?? null,
          domain: issue?.domain ?? null,
          includeEvidence,
          includeAmounts: false,
        },
        updatedAt: createdAt,
      } : {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        ledgerId,
        issueId: issue?.id ?? null,
        issueFingerprint: issue?.fingerprint ?? null,
        task: 'data-health-assistant',
        providerId: operation.providerId,
        profileId: operation.profileId,
        modelId: operation.modelId,
        authorization: {
          issueId: issue?.id ?? null,
          issueFingerprint: issue?.fingerprint ?? null,
          domain: issue?.domain ?? null,
          includeEvidence,
          includeAmounts: false,
        },
        baseRevision: operation.pack.manifest.baseRevision,
        messages: [userMessage, assistantMessage],
        createdAt,
        updatedAt: createdAt,
      };
      await assistant.saveConversation(next);
      setSession(next);
      setOperation(null);
      setQuestion('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function removeSession() {
    if (!session) return;
    if (!window.confirm('删除这个本地健康助手会话？不会修改任何财务数据或数据健康处理记录。')) return;
    try {
      await assistant.removeConversation(session.id);
      setSession(null);
      setOperation(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  const canPreviewFix = Boolean(issue && issue.fixable && issue.fix);

  return (
    <Modal open={open} onClose={onClose} title={issue ? '问 AI：数据健康问题' : '问 AI：数据健康助手'} size="lg" placement="right">
      <div className="space-y-4 text-sm">
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ready ? 'emerald' : 'amber'}>{ready && profile ? profile.label : '连接未就绪'}</Badge>
            {profile && <span className="text-xs text-slate-500">{profile.providerId} · {profile.modelId}</span>}
            {!aiEnabled && <Button size="sm" variant="outline" onClick={() => navigate({ tab: 'ai' })}>打开连接中心</Button>}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            AI 只接收本地健康扫描生成的受限事实。默认不发送金额、业务名称或原始证据；发送前你会看到完整授权清单。
            任何修复都只生成预览，仍需本地校验和你的明确确认。
          </p>
          {!ready && <p className="mt-2 text-xs text-amber-700">连接未就绪时，人工健康检查和修复仍可继续。</p>}
          {amountsHidden && <p className="mt-2 text-xs text-amber-700">金额隐私已开启，AI 健康助手暂停；人工检查仍可继续。</p>}
        </section>

        {issue && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-800">{issue.title}</h3>
                <p className="mt-1 text-xs text-slate-600">{issue.description}</p>
              </div>
              <Badge tone={issue.severity === 'error' ? 'red' : 'amber'}>{issue.severity === 'error' ? '错误' : '警告'}</Badge>
            </div>
            <p className="mt-2 text-xs text-slate-500">规则 {issue.code} · v{issue.ruleVersion} · 指纹 {issue.fingerprint.slice(0, 12)}…</p>
            <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-white p-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={includeEvidence}
                onChange={(event) => {
                  setIncludeEvidence(event.target.checked);
                  setOperation(null);
                }}
              />
              <span>
                展开精确证据并授权本次发送
                <span className="block text-xs text-slate-500">可能包含你明确审核的渠道名称、日期或本地维护说明；默认不发送。</span>
              </span>
            </label>
          </section>
        )}

        {session && (
          <section className="space-y-2" aria-label="健康助手会话">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-800">最近对话</h3>
              <button type="button" className="text-xs text-red-600 underline" onClick={() => void removeSession()}>删除本地会话</button>
            </div>
            {connectionChanged && (
              <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                当前连接与这个本地会话不同。历史上下文不会自动发送给另一提供商。
                <Button className="ml-2" size="sm" variant="outline" onClick={startCleanSession}>开始新会话</Button>
              </div>
            )}
            {conversationStale && (
              <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                数据或问题指纹已变化；旧建议已过期。继续提问会使用最新本地扫描并重新授权。
              </p>
            )}
            <div className="space-y-2">
              {session.messages.slice(-20).map((message) => (
                <article key={message.id} className={`rounded-xl p-3 ${message.role === 'user' ? 'ml-8 bg-emerald-50' : 'mr-8 border border-slate-200 bg-white'}`}>
                  <div className="text-[11px] font-medium text-slate-400">{message.role === 'user' ? '你' : 'AI（不可信草稿）'}</div>
                  <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
                  {message.citations?.length ? (
                    <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
                      {message.citations.map((citation, index) => (
                        <li key={index}>{citation.text} <span className="text-slate-400">[{citation.factIds.join(', ')}]</span></li>
                      ))}
                    </ul>
                  ) : null}
                  {message.limitations?.length ? (
                    <div className="mt-2 text-xs text-amber-700">限制：{message.limitations.join('；')}</div>
                  ) : null}
                  {message.proposal && (
                    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
                      <p className="font-medium">受限建议：{message.proposal.rationale}</p>
                      <p>置信度：{message.proposal.confidence} · {message.proposal.warnings.join('；')}</p>
                      {conversationStale && <p className="mt-1 text-amber-800">此建议已过期，不能直接执行。</p>}
                      {!conversationStale && issue && message.proposal.issueId === issue.id && (
                        message.proposal.operation === 'navigate'
                          ? <Button className="mt-2" size="sm" variant="outline" onClick={() => navigate({ tab: 'data', healthIssueId: issue.id })}>查看该问题</Button>
                          : canPreviewFix
                            ? <Button className="mt-2" size="sm" variant="outline" onClick={() => onPreviewFix(issue)}>查看本地修复预览</Button>
                            : null
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        <TextArea
          label="你的问题"
          rows={3}
          maxLength={4_000}
          value={question}
          disabled={busy || amountsHidden || connectionChanged}
          placeholder={issue ? '例如：这个提示会改变我的余额吗？我应该先核对什么？' : '描述你观察到的异常；AI 会先引用本地健康检查，不会凭空创建问题。'}
          onChange={(event) => {
            setQuestion(event.target.value);
            setOperation(null);
          }}
        />
        <p className="text-xs text-amber-700">请勿粘贴账号、密码、密钥、完整账本或与当前问题无关的私人财务资料。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!ready || busy || amountsHidden || connectionChanged || !question.trim()} onClick={prepare}>
            预览本次发送内容
          </Button>
          {busy && operation && (
            <Button variant="outline" onClick={() => { void cancelAI(operation.requestId); setBusy(false); setError('已取消，未保存 AI 回复。'); }}>
              取消请求
            </Button>
          )}
        </div>

        {operation && (
          <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-3" aria-label="ContextManifest">
            <h3 className="font-semibold">本次健康助手授权清单</h3>
            <p className="mt-1">
              目的地：{operation.providerId} / {operation.profileId} / {operation.modelId}<br />
              数据版本：{operation.pack.manifest.baseRevision} · 金额：不发送 · 事实：{operation.pack.facts.length} 条 · 历史对话：最多 {HEALTH_ASSISTANT_BOUNDED_CONTEXT} 条
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">查看完整字段、值与来源</summary>
              <p className="mt-2 whitespace-pre-wrap break-all text-xs">问题：{operation.question}</p>
              <dl className="mt-2 space-y-2 text-xs">
                {operation.pack.facts.map((fact) => (
                  <div key={fact.factId}>
                    <dt className="font-medium">{fact.label} · {fact.factId}</dt>
                    <dd className="break-all">{fact.value} {fact.unit}<br /><span className="text-slate-500">{fact.source}</span></dd>
                  </div>
                ))}
              </dl>
              {operation.conversation?.length ? (
                <div className="mt-2 rounded border border-blue-200 bg-white p-2 text-xs">
                  <div className="font-medium">将作为不可信对话上下文发送</div>
                  {operation.conversation.map((message, index) => <p key={index} className="mt-1 break-words">{message.role === 'user' ? '你' : 'AI'}：{message.text}</p>)}
                </div>
              ) : null}
            </details>
            <Button className="mt-3" disabled={busy} onClick={() => void send()}>{busy ? '正在请求…' : '授权发送这一次'}</Button>
          </section>
        )}

        {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-700">{error}</p>}
        {assistant.loadError && <p role="alert" className="text-red-700">本地会话读取失败：{assistant.loadError}</p>}

        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium">本地会话与完整备份设置</summary>
          <label className="mt-3 block">保留期
            <select
              className="mt-1 w-full rounded border border-slate-300 bg-white p-2"
              value={String(assistant.state.retention)}
              onChange={(event) => {
                const raw = event.target.value;
                const retention = (raw === 'forever' ? 'forever' : Number(raw)) as HealthAssistantRetention;
                void assistant.saveSettings(retention, assistant.state.includeInFullBackup).catch((cause) => setError(errorText(cause)));
              }}
            >
              {RETENTIONS.map((item) => <option key={String(item.value)} value={String(item.value)}>{item.label}</option>)}
            </select>
          </label>
          <label className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={assistant.state.includeInFullBackup}
              onChange={(event) => void assistant.saveSettings(assistant.state.retention, event.target.checked).catch((cause) => setError(errorText(cause)))}
            />
            <span>在完整备份中包含健康助手会话（默认关闭）</span>
          </label>
          <p className="mt-2 text-xs text-slate-500">会话独立于财务数据，不增加财务 revision。删除或到期不会修改渠道、历史、报告或健康处理记录。</p>
        </details>
      </div>
    </Modal>
  );
}
