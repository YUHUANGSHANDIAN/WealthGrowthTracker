/**
 * 月度理财域数据契约。金额一律「元 + number」，份额/净值/费率用十进制字符串。
 * 五轴状态必须分开表达：来源 / 归属质量 / 估值质量 / 时间状态 / 审核状态。
 */

/** 事实来源 */
export type FactSource = 'evidence' | 'user-confirmed' | 'computed' | 'legacy-ai';
/** 归属质量 */
export type AttributionQuality = 'confirmed' | 'conditional' | 'unassigned';
/** 估值质量 */
export type ValuationQuality = 'observed' | 'rule-estimated' | 'missing';
/** 时间状态 */
export type TimeState = 'observed' | 'pending-settlement' | 'settled' | 'unknown-date';
/** 审核状态 */
export type ReviewStatus = 'pending' | 'passed' | 'conflict';

export interface Quality {
  source: FactSource;
  attribution: AttributionQuality;
  valuation: ValuationQuality;
  time: TimeState;
  review: ReviewStatus;
}

export type Platform = 'wechat' | 'alipay' | 'jd' | 'manual' | 'other';

/** 原始证据（文件） */
export interface SourceDocument {
  id: string;
  /** 私有相对路径（相对数据根），不写绝对路径 */
  relativePath: string;
  sha256: string;
  originalName: string;
  mime: string;
  platform: Platform;
  /** 该文件声明的数据日期（可为空） */
  declaredDate?: string;
  importedAt: string;
  /** 覆盖范围声明，例如“全部持有”“仅直接基金” */
  scopeNote?: string;
  integrity: 'ok' | 'missing' | 'hash-mismatch';
  parseState: 'pending' | 'parsed' | 'failed' | 'manual';
}

/** 可定位引用：页/表/行/单元格或图像区域 */
export interface EvidenceRef {
  sourceId: string;
  /** 结构定位 */
  tableIndex?: number;
  rowIndex?: number;
  cellIndex?: number;
  /** 图像定位（原图像素坐标） */
  imageBox?: { x: number; y: number; width: number; height: number };
  excerpt?: string;
  extractor: string;
  extractorVersion: string;
}

/** 单字段观察：rawValue 与规范化值分开，未知不是 0 */
export interface FieldObservation<T = string> {
  id: string;
  field: string;
  rawValue: string;
  value: T | null;
  unit?: string;
  observedDate?: string;
  evidence: EvidenceRef[];
  quality: Quality;
  issues: string[];
}

export interface Holding {
  id: string;
  /** 平台/账户/通道 */
  platform: Platform;
  accountId?: string;
  /** 主应用渠道 ID（权威），legacyId 仅作映射 */
  parentChannelId: string;
  childChannelId?: string;
  planId?: string;
  fundCode?: string;
  shareClass?: string;
  originalName: string;
  standardName?: string;
  currency: string;
  productType: 'fund' | 'gold' | 'cash-management' | 'plan' | 'other';
  /** 经济暴露标签（可重叠，不与渠道混用） */
  exposureTags: string[];
  legacyId?: string;
}

export interface HoldingObservation {
  id: string;
  holdingId: string;
  sessionKey: string;
  /** 份额 / 市值 / 净值 / 净值日期 */
  shares: string | null;
  marketValue: number | null;
  nav: string | null;
  navDate?: string;
  cost?: number | null;
  profit?: number | null;
  profitBasis?: string;
  evidence: EvidenceRef[];
  quality: Quality;
}

export interface ProductGroupPlan {
  id: string;
  aliases: string[];
  channelId: string;
  state: 'active' | 'closed' | 'pending-registration';
  executionUnit: 'plan' | 'holding';
  /** 计划总额（内部），与底层穿透关系分开 */
  planTotal: number | null;
  penetratedTotal: number | null;
  unpenetratedTotal: number | null;
  quality: Quality;
}

export type CashFlowKind =
  | 'external-income'
  | 'external-out'
  | 'internal-transfer'
  | 'investment-buy'
  | 'investment-sell'
  | 'credit-spend'
  | 'debt-repayment'
  | 'refund'
  | 'interest'
  | 'fee'
  | 'pending-buy'
  | 'pending-sell'
  | 'lottery-out';

