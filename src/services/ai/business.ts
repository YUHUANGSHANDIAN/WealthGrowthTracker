import { useAppStore } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAIConnectionStore, type AIConnection } from '../../store/aiConnectionStore';
import { assertFactPackCurrent, buildFactPack, type ContextSelection, type FactPack } from './context';
import { inferAI, type AITask, type InferenceResult } from './client';
import type { AmountBatchProposal } from '../../features/assets/amountBatch';
import { isDateString, todayString } from '../../utils/date';
import type {
  HealthAssistantProposal,
  HealthCitation,
} from '../../domain/healthAssistant/types';

export interface Explanation { summary: string; observations: Array<{ text: string; factIds: string[] }>; limitations: string[] }
export interface AuthorizedOperation {
  requestId: string;
  task: AITask;
  pack: FactPack;
  profileId: string;
  providerId: AIConnection['providerId'];
  modelId: string;
  configRevision: number;
  question: string;
  conversation?: Array<{ role: 'user' | 'assistant'; text: string }>;
}
export interface HealthAssistantReply {
  message: string;
  citations: HealthCitation[];
  limitations: string[];
  proposal?: HealthAssistantProposal;
}
export interface ChangeProposal {
  kind: 'amount-batch';
  requiresConfirmation: true;
  baseRevision: number;
  evidence: string[];
  warnings: string[];
  proposal: AmountBatchProposal;
}
const operations = new WeakMap<AuthorizedOperation, string>();
const changes = new WeakMap<ChangeProposal, { operation: AuthorizedOperation; content: string }>();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.prototype.hasOwnProperty.call(v, k)) && Object.keys(v).every(k => [...required, ...optional].includes(k));
const string = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const strings = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every(i => string(i, 1_000));

function profileCurrent(operation: AuthorizedOperation): void {
  const state = useAIConnectionStore.getState();
  const profile = state.profiles.find(p => p.profileId === operation.profileId);
  if (!state.enabled || !profile?.enabled || !['configured', 'tested'].includes(profile.state)
    || profile.modelId !== operation.modelId || profile.providerId !== operation.providerId) throw new Error('连接或模型已变化，请重新授权');
  if (useWorkspaceStore.getState().amountsHidden) throw new Error('金额隐私已开启，请关闭后重新选择上下文');
}

export function prepareAIOperation(
  task: AITask,
  selection: ContextSelection,
  question: string,
  conversation?: AuthorizedOperation['conversation'],
): AuthorizedOperation {
  const state = useAIConnectionStore.getState();
  const profile = state.profiles.find(p => p.profileId === state.activeProfileId);
  if (!state.enabled || !profile?.enabled || !['configured', 'tested'].includes(profile.state)) throw new Error('请先在连接中心配置可用连接');
  if (!question.trim() || question.length > 4_000) throw new Error('请输入问题，长度不超过 4000 字');
  if (conversation !== undefined && (task !== 'data-health-assistant' || !Array.isArray(conversation)
    || conversation.length > 6 || conversation.some((message) => !['user', 'assistant'].includes(message.role)
      || !message.text.trim() || message.text.length > 2_000))) {
    throw new Error('多轮会话上下文无效或超过最近 6 条限制');
  }
  const operation: AuthorizedOperation = { requestId: crypto.randomUUID(), task, pack: buildFactPack(selection),
    profileId: profile.profileId, providerId: profile.providerId, modelId: profile.modelId, configRevision: profile.configRevision,
    question: question.trim(), ...(conversation?.length ? { conversation: conversation.map((message) => ({ ...message })) } : {}) };
  profileCurrent(operation);
  operations.set(operation, JSON.stringify(operation));
  return operation;
}

export function assertAIOperationCurrent(operation: AuthorizedOperation): void {
  if (operations.get(operation) !== JSON.stringify(operation)) throw new Error('授权预览已被修改，请重新准备');
  profileCurrent(operation); assertFactPackCurrent(operation.pack);
}

