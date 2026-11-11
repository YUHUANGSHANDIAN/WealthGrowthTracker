import type { ProviderId } from '../../services/ai/client';
import type { HealthDomain } from '../../utils/dataHealth';
import {
  HEALTH_ASSISTANT_SCHEMA_VERSION,
  type HealthAssistantAuthorization,
  type HealthAssistantConversation,
  type HealthAssistantMessage,
  type HealthAssistantProposal,
  type HealthAssistantRetention,
  type HealthAssistantState,
} from './types';

export const HEALTH_ASSISTANT_STORAGE_KEY = 'health_assistant_state';
export const HEALTH_ASSISTANT_MAX_CONVERSATIONS = 50;
export const HEALTH_ASSISTANT_MAX_MESSAGES = 80;
export const HEALTH_ASSISTANT_BOUNDED_CONTEXT = 6;

const PROVIDERS = new Set<ProviderId>(['openai', 'copilot', 'anthropic', 'deepseek', 'ollama', 'lmstudio', 'gateway']);
const DOMAINS = new Set<HealthDomain>(['assets', 'history', 'reports', 'goals', 'levels', 'lottery', 'storage', 'settings', 'monthly', 'classification']);
const RETENTIONS = new Set<HealthAssistantRetention>([7, 30, 90, 365, 'forever']);
const ACTIONS = new Set(['sanitize-amounts', 'remove-orphans', 'dedupe-history', 'navigate-issue']);
const FORBIDDEN_KEY = /^(?:api.?key|token|access.?token|refresh.?token|secret|authorization.?header|password|credential|credentials)$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function assertNoSecretFields(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`健康助手会话不能保存敏感字段：${key}`);
    assertNoSecretFields(child);
  }
}

function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw new Error(`${field}无效`);
  return value;
}

