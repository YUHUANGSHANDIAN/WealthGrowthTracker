export const WORKSPACE_STATE_SCHEMA_VERSION = 1 as const;

export interface MetricContext {
  basis: string;
  asOf?: string;
  source?: string;
  status: 'confirmed' | 'pending' | 'stale' | 'assumption' | 'unknown';
  revision?: number | string;
  scope?: string;
}

export interface ChangeImpact {
  kind: 'financial' | 'metadata' | 'derived' | 'external';
  label: string;
  description: string;
  affectedIds?: string[];
}

/** A side-effect-free preview rebuilt and checked again before any write. */
export interface ChangePreview<T> {
  operationId: string;
  baseRevision: number;
  baseFingerprint: string;
  before: T;
  after: T;
  changedFields: string[];
  impacts: ChangeImpact[];
  blockers: string[];
}

export interface LedgerIdentityState {
  schemaVersion: 1;
  ledgerId: string;
  createdAt: string;
}

export type WorkspaceDraftKind =
  | 'finance-task'
  | 'finance-policy'
  | 'finance-comparison'
  | 'report-edit'
  | 'goal-scenario'
  | 'history-edit';

export interface WorkspaceDraft {
  draftId: string;
  kind: WorkspaceDraftKind;
  targetId: string;
  ledgerId: string;
  baseRevision: number;
  /** Revision of the concrete source object when one exists (task/report revision). */
  baseEntityRevision: number;
  baseFingerprint: string;
  payloadVersion: number;
  updatedAt: string;
  payload: Record<string, unknown>;
}

export interface WorkspaceDraftState {
  schemaVersion: 1;
  drafts: WorkspaceDraft[];
}

export type HealthReviewStatus = 'acknowledged' | 'deferred' | 'resolved';
export type HealthResolution =
  | 'distinct-identity'
  | 'evidence-accepted'
  | 'data-corrected'
  | 'not-applicable';

export interface HealthReviewRecord {
  id: string;
  issueId: string;
  ledgerId: string;
  code: string;
  ruleVersion: number;
  status: HealthReviewStatus;
  reason: string;
  resolution?: HealthResolution;
  baseRevision: number;
  fingerprint: string;
  actorKind: 'user';
  sourceEventIds: string[];
  operationId: string;
  reviewAfter?: string;
  revalidatedAt?: string;
  updatedAt: string;
}

export interface HealthReviewState {
  schemaVersion: 1;
  records: HealthReviewRecord[];
}

export interface ReportRevisionRecord {
  id: string;
  reportId: string;
  revision: number;
  action: 'generated' | 'edited' | 'metadata' | 'archived' | 'deleted' | 'imported' | 'repaired';
  capturedAt: string;
  baseDataRevision: number;
  contentHash: string;
  snapshot: Record<string, unknown>;
}

export interface ReportRevisionState {
  schemaVersion: 1;
  revisions: ReportRevisionRecord[];
}

export interface GoalScenarioRecord {
  id: string;
  goalId: string;
  name: string;
  months: number;
  monthlyContribution: number | null;
  annualRate: number | null;
  basis: 'all-assets' | 'all-net-assets' | 'investable-assets' | 'investable-net-assets';
  baselineDate: string;
  baselineAmount: number | null;
  baselineFingerprint?: string;
  baseDataRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface GoalScenarioState {
  schemaVersion: 1;
  scenarios: GoalScenarioRecord[];
  comparisonIds: string[];
}

export interface NamedView {
  id: string;
  page: 'overview' | 'assets' | 'history' | 'reports' | 'analysis' | 'monthly' | 'prediction' | 'goals' | 'lottery' | 'data';
  name: string;
  filters: Record<string, string | boolean | number | null>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceViewState {
  schemaVersion: 1;
  namedViews: NamedView[];
  overviewHiddenModules: string[];
}

export interface WorkspaceStateBundle {
  ledgerIdentity: LedgerIdentityState;
  drafts: WorkspaceDraftState;
  healthReviews: HealthReviewState;
  reportRevisions: ReportRevisionState;
  goalScenarios: GoalScenarioState;
  views: WorkspaceViewState;
}