export async function runAuthorizedAI(operation: AuthorizedOperation): Promise<InferenceResult> {
  assertAIOperationCurrent(operation);
  const shape = operation.task === 'entry-draft'
    ? '仅返回 JSON：{"date":"YYYY-MM-DD","changes":[{"parentId":"已授权ID","childId":"可选已授权子ID","amount":非负数字}],"warnings":["歧义说明"]}。金额表示更新后的余额，不是收入/支出。无法确定的渠道不生成变更。'
    : operation.task === 'data-health-assistant'
      ? '仅返回 JSON：{"message":"面向用户的解释","citations":[{"text":"结论","factIds":["已提供事实ID"]}],"limitations":["限制"],"proposal":{"operation":"navigate|preview-existing-action","actionId":"navigate-issue|sanitize-amounts|remove-orphans|dedupe-history","issueId":"当前问题ID或null","rationale":"建议理由","warnings":["影响"],"confidence":"low|medium|high"}}。proposal 可省略。不得生成任意命令、SQL、脚本、文件路径或账本写入；只能使用已授权的白名单动作。'
    : '仅返回 JSON：{"summary":"简短概述","observations":[{"text":"解释","factIds":["已提供的factId"]}],"limitations":["覆盖限制"]}。每条观察至少引用一条提供的事实，不得伪造数值或引用。';
  const result = await inferAI({ requestId: operation.requestId, task: operation.task, profileId: operation.profileId, providerId: operation.providerId,
    configRevision: operation.configRevision, dataRevision: operation.pack.manifest.baseRevision,
    input: { text: `${shape}\n业务日期：${todayString()}\n用户问题：${operation.question}`,
      facts: operation.pack.facts.map(({ factId, label, value, unit, asOf }) => ({ factId, label, value, unit, ...(asOf ? { asOf } : {}) })),
      ...(operation.conversation?.length ? { conversation: operation.conversation.map((message) => ({ ...message })) } : {}) } });
  if (operations.get(operation) !== JSON.stringify(operation)) throw new Error('授权请求已被修改，请重新准备');
  assertFactPackCurrent(operation.pack);
  const state = useAIConnectionStore.getState();
  const owner = state.profiles.find((profile) => profile.profileId === operation.profileId);
  if (!state.enabled || !owner?.enabled) throw new Error('原连接已停用，迟到结果未保存');
  if (result.providerId !== operation.providerId || result.modelId !== operation.modelId) throw new Error('响应提供商或模型与授权不一致');
  return result;
}

function parse(text: string): Record<string, unknown> {
  if (text.length > 32_000) throw new Error('AI 结果超过限制');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('模型没有返回完整 JSON，请重试'); }
  if (!record(value)) throw new Error('AI 结果结构无效');
  return value;
}

export function validateExplanation(text: string, pack: FactPack): Explanation {
  assertFactPackCurrent(pack);
  return validateExplanationContent(text, new Set(pack.facts.map(f => f.factId)));
}

export function validateExplanationContent(text: string, ids: ReadonlySet<string>): Explanation {
  const value = parse(text);
  if (!exact(value, ['summary', 'observations', 'limitations']) || !string(value.summary, 2_000) || !Array.isArray(value.observations)
    || value.observations.length > 12 || !strings(value.limitations, 12)) throw new Error('AI 解读结构无效');
  for (const item of value.observations) {
    if (!record(item) || !exact(item, ['text', 'factIds']) || !string(item.text, 2_000) || !strings(item.factIds, 12)
      || (item.factIds as string[]).length === 0 || !(item.factIds as string[]).every(id => ids.has(id))) throw new Error('AI 解读引用了未授权或不存在的事实');
  }
  return value as unknown as Explanation;
}