export interface CashFlowEvent {
  id: string;
  kind: CashFlowKind;
  date: string;
  amount: number;
  /** 该事件所属核算范围 */
  scope: 'all' | 'investable' | 'restricted';
  fromChannelId?: string;
  toChannelId?: string;
  relatedEventId?: string;
  /** 在途事件：来源是否已包含该金额 */
  alreadyIncludedInBalance?: boolean;
  evidence: EvidenceRef[];
  quality: Quality;
  note?: string;
}

export interface Liability {
  id: string;
  name: string;
  amount: number | null;
  dueDate?: string;
  settled: boolean;
  evidence: EvidenceRef[];
  quality: Quality;
}

export interface AssignmentRule {
  id: string;
  version: number;
  effectiveFrom: string;
  effectiveTo?: string;
  priority: number;
  match: { field: 'name' | 'fundCode' | 'planAlias' | 'accountId'; operator: 'equals' | 'prefix' | 'suffix' | 'contains'; value: string };
  target: { kind: 'channel' | 'plan'; id: string };
  scopeNote?: string;
  approvedByUser: boolean;
  enabled: boolean;
}

export interface RiskLimit {
  /** 暴露标签或维度名（equity/theme/manager/region/duration…） */
  key: string;
  softLimit: number | null;
  hardLimit: number | null;
  buffer: number | null;
  consecutiveBreachesAllowed: number | null;
}

export interface TakeProfitStep {
  /** 从第几个累计目标开始（参考份额的百分比，0–1 内部表示） */
  cumulativeTarget: number;
  label: string;
}

export interface InvestmentPolicy {
  id: string;
  version: number;
  effectiveFrom: string;
  approvedByUser: boolean;
  /** 目标配比（0–1），键与暴露标签一致 */
  targetAllocation: Record<string, number>;
  riskLimits: RiskLimit[];
  liquidityFloor: number | null;
  minTradeAmount: number | null;
  minTradeShares: string | null;
  cooldownDays: number | null;
  feeRate: number | null;
  takeProfit: {
    /** 参考份额（十进制字符串），累计止盈的分母 */
    referenceShares: string | null;
    steps: TakeProfitStep[];
    /** 已实际执行的累计比例（0–1），只有执行回执才会增加 */
    executedCumulative: number;
  } | null;
  /** true = 只能以计划为单位交易 */
  planLevelExecution: boolean;
  notes?: string;
}

export interface ResearchEvidence {
  id: string;
  sourceUrl: string;
  publisher: string;
  publishedDate?: string;
  effectiveDate?: string;
  retrievedAt: string;
  excerpt: string;
  appliesTo: string[];
  expiryPolicy: 'review-on-change' | 'dated' | 'manual';
  quality: Quality;
}

export interface ProposedAction {
  id: string;
  kind: 'buy' | 'sell' | 'hold' | 'rebalance' | 'take-profit' | 'cash-hold';
  holdingId?: string;
  planId?: string;
  amount: number | null;
  shares: string | null;
  triggers: string[];
  evidence: EvidenceRef[];
  fundingSource?: string;
  rationale: string;
  constraintsApplied: string[];
  residuals: string[];
  validUntil?: string;
  blockers: string[];
}

export interface Proposal {
  id: string;
  sessionKey: string;
  policyVersion: number;
  createdAt: string;
  actions: ProposedAction[];
  /** 无可行解时列出冲突约束 */
  conflicts: string[];
  dataStatus: 'green' | 'red';
  riskStatus: 'green' | 'amber' | 'red';
  summary: string;
}

export interface ExecutionRecord {
  id: string;
  proposalId: string;
  actionId: string;
  status:
    | 'submitted'
    | 'accepted'
    | 'deferred'
    | 'rejected'
    | 'executed'
    | 'partially-executed'
    | 'cancelled'
    | 'not-needed';
  executedAt?: string;
  actualAmount?: number | null;
  actualShares?: string | null;
  note?: string;
  evidence: EvidenceRef[];
}

export interface GoalBasis {
  goalId: string | null;
  targetAmount: number;
  basis: 'all-assets' | 'all-net-assets' | 'investable-assets' | 'investable-net-assets';
  baselineDate: string;
  monthlyContribution: number | null;
  targetDate?: string;
  scenarios: Array<{ id: string; label: string; annualRate: number | null }>;
  quality: Quality;
}

