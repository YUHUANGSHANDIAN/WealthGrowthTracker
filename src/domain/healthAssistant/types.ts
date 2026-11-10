import type { AITask, ProviderId } from '../../services/ai/client';
import type { HealthDomain } from '../../utils/dataHealth';

export const HEALTH_ASSISTANT_SCHEMA_VERSION = 1 as const;
export type HealthAssistantRetention = 7 | 30 | 90 | 365 | 'forever';
export type HealthProposalAction =
  | 'sanitize-amounts'
  | 'remove-orphans'
  | 'dedupe-history'
  | 'navigate-issue';

export interface HealthCitation {
  text: string;
  factIds: string[];
}

export interface HealthAssistantProposal {
  operation: 'navigate' | 'preview-existing-action';
  actionId: HealthProposalAction;
  issueId: string | null;
  rationale: string;
  warnings: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface HealthAssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  citations?: HealthCitation[];
  limitations?: string[];
  proposal?: HealthAssistantProposal;
}

export interface HealthAssistantAuthorization {
  issueId: string | null;
  issueFingerprint: string | null;
  domain: HealthDomain | null;
  includeEvidence: boolean;
  includeAmounts: false;
}

export interface HealthAssistantConversation {
  schemaVersion: 1;
  id: string;
  ledgerId: string;
  issueId: string | null;
  issueFingerprint: string | null;
  task: Extract<AITask, 'data-health-assistant'>;
  providerId: ProviderId;
  profileId: string;
  modelId: string;
  authorization: HealthAssistantAuthorization;
  baseRevision: number;
  messages: HealthAssistantMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface HealthAssistantState {
  schemaVersion: 1;
  retention: HealthAssistantRetention;
  includeInFullBackup: boolean;
  conversations: HealthAssistantConversation[];
}