export function validateHealthAssistantReply(text: string, pack: FactPack, operation?: AuthorizedOperation): HealthAssistantReply {
  assertFactPackCurrent(pack);
  if (operation) {
    if (operation.task !== 'data-health-assistant' || operation.pack !== pack) {
      throw new Error('当前任务不允许健康助手回复');
    }
    assertAIOperationCurrent(operation);
  }
  const value = parse(text);
  if (!exact(value, ['message', 'citations', 'limitations'], ['proposal'])
    || !string(value.message, 8_000) || !Array.isArray(value.citations) || value.citations.length < 1 || value.citations.length > 12
    || !strings(value.limitations, 12)) {
    throw new Error('健康助手回复结构无效');
  }
  const authorizedFacts = new Set(pack.facts.map((fact) => fact.factId));
  const issueFact = pack.facts.find((fact) => fact.factId === 'health.issue.fingerprint');
  const issueIdFact = pack.facts.find((fact) => fact.factId === 'health.issue.title');
  const issueSelection = pack.manifest.healthIssueId;
  const citations: HealthCitation[] = value.citations.map((item) => {
    if (!record(item) || !exact(item, ['text', 'factIds']) || !string(item.text, 2_000)
      || !Array.isArray(item.factIds) || item.factIds.length === 0 || item.factIds.length > 12
      || !(item.factIds as unknown[]).every((id) => typeof id === 'string' && authorizedFacts.has(id))) {
      throw new Error('健康助手回复引用了未授权或不存在的事实');
    }
    return { text: item.text, factIds: item.factIds as string[] };
  });
  let proposal: HealthAssistantProposal | undefined;
  if (value.proposal !== undefined) {
    if (!record(value.proposal) || !exact(value.proposal,
      ['operation', 'actionId', 'issueId', 'rationale', 'warnings', 'confidence'])) {
      throw new Error('健康助手建议结构无效');
    }
    const proposalValue = value.proposal;
    if (!['navigate', 'preview-existing-action'].includes(String(proposalValue.operation))
      || !['navigate-issue', 'sanitize-amounts', 'remove-orphans', 'dedupe-history'].includes(String(proposalValue.actionId))
      || !string(proposalValue.rationale, 2_000) || !strings(proposalValue.warnings, 8)
      || !['low', 'medium', 'high'].includes(String(proposalValue.confidence))) {
      throw new Error('健康助手建议包含未授权动作');
    }
    const requestedIssueId = proposalValue.issueId;
    if (requestedIssueId !== null && (typeof requestedIssueId !== 'string' || requestedIssueId !== issueSelection)) {
      throw new Error('健康助手建议绑定了未授权的问题');
    }
    const action = proposalValue.actionId as HealthAssistantProposal['actionId'];
    if (proposalValue.operation === 'navigate' && (action !== 'navigate-issue' || requestedIssueId !== issueSelection)) {
      throw new Error('健康助手导航建议无效');
    }
    if (proposalValue.operation === 'preview-existing-action') {
      if (!issueSelection || !issueFact || !issueIdFact || requestedIssueId !== issueSelection
        || !['sanitize-amounts', 'remove-orphans', 'dedupe-history'].includes(action)) {
        throw new Error('健康助手修复建议缺少精确问题授权');
      }
      const actionsFact = pack.facts.find((fact) => fact.factId === 'health.issue.actions');
      if (!actionsFact?.value.split(',').map((item) => item.trim()).includes(action)) {
        throw new Error('健康助手建议使用了当前问题未提供的动作');
      }
    }
    proposal = {
      operation: proposalValue.operation as HealthAssistantProposal['operation'],
      actionId: action,
      issueId: requestedIssueId as string | null,
      rationale: proposalValue.rationale,
      warnings: proposalValue.warnings as string[],
      confidence: proposalValue.confidence as HealthAssistantProposal['confidence'],
    };
  }
  return {
    message: value.message,
    citations,
    limitations: value.limitations as string[],
    ...(proposal ? { proposal } : {}),
  };
}

export function prepareAIChange(text: string, operation: AuthorizedOperation): ChangeProposal {
  assertAIOperationCurrent(operation);
  if (operation.task !== 'entry-draft') throw new Error('当前任务不允许生成录入提案');
  const value = parse(text);
  if (!exact(value, ['date', 'changes', 'warnings']) || !Array.isArray(value.changes) || value.changes.length === 0
    || value.changes.length > 40 || !strings(value.warnings, 12)) throw new Error('录入草稿的结构、变更或警告无效');
  if (typeof value.date !== 'string' || !isDateString(value.date) || value.date !== todayString()) throw new Error('余额录入仅更新今天；历史日期请在历史页单独编辑');
  const authorizedTargets = new Set(operation.pack.facts.filter(f => f.factId.startsWith('target.')).map(f => f.value));
  const input = value.changes.map(item => {
    if (!record(item) || !exact(item, ['parentId', 'amount'], ['childId']) || !string(item.parentId, 128)
      || (item.childId !== undefined && !string(item.childId, 128)) || typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0) throw new Error('录入草稿包含不允许的操作');
    const target = { parentId: item.parentId, ...(typeof item.childId === 'string' ? { childId: item.childId } : {}) };
    if (!authorizedTargets.has(JSON.stringify(target))) throw new Error('录入草稿使用了未授权渠道');
    return { ...target, amount: item.amount };
  });
  const proposal = useAppStore.getState().prepareAmountBatch(input, String(value.date));
  const result: ChangeProposal = { kind: 'amount-batch', requiresConfirmation: true, baseRevision: operation.pack.manifest.baseRevision,
    evidence: operation.pack.facts.filter(f => f.factId.startsWith('target.')).map(f => f.factId), warnings: value.warnings as string[], proposal };
  changes.set(result, { operation, content: JSON.stringify(result) });
  return result;
}

export async function confirmAIChange(change: ChangeProposal): Promise<void> {
  const issued = changes.get(change);
  if (!issued || issued.content !== JSON.stringify(change)) throw new Error('录入预览未经校验或已改变');
  assertAIOperationCurrent(issued.operation);
  await useAppStore.getState().confirmAmountBatch(change.proposal);
  changes.delete(change);
}