export type MonthlyReviewState =
  | 'draft'
  | 'extracting'
  | 'reviewing'
  | 'ready'
  | 'planned'
  | 'confirmed'
  | 'reviewed'
  | 'archived'
  | 'blocked'
  | 'cancelled';

/** Public name for the shared financial-task state machine. */
export type FinanceTaskStage = MonthlyReviewState;

export type FinanceTaskKind =
  | 'initial-reconciliation'
  | 'monthly-review'
  | 'ad-hoc-rebalance'
  | 'fund-analysis'
  | 'take-profit-review'
  | 'market-intelligence'
  | 'special-research';

export interface FinanceTaskResult {
  summary: string;
  findings: string[];
  noAction: boolean;
  confirmedAt?: string;
  approvedPolicyVersion?: number | null;
}

export interface FinanceTaskRevision {
  /** 稳定修订标识，由任务、版本和快照内容哈希共同确定。 */
  revisionId: string;
  /** 规范化任务快照的 SHA-256；用于验证不可变修订未被静默改写。 */
  contentHash: string;
  taskId: string;
  revision: number;
  state: MonthlyReviewState;
  capturedAt: string;
  baseDataRevision: number | null;
  policyVersion: number | null;
  snapshot: MonthlyReview;
}

export interface EvidenceIndexReference {
  taskId: string;
  documentId: string;
}

/** 跨任务证据去重索引；同一 SHA-256 只保留一个条目和全部引用。 */
export interface EvidenceIndexEntry {
  sha256: string;
  relativePath: string;
  originalName: string;
  mime: string;
  references: EvidenceIndexReference[];
}

export interface MonthlyReview {
  /** 稳定任务 ID；正式月任务沿用 monthly-planning:YYYY-MM 键。 */
  taskId?: string;
  /** 当前应用只有一个权威账本，保留稳定标识以便未来显式多账本迁移。 */
  ledgerId?: string;
  /** 旧数据迁移时缺省为月度复盘。 */
  taskKind?: FinanceTaskKind;
  /** 临时任务可以关联一份正式月记录，但不得覆盖它。 */
  linkedMonthlyTaskId?: string | null;
  /** 用户可编辑的任务名称。 */
  title?: string;
  /** 唯一键：monthly-planning:YYYY-MM */
  key: string;
  revision: number;
  state: MonthlyReviewState;
  planningMonth: string;
  reviewPeriodStart: string;
  reviewPeriodEnd: string;
  snapshotAsOf: string;
  /** 事实实际观察/估值时点；旧会话缺省时使用 snapshotAsOf。 */
  valuationAsOf?: string;
  /** 用户要求完成本任务的截止时点。 */
  deadlineAt?: string;
  generatedAt: string;
  timezone: string;
  /** 会话固定使用的策略版本 */
  policyId: string | null;
  policyVersion: number | null;
  /** 确认时记录的主应用数据版本 */
  baseDataRevision: number | null;
  documents: SourceDocument[];
  holdings: Holding[];
  observations: HoldingObservation[];
  plans: ProductGroupPlan[];
  cashFlows: CashFlowEvent[];
  liabilities: Liability[];
  research: ResearchEvidence[];
  proposal: Proposal | null;
  executions: ExecutionRecord[];
  goalBasis: GoalBasis | null;
  result?: FinanceTaskResult | null;
  note?: string;
}

/** 通用名称；旧代码可继续使用 MonthlyReview。 */
export type FinanceTask = MonthlyReview;

export interface MonthlyPlanningState {
  schemaVersion: 2;
  sessions: MonthlyReview[];
  taskRevisions: FinanceTaskRevision[];
  evidenceIndex: EvidenceIndexEntry[];
  policies: InvestmentPolicy[];
  assignmentRules: AssignmentRule[];
  settings: {
    reminderEnabled: boolean;
    reminderDay: number;
    reminderTime: string;
    timezone: string;
    osTaskRegistered: boolean;
    /** 最近一次已提示的 YYYY-MM；用于下次启动补提醒而不重复打扰。 */
    lastReminderMonth?: string | null;
  };
}