function date(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${field}无效`);
  return new Date(value).toISOString();
}

function nullableText(value: unknown, field: string, max: number): string | null {
  if (value === null) return null;
  return text(value, field, max);
}

function parseProposal(value: unknown): HealthAssistantProposal | undefined {
  if (value === undefined) return undefined;
  if (!record(value)
    || !['navigate', 'preview-existing-action'].includes(String(value.operation))
    || !ACTIONS.has(String(value.actionId))
    || (value.issueId !== null && typeof value.issueId !== 'string')
    || !['low', 'medium', 'high'].includes(String(value.confidence))
    || !Array.isArray(value.warnings)) {
    throw new Error('健康助手建议结构无效');
  }
  const warnings = value.warnings.map((item) => text(item, '建议警告', 500));
  if (warnings.length > 8) throw new Error('健康助手建议警告过多');
  if (value.operation === 'navigate' && value.actionId !== 'navigate-issue') throw new Error('导航建议动作无效');
  if (value.operation === 'preview-existing-action' && value.actionId === 'navigate-issue') throw new Error('修复建议动作无效');
  return {
    operation: value.operation as HealthAssistantProposal['operation'],
    actionId: value.actionId as HealthAssistantProposal['actionId'],
    issueId: value.issueId === null ? null : text(value.issueId, '建议问题', 500),
    rationale: text(value.rationale, '建议理由', 2_000),
    warnings,
    confidence: value.confidence as HealthAssistantProposal['confidence'],
  };
}

function parseMessage(value: unknown): HealthAssistantMessage {
  if (!record(value) || !['user', 'assistant'].includes(String(value.role))) throw new Error('健康助手消息无效');
  const citations = value.citations === undefined ? undefined : (() => {
    if (!Array.isArray(value.citations) || value.citations.length > 12) throw new Error('健康助手引用无效');
    return value.citations.map((item) => {
      if (!record(item) || !Array.isArray(item.factIds) || item.factIds.length > 12) throw new Error('健康助手引用无效');
      return {
        text: text(item.text, '引用说明', 2_000),
        factIds: item.factIds.map((id) => text(id, '引用事实', 128)),
      };
    });
  })();
  const limitations = value.limitations === undefined ? undefined : (() => {
    if (!Array.isArray(value.limitations) || value.limitations.length > 12) throw new Error('健康助手限制说明无效');
    return value.limitations.map((item) => text(item, '限制说明', 1_000));
  })();
  return {
    id: text(value.id, '消息标识', 160),
    role: value.role as HealthAssistantMessage['role'],
    text: text(value.text, '消息内容', 8_000),
    createdAt: date(value.createdAt, '消息时间'),
    ...(citations ? { citations } : {}),
    ...(limitations ? { limitations } : {}),
    ...(value.proposal !== undefined ? { proposal: parseProposal(value.proposal) } : {}),
  };
}

function parseAuthorization(value: unknown): HealthAssistantAuthorization {
  if (!record(value) || typeof value.includeEvidence !== 'boolean' || value.includeAmounts !== false) {
    throw new Error('健康助手授权记录无效');
  }
  return {
    issueId: nullableText(value.issueId, '授权问题', 500),
    issueFingerprint: nullableText(value.issueFingerprint, '授权问题指纹', 128),
    domain: value.domain === null ? null : (() => {
      if (typeof value.domain !== 'string' || !DOMAINS.has(value.domain as HealthDomain)) throw new Error('授权问题域无效');
      return value.domain as HealthDomain;
    })(),
    includeEvidence: value.includeEvidence,
    includeAmounts: false,
  };
}

function parseConversation(value: unknown): HealthAssistantConversation {
  if (!record(value) || value.schemaVersion !== 1 || value.task !== 'data-health-assistant'
    || typeof value.providerId !== 'string' || !PROVIDERS.has(value.providerId as ProviderId)
    || !Array.isArray(value.messages)) {
    throw new Error('健康助手会话无效');
  }
  const messages = value.messages.map(parseMessage);
  if (!messages.length || messages.length > HEALTH_ASSISTANT_MAX_MESSAGES) throw new Error('健康助手消息数量无效');
  return {
    schemaVersion: 1,
    id: text(value.id, '会话标识', 160),
    ledgerId: text(value.ledgerId, '会话账本身份', 160),
    issueId: nullableText(value.issueId, '会话问题', 500),
    issueFingerprint: nullableText(value.issueFingerprint, '会话问题指纹', 128),
    task: 'data-health-assistant',
    providerId: value.providerId as ProviderId,
    profileId: text(value.profileId, '会话连接', 128),
    modelId: text(value.modelId, '会话模型', 128),
    authorization: parseAuthorization(value.authorization),
    baseRevision: (() => {
      if (typeof value.baseRevision !== 'number' || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0) {
        throw new Error('会话数据版本无效');
      }
      return value.baseRevision;
    })(),
    messages,
    createdAt: date(value.createdAt, '会话创建时间'),
    updatedAt: date(value.updatedAt, '会话更新时间'),
  };
}

export function emptyHealthAssistantState(): HealthAssistantState {
  return {
    schemaVersion: HEALTH_ASSISTANT_SCHEMA_VERSION,
    retention: 30,
    includeInFullBackup: false,
    conversations: [],
  };
}

export function parseHealthAssistantState(value: unknown): HealthAssistantState {
  if (value === null || value === undefined) return emptyHealthAssistantState();
  assertNoSecretFields(value);
  if (!record(value) || value.schemaVersion !== 1) throw new Error('健康助手存储版本无效或来自更新版本');
  if (!RETENTIONS.has(value.retention as HealthAssistantRetention) || typeof value.includeInFullBackup !== 'boolean'
    || !Array.isArray(value.conversations)) {
    throw new Error('健康助手设置无效');
  }
  const ids = new Set<string>();
  const conversations = value.conversations.slice(0, HEALTH_ASSISTANT_MAX_CONVERSATIONS).map(parseConversation);
  for (const conversation of conversations) {
    if (ids.has(conversation.id)) throw new Error('健康助手会话重复');
    ids.add(conversation.id);
  }
  return {
    schemaVersion: 1,
    retention: value.retention as HealthAssistantRetention,
    includeInFullBackup: value.includeInFullBackup,
    conversations: conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

export function pruneHealthAssistantState(
  state: HealthAssistantState,
  now = new Date(),
): HealthAssistantState {
  const cutoff = state.retention === 'forever' ? null : now.getTime() - state.retention * 86_400_000;
  return {
    ...state,
    conversations: state.conversations
      .filter((conversation) => cutoff === null || Date.parse(conversation.updatedAt) >= cutoff)
      .slice(0, HEALTH_ASSISTANT_MAX_CONVERSATIONS),
  };
}

export function upsertHealthConversation(
  state: HealthAssistantState,
  conversation: HealthAssistantConversation,
): HealthAssistantState {
  const parsed = parseConversation(conversation);
  return {
    ...state,
    conversations: [parsed, ...state.conversations.filter((item) => item.id !== parsed.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, HEALTH_ASSISTANT_MAX_CONVERSATIONS),
  };
}
