import { validateLedgerShape, validateFinancialExtensions } from '../services/storage/validateLedger';
import {
  emptyMonthlyPlanningState, ensureTaskRevisionIntegrity, parseMonthlyPlanningState, recordExecution, removeSession,
  upsertPolicy, upsertSession,
} from '../services/monthlyPlanning/storage';
import { migrateInlineAttachments, migrateLegacyBase64AttachmentFiles } from '../services/monthlyPlanning/attachmentStore';
import {
  emptyAssetClassificationState,
  mergeAssetClassificationStates,
  parseAssetClassificationState,
  verifyAssetClassificationIntegrity,
  type AssetClassificationState,
} from '../domain/assets/classification';
import type { ExecutionRecord, InvestmentPolicy, MonthlyPlanningState, MonthlyReview } from '../domain/portfolio/types';
import { create } from 'zustand';
import type {
  AppearanceSettings,
  Channel,
  ChartSettings,
  CoinRainConfig,
  CountdownData,
  CountdownProgressPoint,
  CurrentWealthLevel,
  CustomSortRule,
  FinancialReport,
  GoalAchievementStatus,
  Goal,
  HistoryPoint,
  LevelAchievement,
  ReportType,
  SmartSortConfig,
  SortHistory,
  SubChannel,
  TimeRangeHistory,
  UserProfile,
  LocalAccount,
  LotteryState,
  LotteryTransaction,
  LotteryProject,
  ActivityLogEntry,
  HistorySource,
  ReportRepairAudit,
} from '../types';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { getLevelByAmount } from '../constants/levels';
import { APP_VERSION, STORAGE_VERSION_KEY } from '../constants/version';
import {
  defaultChannels,
  defaultChartSettings,
  defaultCoinRainConfig,
  defaultCountdownData,
  defaultHistory,
  defaultSortRules,
} from '../constants/defaults';
import {
  collapseParentToDirectAmount,
  makeChannel,
  makeSubChannel,
  normalizeChannelAmounts,
  promoteParentToChildren,
  removeChannel,
  setLeafAmount,
  toggleChannelExpanded,
  totalAssets,
  updateChannel,
  updateSubChannel,
  type FirstChildStrategy,
  type LastChildStrategy,
} from '../utils/channels';
import { round2 } from '../utils/money';
import { todayString } from '../utils/date';
import { prepareHistoryUpsert, overwriteHistoryPoint } from '../utils/history';
import { randomId, uuid } from '../utils/id';
import { prepareHistoryEdit as buildHistoryEdit, confirmHistoryEdit as checkHistoryEdit, type HistoryEditCommand, type HistoryEditProposal } from '../features/history/transaction';
import { storageService } from '../services/storage';
import {
  buildBackup,
  parseBackup,
  type BackupSource,
  type ImportedData,
} from '../services/export';
import { saveTextFile, backupFilename } from '../services/export/download';
import { toggleReportArchive } from '../features/reports/generate';
import { normalizeFinancialReport, periodKeyOf } from '../features/reports/normalize';
import { confirmReportProposal, prepareReportEdit, prepareReportGeneration, type ReportProposal, type ReportApproval } from '../features/reports/transaction';
import { runBackfill } from '../features/reports/backfill';
import { emptyProjectionQueue, enqueueReportProjection, parseProjectionQueue, writeReportProjection, type ReportProjectionQueue } from '../features/reports/projectionQueue';
import { migrateChannelsV12, migrateChannelsV15, migrateReportsV13, needsV12Migration, needsV15Migration } from '../services/migration';
import { DEFAULT_REPORT_SORT, type ReportSortSpec } from '../features/reports/reportSort';
import { detectCelebrations, type CelebrationEvent } from '../utils/celebrate';
import { DEFAULT_SMART_CONFIG } from '../utils/smartSort';
import { mergeData } from '../utils/mergeData';
import { checkDataHealth, applyHealthFixes } from '../utils/dataHealth';
import {
  assertHealthFixProposal,
  consumeHealthFixProposal,
  type HealthFixProposal,
} from '../features/data/issueFix';
import type { HealthScanInput } from '../utils/healthScan';
import { createAuthRecord, verifySecret, type AuthRecord } from '../utils/auth';
import {
  crossedLevelAchievements,
  deriveLevelAchievements,
  mergeLevelAchievements,
} from '../utils/levelAchievements';
import { countdownFromGoal, countdownToGoal } from '../utils/goals';
import { defaultLotteryState } from '../features/lottery/lotteryMath';
import {
  confirmAmountBatch as confirmAmountBatchProposal,
  prepareAmountBatch as buildAmountBatchProposal,
  type AmountBatchChange,
  type AmountBatchProposal,
} from '../features/assets/amountBatch';
import type {
  GoalScenarioRecord,
  GoalScenarioState,
  HealthReviewRecord,
  HealthReviewState,
  LedgerIdentityState,
  NamedView,
  ReportRevisionState,
  WorkspaceDraft,
  WorkspaceDraftState,
  WorkspaceViewState,
} from '../domain/workspace/types';
import {
  emptyGoalScenarioState,
  emptyHealthReviewState,
  emptyReportRevisionState,
  emptyWorkspaceDraftState,
  emptyWorkspaceViewState,
  parseGoalScenarioState,
  parseHealthReviewState,
  parseLedgerIdentity,
  parseReportRevisionState,
  parseWorkspaceDraftState,
  parseWorkspaceViewState,
  removeWorkspaceDraft as removeDraftRecord,
  toggleScenarioComparison,
  upsertGoalScenario,
  upsertHealthReview,
  upsertWorkspaceDraft,
} from '../domain/workspace/state';
import {
  appendReportSnapshot,
  ensureReportBaseSnapshot,
  verifyReportRevisionIntegrity,
} from '../features/reports/revisions';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface AppState {
  // 运行时状态
  hydrated: boolean;
  recoveryError: string | null;
  maintenanceLabel: string | null;
  dataRevision: number;
  saveStatus: 'saved' | 'pending' | 'saving' | 'error';
  saveError: string | null;
  toasts: Toast[];
  coinRainActive: boolean;
  /** 当前庆祝事件（等级升级 / 目标达成），由 CelebrationOverlay 消费。 */
  celebration: CelebrationEvent | null;

  // 业务数据（持久化）
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
  reportProjectionQueue: ReportProjectionQueue;
  retryReportProjection: () => Promise<void>;
  sortRules: CustomSortRule[];
  sortHistory: SortHistory;
  /** 当前排序模式 key（持久化，刷新后恢复）。 */
  activeSortKey: string;
  /** 固定置顶的渠道 id。 */
  pinnedChannelIds: string[];
  /** 报告多维排序规则（持久化）。 */
  reportSortSpec: ReportSortSpec;
  smartSortConfig: SmartSortConfig;
  profile: UserProfile;
  appearance: AppearanceSettings;
  /** 本地账户（元数据；hash 见 authRecord，均不进财务 Backup）。 */
  account: LocalAccount | null;
  authRecord: AuthRecord | null;
  /** 当前会话是否锁定。 */
  locked: boolean;
  chartSettings: ChartSettings;
  countdown: CountdownData;
  goals: Goal[];
  primaryGoalId: string | null;
  countdownOpacity: number;
  coinRainConfig: CoinRainConfig;
  goalAchieved: GoalAchievementStatus;
  timeRangeHistory: TimeRangeHistory;
  countdownProgressHistory: CountdownProgressPoint[];
  currentWealthLevel: CurrentWealthLevel;
  wealthTrackerHistory: HistoryPoint[];
  levelAchievements: LevelAchievement[];
  lottery: LotteryState;
  activityLog: ActivityLogEntry[];

  // ---- 月度理财 ----
  monthlyPlanning: MonthlyPlanningState;
  assetClassification: AssetClassificationState;
  ledgerIdentity: LedgerIdentityState;
  workspaceDrafts: WorkspaceDraftState;
  healthReviews: HealthReviewState;
  reportRevisions: ReportRevisionState;
  goalScenarios: GoalScenarioState;
  workspaceViews: WorkspaceViewState;
  /** 事务式写入月度会话：维护租约 + 备份 + 单次 rawSet + persist + flush */
  upsertMonthlySession: (session: MonthlyReview, label?: string) => Promise<void>;
  saveMonthlyPolicy: (policy: InvestmentPolicy) => Promise<void>;
  recordMonthlyExecution: (sessionKey: string, record: ExecutionRecord) => Promise<void>;
  setMonthlySettings: (patch: Partial<MonthlyPlanningState['settings']>) => Promise<void>;
  deleteMonthlySession: (key: string) => Promise<void>;
  applyAssetClassification: (state: AssetClassificationState, label?: string) => Promise<void>;
  saveWorkspaceDraft: (draft: WorkspaceDraft) => Promise<void>;
  removeWorkspaceDraft: (draftId: string, ledgerId?: string) => Promise<void>;
  saveHealthReview: (review: HealthReviewRecord) => Promise<void>;
  saveGoalScenario: (scenario: GoalScenarioRecord) => Promise<void>;
  toggleGoalScenarioComparison: (id: string) => void;
  saveNamedView: (view: NamedView) => void;
  deleteNamedView: (id: string) => void;
  setOverviewHiddenModules: (ids: string[]) => void;

  // 数据管理弹窗状态
  importModalOpen: boolean;

  // ---- 生命周期 ----
  hydrate: () => Promise<void>;

  // ---- 通用 ----
  pushToast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: string) => void;
  setImportModalOpen: (open: boolean) => void;
  dismissCelebration: () => void;

  // ---- 渠道 ----
  addParentChannel: (name: string, emoji: string, color: string) => void;
  updateParentChannel: (id: string, patch: Partial<Pick<Channel, 'name' | 'emoji' | 'color'>>) => void;
  setChannelArchived: (id: string, archived: boolean) => void;
  deleteParentChannel: (id: string) => void;
  toggleChannel: (id: string) => void;
  addSubChannel: (parentId: string, name: string, emoji: string, color: string, strategy?: FirstChildStrategy) => void;
  updateSubChannelInfo: (
    parentId: string,
    childId: string,
    patch: Partial<Pick<SubChannel, 'name' | 'emoji' | 'color'>>,
  ) => void;
  deleteSubChannel: (parentId: string, childId: string, strategy?: LastChildStrategy) => void;
  setAmount: (target: { parentId: string; childId?: string }, amount: number) => void;
  prepareAmountBatch: (changes: AmountBatchChange[], referenceDate?: string) => AmountBatchProposal;
  confirmAmountBatch: (proposal: AmountBatchProposal) => Promise<void>;

  // ---- 历史 ----
  addHistoryPoint: (date: string, totalAmount: number, source?: HistorySource) => { conflict: boolean; existing?: HistoryPoint };
  overwriteHistoryPoint: (date: string, totalAmount: number, source?: HistorySource) => void;
  updateHistoryPoint: (date: string, totalAmount: number) => void;
  setHistoryEventNote: (date: string, note: string, baseRevision: number) => Promise<void>;
  prepareHistoryEdit: (command: HistoryEditCommand, baseRevision: number) => HistoryEditProposal;
  confirmHistoryEdit: (proposal: HistoryEditProposal, overwrite?: boolean) => Promise<void>;
  deleteHistoryPoint: (date: string) => void;
  deleteHistoryPoints: (dates: string[]) => void;
  /** 构造周报生成的 Daily Snapshot 并检查当天 History 冲突（不写入）。 */
  prepareWeeklySnapshot: (referenceDate: string) => { conflict: boolean; identical: boolean; snapshot: HistoryPoint; existing?: HistoryPoint };
  /** 写入周报 Daily Snapshot（创建或覆盖当天，一天一条）。 */
  commitWeeklySnapshot: (snapshot: HistoryPoint) => void;

  // ---- 报告 ----
  prepareReport: (type: ReportType, referenceDate?: string) => ReportProposal;
  confirmReport: (proposal: ReportProposal, approval?: ReportApproval) => Promise<FinancialReport>;
  updateReportMetadata: (id: string, patch: Partial<Pick<FinancialReport, 'titleMode' | 'standardTitle' | 'customTitle' | 'tags' | 'customSummary' | 'archiveNote'>>, baseRevision?: number) => Promise<void>;
  /** 高级编辑报告全字段（记录 manual-report-edit 审计；可选择同步对应 History）。 */
  commitReportEdit: (id: string, edited: FinancialReport, audit: ReportRepairAudit[], opts?: { syncHistory?: boolean; baseRevision?: number }) => Promise<FinancialReport>;
  repairReport: (id: string, repaired: FinancialReport, baseRevision: number) => Promise<FinancialReport>;
  archiveReport: (id: string, note?: string) => Promise<void>;
  deleteReport: (id: string) => Promise<void>;
  deleteReports: (ids: string[]) => Promise<void>;
  setReportSortSpec: (spec: ReportSortSpec) => void;
  /** 补生成缺失的历史月度报告（幂等，返回 create/repair 的 periodKey）。 */
  runMonthlyBackfill: (baseRevision?: number) => Promise<{ created: string[]; repaired: string[] }>;

  // ---- 排序 ----
  addSortRule: (rule: Omit<CustomSortRule, 'id' | 'createdAt'>) => void;
  deleteSortRule: (id: string) => void;
  recordSortHistory: (key: string, label: string) => void;
  clearSortHistory: () => void;
  setActiveSortKey: (key: string) => void;
  togglePinChannel: (id: string) => void;
  setSmartSortConfig: (config: SmartSortConfig) => void;
  setProfile: (profile: UserProfile) => void;
  setAppearance: (appearance: AppearanceSettings) => void;
  setupAccount: (displayName: string, method: 'pin' | 'password', secret: string) => Promise<boolean>;
  login: (secret: string) => Promise<boolean>;
  logout: () => void;
  disableAccount: () => void;

  // ---- 倒计时 / 目标 ----
  setCountdown: (countdown: CountdownData) => void;
  setCountdownOpacity: (opacity: number) => void;
  markGoalAchieved: () => void;
  resetGoal: () => void;

  // ---- Goals V2 ----
  upsertGoal: (goal: Goal) => void;
  deleteGoal: (id: string) => void;
  setPrimaryGoal: (id: string | null) => void;

  // ---- Lottery ----
  addLotteryTransaction: (tx: LotteryTransaction) => void;
  updateLotteryTransaction: (id: string, tx: LotteryTransaction) => void;
  deleteLotteryTransaction: (id: string) => void;
  importLotteryTransactions: (txs: LotteryTransaction[]) => number;
  upsertLotteryProject: (project: LotteryProject) => void;
  deleteLotteryProject: (id: string) => void;
  archiveLotteryProject: (id: string) => void;
  setLotteryPool: (pool: LotteryState['pool']) => void;
  setLotterySettings: (settings: LotteryState['settings']) => void;
  applyLotteryExcelImport: (preview: { projects: LotteryProject[]; transactions: LotteryTransaction[] }) => { projectsAdded: number; transactionsAdded: number };

  // ---- Activity Log ----
  logActivity: (type: string, description: string, entityType?: string, entityId?: string) => void;

  // ---- 金币雨 / 图表 ----
  setCoinRainConfig: (config: CoinRainConfig) => void;
  setChartSettings: (settings: ChartSettings) => void;
  triggerCoinRain: () => void;
  stopCoinRain: () => void;

  // ---- 导入导出 ----
  exportData: () => Promise<void>;
  importData: (jsonText: string, mode?: 'replace' | 'merge', baseRevision?: number) => Promise<{ ok: boolean; message: string }>;
  applyDataFixes: (baseRevision?: number, fix?: 'sanitize-amounts' | 'remove-orphans' | 'dedupe-history') => Promise<{ fixed: number }>;
  commitHealthFix: (proposal: HealthFixProposal) => Promise<{ fixed: number }>;
}

const PERSIST_KEYS: Array<{ key: string; pick: (s: AppState) => unknown }> = [
  {
    key: STORAGE_KEYS.wealthTrackerData,
    pick: (s) => ({ channels: s.channels, history: s.history }),
  },
  { key: STORAGE_KEYS.financialReports, pick: (s) => s.reports },
  { key: STORAGE_KEYS.reportProjectionQueue, pick: (s) => s.reportProjectionQueue },
  { key: STORAGE_KEYS.customSortRules, pick: (s) => ({ rules: s.sortRules.filter((r) => !r.isSystem) }) },
  { key: STORAGE_KEYS.sortHistory, pick: (s) => s.sortHistory },
  { key: STORAGE_KEYS.sortConfig, pick: (s) => ({ activeKey: s.activeSortKey, pinned: s.pinnedChannelIds }) },
  { key: STORAGE_KEYS.reportSortSettings, pick: (s) => s.reportSortSpec },
  { key: STORAGE_KEYS.smartSortConfig, pick: (s) => s.smartSortConfig },
  { key: STORAGE_KEYS.userProfile, pick: (s) => s.profile },
  { key: STORAGE_KEYS.appearanceSettings, pick: (s) => s.appearance },
  { key: STORAGE_KEYS.authData, pick: (s) => ({ account: s.account, authRecord: s.authRecord }) },
  { key: STORAGE_KEYS.chartSettings, pick: (s) => s.chartSettings },
  { key: STORAGE_KEYS.countdownData, pick: (s) => s.countdown },
  { key: STORAGE_KEYS.goals, pick: (s) => ({ goals: s.goals, primaryGoalId: s.primaryGoalId }) },
  { key: STORAGE_KEYS.countdownOpacity, pick: (s) => s.countdownOpacity },
  { key: STORAGE_KEYS.coinRainConfig, pick: (s) => s.coinRainConfig },
  { key: STORAGE_KEYS.goalAchievementStatus, pick: (s) => s.goalAchieved },
  { key: STORAGE_KEYS.timeRangeHistory, pick: (s) => s.timeRangeHistory },
  { key: STORAGE_KEYS.countdownProgressHistory, pick: (s) => s.countdownProgressHistory },
  { key: STORAGE_KEYS.currentWealthLevel, pick: (s) => s.currentWealthLevel },
  { key: STORAGE_KEYS.wealthTrackerHistory, pick: (s) => s.wealthTrackerHistory },
  { key: STORAGE_KEYS.levelAchievements, pick: (s) => s.levelAchievements },
  { key: STORAGE_KEYS.lotteryState, pick: (s) => s.lottery },
  { key: STORAGE_KEYS.activityLog, pick: (s) => s.activityLog },
  { key: STORAGE_KEYS.monthlyPlanning, pick: (s) => s.monthlyPlanning },
  { key: STORAGE_KEYS.assetClassification, pick: (s) => s.assetClassification },
  { key: STORAGE_KEYS.ledgerIdentity, pick: (s) => s.ledgerIdentity },
  { key: STORAGE_KEYS.dataRevision, pick: (s) => s.dataRevision },
  { key: STORAGE_KEYS.workspaceDrafts, pick: (s) => s.workspaceDrafts },
  { key: STORAGE_KEYS.healthReviews, pick: (s) => s.healthReviews },
  { key: STORAGE_KEYS.reportRevisions, pick: (s) => s.reportRevisions },
  { key: STORAGE_KEYS.goalScenarios, pick: (s) => s.goalScenarios },
  { key: STORAGE_KEYS.workspaceUi, pick: (s) => s.workspaceViews },
];

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistQueue: Promise<void> = Promise.resolve();
let persistDirty = false;
let pendingPersistKeys = new Set<string>();

async function persistNow(get: () => AppState): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  if (!get().hydrated) return;
  if (!persistDirty) { await persistQueue; return; }
  persistDirty = false;
  const keys = pendingPersistKeys.size
    ? new Set(pendingPersistKeys)
    : new Set(PERSIST_KEYS.map((item) => item.key));
  pendingPersistKeys = new Set();
  const values = PERSIST_KEYS
    .filter(({ key }) => keys.has(key))
    .map(({ key, pick }) => ({ key, raw: JSON.stringify(pick(get())) }));
  useAppStore.setState({ saveStatus: 'saving', saveError: null });
  const write = persistQueue.catch(() => {}).then(async () => {
    await storageService.setBatch(values.map(({ key, raw }) => ({ key, value: raw })));
    await storageService.flushAdapter();
  });
  persistQueue = write;
  try {
    await write;
    useAppStore.setState({ saveStatus: persistDirty ? 'pending' : 'saved' });
  } catch (error) {
    persistDirty = true;
    for (const key of keys) pendingPersistKeys.add(key);
    useAppStore.setState({ saveStatus: 'error', saveError: error instanceof Error ? error.message : '保存失败' });
    throw error;
  }
}

function schedulePersist(get: () => AppState, keys?: readonly string[]): void {
  persistDirty = true;
  if (keys?.length) keys.forEach((key) => pendingPersistKeys.add(key));
  else PERSIST_KEYS.forEach(({ key }) => pendingPersistKeys.add(key));
  useAppStore.setState({ saveStatus: 'pending' });
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistNow(get).catch(() => {}); // visible saveError; flush still rejects
  }, 300);
}

/** 渠道金额变更后，同步今天的历史点（保持趋势最新）。 */
function afterChannelChange(s: Pick<AppState, 'channels' | 'history'>): {
  channels: Channel[];
  history: HistoryPoint[];
} {
  const channels = normalizeChannelAmounts(s.channels);
  const total = totalAssets(channels);
  const today = todayString();
  // 保存当日完整渠道快照，使未来可正确回答「某天支付宝是多少」等历史构成问题。
  const snapshot: Channel[] = channels.map((c) => ({
    ...c,
    children: c.children ? c.children.map((child) => ({ ...child })) : undefined,
  }));
  const wealthLevel = getLevelByAmount(total).name;
  const timestamp = Date.now();
  const updatedAt = new Date().toISOString();

  // 当天唯一 HistoryPoint 原地更新（Live Snapshot，不新增第二条，不弹冲突）
  let history = s.history;
  const existing = history.find((h) => h.date === today);
  if (existing) {
    history = history.map((h) =>
      h.date === today
        ? { ...h, totalAmount: total, channels: snapshot, wealthLevel, timestamp, source: 'live-snapshot', updatedAt }
        : h,
    );
  } else {
    history = [...history, { date: today, totalAmount: total, channels: snapshot, wealthLevel, timestamp, source: 'live-snapshot', updatedAt }];
  }
  return { channels, history };
}

const persistentFields: ReadonlyArray<keyof AppState> = [
  'channels', 'history', 'reports', 'sortRules', 'sortHistory', 'activeSortKey',
  'pinnedChannelIds', 'reportSortSpec', 'smartSortConfig', 'profile', 'appearance',
  'account', 'authRecord', 'chartSettings', 'countdown', 'goals', 'primaryGoalId',
  'countdownOpacity', 'coinRainConfig', 'goalAchieved', 'timeRangeHistory',
  'countdownProgressHistory', 'currentWealthLevel', 'wealthTrackerHistory',
  'levelAchievements', 'lottery', 'activityLog',
  'monthlyPlanning',
  'assetClassification',
  'ledgerIdentity',
  'workspaceDrafts',
  'healthReviews',
  'reportRevisions',
  'goalScenarios',
  'workspaceViews',
];

export const useAppStore = create<AppState>()((rawSet, get) => {
  // UI blocking is not sufficient: an earlier async command can resume during maintenance.
  const set: typeof rawSet = (update, replace) => {
    const previous = get();
    const next = typeof update === 'function' ? update(previous) : update;
    if (previous.maintenanceLabel && persistentFields.some(key => key in next && next[key] !== previous[key])) {
      throw new Error(`${previous.maintenanceLabel}，暂时不能编辑数据`);
    }
    rawSet(next, replace);
  };
  let hydration: Promise<void> | null = null;
  const persist = (keys?: readonly string[]) => schedulePersist(get, keys);
  let projectionInFlight: Promise<void> | null = null;
  const drainReportProjection = (): Promise<void> => {
    if (projectionInFlight) return projectionInFlight;
    projectionInFlight = (async () => {
      const manager = storageService.getDesktopManager();
      if (!manager) return;
      await storageService.flush();
      const queue = get().reportProjectionQueue;
      if (!queue.indexPending && !queue.reportIds.length) return;
      const reports = get().reports;
      try {
        await writeReportProjection(queue, reports, manager);
        if (get().reportProjectionQueue.generation === queue.generation) {
          rawSet({ reportProjectionQueue: { ...emptyProjectionQueue(), generation: queue.generation } });
          persist();
          await storageService.flush();
        }
      } catch {
        if (get().reportProjectionQueue.generation === queue.generation) {
          rawSet({ reportProjectionQueue: { ...queue, attempts: queue.attempts + 1, lastError: '报告文件同步失败。主数据已保留，请检查存储目录权限后重试。' } });
          persist();
          await storageService.flush();
        }
        get().pushToast('主数据已保存，报告文件等待同步，可在数据中心重试', 'error');
      }
    })().finally(() => { projectionInFlight = null; });
    return projectionInFlight;
  };

  const commitReportList = async (label: string, baseRevision: number, build: (reports: FinancialReport[]) => FinancialReport[]) => {
    if (get().dataRevision !== baseRevision) throw new Error('数据已变化，请重新打开并确认');
    const reports = build(get().reports);
    if (reports === get().reports || JSON.stringify(reports) === JSON.stringify(get().reports)) return;
    validateLedgerShape(null, reports);
    const periods = reports.map(r => normalizeFinancialReport(r).periodKey ?? periodKeyOf(r));
    if (new Set(periods).size !== periods.length) throw new Error('存在重复报告周期，请先核对数据');
    const release = beginLedgerMaintenance(label);
    try {
      await storageService.flush();
      const mgr = storageService.getDesktopManager();
      if (mgr && !(await mgr.backupNow(true))) throw new Error('操作前备份不可用');
      if (get().dataRevision !== baseRevision) throw new Error('数据已变化，请重新打开并确认');
      const previousReports = new Map(get().reports.map((report) => [report.id, report]));
      const nextReports = new Map(reports.map((report) => [report.id, report]));
      const action: 'deleted' | 'archived' | 'metadata' | 'edited' = label.includes('删除')
        ? 'deleted'
        : label.includes('归档')
          ? 'archived'
          : label.includes('备注')
            ? 'metadata'
            : 'edited';
      let reportRevisions = get().reportRevisions;
      for (const previous of previousReports.values()) {
        const next = nextReports.get(previous.id);
        if (!next) reportRevisions = await appendReportSnapshot(reportRevisions, previous, 'deleted', baseRevision);
        else if (JSON.stringify(next) !== JSON.stringify(previous)) {
          reportRevisions = await ensureReportBaseSnapshot(reportRevisions, previous, baseRevision);
        }
      }
      for (const [id, next] of nextReports) {
        const previous = previousReports.get(id);
        if (!previous || JSON.stringify(next) !== JSON.stringify(previous)) {
          reportRevisions = await appendReportSnapshot(reportRevisions, next, action === 'deleted' ? 'edited' : action, baseRevision);
        }
      }
      rawSet({ reports, reportRevisions });
      persist([STORAGE_KEYS.financialReports, STORAGE_KEYS.reportRevisions]);
      await storageService.flush();
      if (mgr) await drainReportProjection();
    } finally { release(); }
  };

  /** 渠道金额/结构变更的统一收尾：同步今日历史快照 + 等级成就 + 庆祝 + 持久化。 */
  const commitChannelChange = (prevTotal: number, nextChannels: Channel[]) => {
    set((s) => {
      const { history } = afterChannelChange({ ...s, channels: nextChannels });
      return { channels: nextChannels, history };
    });
    const newTotal = totalAssets(get().channels);
    const crossed = crossedLevelAchievements(prevTotal, newTotal);
    if (crossed.length > 0) {
      set((s) => ({ levelAchievements: mergeLevelAchievements(s.levelAchievements, crossed) }));
    }
    const { event, newGoalAchieved } = detectCelebrations(prevTotal, newTotal, get().countdown, get().goalAchieved);
    if (event) {
      if (newGoalAchieved) set({ goalAchieved: newGoalAchieved });
      if (event.goal) get().triggerCoinRain();
      set({ celebration: event });
    }
    persist();
  };

  return {
    hydrated: false,
    recoveryError: null,
    maintenanceLabel: null,
    dataRevision: 0,
    saveStatus: 'saved',
    saveError: null,
    toasts: [],
    coinRainActive: false,
    celebration: null,

    channels: [],
    history: [],
    reports: [],
    reportProjectionQueue: emptyProjectionQueue(),
    async retryReportProjection() {
      const release = beginLedgerMaintenance('正在同步报告文件');
      try { await drainReportProjection(); } finally { release(); }
    },
    sortRules: [],
    sortHistory: { history: [] },
    activeSortKey: 'default',
    pinnedChannelIds: [],
    reportSortSpec: DEFAULT_REPORT_SORT,
    smartSortConfig: DEFAULT_SMART_CONFIG,
    profile: { defaultCurrency: 'CNY' },
    appearance: { themeMode: 'system', followWealthTheme: true, density: 'comfortable', animationIntensity: 'normal', backgroundOpacity: 30, reduceMotion: 'system' },
    account: null,
    authRecord: null,
    locked: false,
    chartSettings: defaultChartSettings(),
    countdown: defaultCountdownData(),
    goals: [],
    primaryGoalId: null,
    countdownOpacity: 1,
    coinRainConfig: defaultCoinRainConfig(),
    goalAchieved: { hasAchievedGoal: false },
    timeRangeHistory: { records: [] },
    countdownProgressHistory: [],
    currentWealthLevel: { level: '' },
    wealthTrackerHistory: [],
    levelAchievements: [],
    lottery: defaultLotteryState(),
    activityLog: [],

    importModalOpen: false,
    monthlyPlanning: emptyMonthlyPlanningState(),
    assetClassification: emptyAssetClassificationState(),
    ledgerIdentity: { schemaVersion: 1, ledgerId: 'pending-hydration', createdAt: new Date().toISOString() },
    workspaceDrafts: emptyWorkspaceDraftState(),
    healthReviews: emptyHealthReviewState(),
    reportRevisions: emptyReportRevisionState(),
    goalScenarios: emptyGoalScenarioState(),
    workspaceViews: emptyWorkspaceViewState(),
    async upsertMonthlySession(session, label = '正在保存月度会话') {
      const release = beginLedgerMaintenance(label);
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');
        const current = get();
        const next = await upsertSession(current.monthlyPlanning, session);
        rawSet({ monthlyPlanning: next });
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },
    async saveMonthlyPolicy(policy) {
      const release = beginLedgerMaintenance('正在保存月度策略');
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');
        const next = upsertPolicy(get().monthlyPlanning, policy);
        rawSet({ monthlyPlanning: next });
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },
    async recordMonthlyExecution(sessionKey, record) {
      const release = beginLedgerMaintenance('正在登记执行回执');
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');
        const next = await recordExecution(get().monthlyPlanning, sessionKey, record);
        rawSet({ monthlyPlanning: next });
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },
    async setMonthlySettings(patch) {
      const release = beginLedgerMaintenance('正在保存月度提醒设置');
      try {
        const current = get().monthlyPlanning;
        const next = { ...current, settings: { ...current.settings, ...patch } };
        rawSet({ monthlyPlanning: next });
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },
    async deleteMonthlySession(key) {
      const release = beginLedgerMaintenance('正在删除月度会话');
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');
        const next = removeSession(get().monthlyPlanning, key);
        rawSet({ monthlyPlanning: next });
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },
    async applyAssetClassification(next, label = '正在保存资产分类') {
      const release = beginLedgerMaintenance(label);
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');
        rawSet({ assetClassification: next });
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },
    async saveWorkspaceDraft(draft) {
      if (draft.ledgerId !== get().ledgerIdentity.ledgerId) throw new Error('草稿属于另一份账本，已拒绝写入');
      rawSet({ workspaceDrafts: upsertWorkspaceDraft(get().workspaceDrafts, draft) });
      persist([STORAGE_KEYS.workspaceDrafts]);
      await storageService.flush();
    },
    async removeWorkspaceDraft(draftId, ledgerId) {
      const current = get().workspaceDrafts;
      const owned = current.drafts.find((draft) => draft.draftId === draftId && (!ledgerId || draft.ledgerId === ledgerId));
      if (!owned) return;
      rawSet({ workspaceDrafts: removeDraftRecord(current, draftId) });
      persist([STORAGE_KEYS.workspaceDrafts]);
      await storageService.flush();
    },
    async saveHealthReview(review) {
      if (review.ledgerId !== get().ledgerIdentity.ledgerId) throw new Error('核对记录属于另一份账本，已拒绝写入');
      rawSet({ healthReviews: upsertHealthReview(get().healthReviews, review) });
      persist([STORAGE_KEYS.healthReviews]);
      await storageService.flush();
    },
    async saveGoalScenario(scenario) {
      rawSet({ goalScenarios: upsertGoalScenario(get().goalScenarios, scenario) });
      persist([STORAGE_KEYS.goalScenarios]);
      await storageService.flush();
    },
    toggleGoalScenarioComparison(id) {
      rawSet({ goalScenarios: toggleScenarioComparison(get().goalScenarios, id) });
      persist([STORAGE_KEYS.goalScenarios]);
    },
    saveNamedView(view) {
      const namedViews = [
        ...get().workspaceViews.namedViews.filter((item) => item.id !== view.id && `${item.page}:${item.name}` !== `${view.page}:${view.name}`),
        view,
      ];
      rawSet({ workspaceViews: { ...get().workspaceViews, namedViews } });
      persist([STORAGE_KEYS.workspaceUi]);
    },
    deleteNamedView(id) {
      rawSet({
        workspaceViews: {
          ...get().workspaceViews,
          namedViews: get().workspaceViews.namedViews.filter((item) => item.id !== id),
        },
      });
      persist([STORAGE_KEYS.workspaceUi]);
    },
    setOverviewHiddenModules(ids) {
      rawSet({
        workspaceViews: {
          ...get().workspaceViews,
          overviewHiddenModules: [...new Set(ids.filter((id) => ['trend', 'work', 'reports'].includes(id)))],
        },
      });
      persist([STORAGE_KEYS.workspaceUi]);
    },

    // ---------------------------------------------------------------------
    hydrate() {
      if (hydration) return hydration;
      hydration = (async () => {
      set({ hydrated: false, recoveryError: null });
      try {
      const [
        wtd,
        reports,
        rules,
        sortHistory,
        chartSettings,
        countdown,
        opacity,
        coinRain,
        goal,
        timeRange,
        progressHistory,
        level,
        linkedHistory,
        sortConfig,
        smartSortConfig,
        profile,
        appearance,
        authData,
        reportSortSettings,
        levelAchievements,
        goalsData,
        lotteryData,
        activityLogData,
        projectionData,
        monthlyData,
        classificationData,
        ledgerData,
        storedDataRevision,
        draftData,
        healthReviewData,
        reportRevisionData,
        goalScenarioData,
        workspaceViewData,
      ] = await Promise.all([
        storageService.getJSON<{ channels: Channel[]; history: HistoryPoint[] }>(STORAGE_KEYS.wealthTrackerData),
        storageService.getJSON<FinancialReport[]>(STORAGE_KEYS.financialReports),
        storageService.getJSON<{ rules: CustomSortRule[] }>(STORAGE_KEYS.customSortRules),
        storageService.getJSON<SortHistory>(STORAGE_KEYS.sortHistory),
        storageService.getJSON<ChartSettings>(STORAGE_KEYS.chartSettings),
        storageService.getJSON<CountdownData>(STORAGE_KEYS.countdownData),
        storageService.getRaw(STORAGE_KEYS.countdownOpacity),
        storageService.getJSON<CoinRainConfig>(STORAGE_KEYS.coinRainConfig),
        storageService.getJSON<GoalAchievementStatus>(STORAGE_KEYS.goalAchievementStatus),
        storageService.getJSON<TimeRangeHistory>(STORAGE_KEYS.timeRangeHistory),
        storageService.getJSON<CountdownProgressPoint[]>(STORAGE_KEYS.countdownProgressHistory),
        storageService.getJSON<CurrentWealthLevel>(STORAGE_KEYS.currentWealthLevel),
        storageService.getJSON<HistoryPoint[]>(STORAGE_KEYS.wealthTrackerHistory),
        storageService.getJSON<{ activeKey: string; pinned: string[] }>(STORAGE_KEYS.sortConfig),
        storageService.getJSON<SmartSortConfig>(STORAGE_KEYS.smartSortConfig),
        storageService.getJSON<UserProfile>(STORAGE_KEYS.userProfile),
        storageService.getJSON<AppearanceSettings>(STORAGE_KEYS.appearanceSettings),
        storageService.getJSON<{ account: LocalAccount | null; authRecord: AuthRecord | null }>(STORAGE_KEYS.authData),
        storageService.getJSON<ReportSortSpec>(STORAGE_KEYS.reportSortSettings),
        storageService.getJSON<LevelAchievement[]>(STORAGE_KEYS.levelAchievements),
        storageService.getJSON<{ goals: Goal[]; primaryGoalId: string | null }>(STORAGE_KEYS.goals),
        storageService.getJSON<LotteryState>(STORAGE_KEYS.lotteryState),
        storageService.getJSON<ActivityLogEntry[]>(STORAGE_KEYS.activityLog),
        storageService.getJSON<ReportProjectionQueue>(STORAGE_KEYS.reportProjectionQueue),
        storageService.getJSON<unknown>(STORAGE_KEYS.monthlyPlanning),
        storageService.getJSON<unknown>(STORAGE_KEYS.assetClassification),
        storageService.getJSON<unknown>(STORAGE_KEYS.ledgerIdentity),
        storageService.getJSON<unknown>(STORAGE_KEYS.dataRevision),
        storageService.getJSON<unknown>(STORAGE_KEYS.workspaceDrafts),
        storageService.getJSON<unknown>(STORAGE_KEYS.healthReviews),
        storageService.getJSON<unknown>(STORAGE_KEYS.reportRevisions),
        storageService.getJSON<unknown>(STORAGE_KEYS.goalScenarios),
        storageService.getJSON<unknown>(STORAGE_KEYS.workspaceUi),
      ]);
      const parsedMonthlyPlanning = parseMonthlyPlanningState(monthlyData);
      const revisionIntegrity = await ensureTaskRevisionIntegrity(parsedMonthlyPlanning);
      const monthlyPlanning = revisionIntegrity.state;
      const parsedAssetClassification = parseAssetClassificationState(classificationData);
      const classificationIntegrity = await verifyAssetClassificationIntegrity(parsedAssetClassification);
      const assetClassification = classificationIntegrity.state;
      const ledgerIdentityCreated = ledgerData === null || ledgerData === undefined;
      const ledgerIdentity = parseLedgerIdentity(ledgerData);
      const dataRevision = typeof storedDataRevision === 'number' && Number.isSafeInteger(storedDataRevision) && storedDataRevision >= 0
        ? storedDataRevision
        : 0;
      const workspaceDrafts = parseWorkspaceDraftState(draftData);
      const healthReviews = parseHealthReviewState(healthReviewData);
      const reportRevisions = parseReportRevisionState(reportRevisionData);
      await verifyReportRevisionIntegrity(reportRevisions);
      const goalScenarios = parseGoalScenarioState(goalScenarioData);
      const workspaceViews = parseWorkspaceViewState(workspaceViewData);

      validateLedgerShape(wtd, reports);
      validateFinancialExtensions({ countdown_data: countdown, goal_achievement_status: goal,
        goals: goalsData, lottery_state: lotteryData, level_achievements: levelAchievements,
        countdown_progress_history: progressHistory });
      const isFirstRun = wtd === null;
      const storedVersion = await storageService.getRaw(STORAGE_VERSION_KEY);
      if (isFirstRun && (storedVersion !== null || reports !== null)) throw new Error('主数据缺失但已有版本或报告，不能按新安装初始化');
      let channels = wtd ? wtd.channels : defaultChannels();
      const history = wtd ? wtd.history : defaultHistory();

      // 系统规则始终可用，叠加用户自定义规则（只持久化用户规则，系统规则随版本生成）。
      const userRules = rules?.rules?.filter((r) => !r.isSystem) ?? [];
      const allRules = [...defaultSortRules(), ...userRules];

      // v1.1 → v1.2 迁移：校园卡补充默认学校（仅升级时运行一次）。
      let migrationNote: string | undefined;
      if (!isFirstRun && needsV12Migration(storedVersion)) {
        const migrated = migrateChannelsV12(channels);
        if (migrated.added > 0) {
          channels = migrated.channels;
          migrationNote = `已为「校园卡」补充 ${migrated.added} 个默认学校子渠道`;
        }
      }

      // v1.4 → v1.5 迁移：新增京东金融父渠道 + 默认子渠道（幂等，仅升级时运行一次）。
      if (!isFirstRun && needsV15Migration(storedVersion)) {
        const migrated = migrateChannelsV15(channels);
        if (migrated.addedParent > 0 || migrated.addedChildren > 0) {
          channels = migrated.channels;
          const note = migrated.addedParent > 0
            ? `已新增「京东金融」父渠道${migrated.addedChildren > 0 ? `及 ${migrated.addedChildren} 个默认子渠道` : ''}`
            : `已为「京东金融」补齐 ${migrated.addedChildren} 个默认子渠道`;
          migrationNote = migrationNote ? `${migrationNote}；${note}` : note;
        }
      }

      // v1.2 → v1.3 迁移：财务报告规范化（补 periodKey/title/ISO week/wealthLevel/completeness）。
      const reportMigration = migrateReportsV13(reports ?? []);
      const normalizedReports = reportMigration.reports;
      if (reportMigration.changed > 0) {
        migrationNote = migrationNote
          ? `${migrationNote}；已规范化 ${reportMigration.changed} 份历史报告`
          : `已规范化 ${reportMigration.changed} 份历史报告`;
      }

      // v1.2 → v1.3 迁移：等级成就从历史安全回推（幂等，不伪造日期）。
      const mergedAchievements = mergeLevelAchievements(
        levelAchievements ?? [],
        history.length > 0 ? deriveLevelAchievements(history) : [],
      );

      // v1.2 → v1.3 迁移：CountdownData → Goals V2（幂等：已有 goals 则不重建）。
      let goals = goalsData?.goals ?? [];
      let primaryGoalId = goalsData?.primaryGoalId ?? null;
      if (goals.length === 0 && countdown && countdown.targetAmount > 0) {
        const primary = countdownToGoal(countdown);
        goals = [primary];
        primaryGoalId = primary.id;
      }
      if (primaryGoalId && !goals.some((g) => g.id === primaryGoalId)) {
        primaryGoalId = goals[0]?.id ?? null;
      }
      // 同步 legacy countdown 为主目标（庆祝检测/倒计时/预测目标路径继续可用）
      const primaryGoal = primaryGoalId ? goals.find((g) => g.id === primaryGoalId) : undefined;
      const effectiveCountdown = primaryGoal ? countdownFromGoal(primaryGoal) : countdown;

      rawSet({
        channels: normalizeChannelAmounts(channels),
        history,
        reports: normalizedReports,
        reportProjectionQueue: storageService.getDesktopManager() && reportMigration.changed > 0
          ? enqueueReportProjection(parseProjectionQueue(projectionData), [], normalizedReports)
          : parseProjectionQueue(projectionData),
        sortRules: allRules,
        sortHistory: sortHistory ?? { history: [] },
        activeSortKey: sortConfig?.activeKey ?? 'default',
        pinnedChannelIds: sortConfig?.pinned ?? [],
        reportSortSpec: reportSortSettings ?? DEFAULT_REPORT_SORT,
        smartSortConfig: smartSortConfig ?? DEFAULT_SMART_CONFIG,
        profile: profile ?? { defaultCurrency: 'CNY' },
        appearance: { themeMode: 'system', followWealthTheme: true, density: 'comfortable', animationIntensity: 'normal', backgroundOpacity: 30, reduceMotion: 'system', ...(appearance ?? {}) },
        account: authData?.account ?? null,
        authRecord: authData?.authRecord ?? null,
        locked: authData?.account?.requireOnLaunch && authData?.authRecord ? true : false,
        chartSettings: chartSettings ?? defaultChartSettings(),
        countdown: effectiveCountdown ?? defaultCountdownData(),
        goals,
        primaryGoalId,
        countdownOpacity: opacity != null ? Number(opacity) || 1 : 1,
        coinRainConfig: coinRain ?? defaultCoinRainConfig(),
        goalAchieved: goal ?? { hasAchievedGoal: false },
        timeRangeHistory: timeRange ?? { records: [] },
        countdownProgressHistory: progressHistory ?? [],
        currentWealthLevel: level ?? { level: '' },
        wealthTrackerHistory: linkedHistory ?? [],
        levelAchievements: mergedAchievements,
        lottery: lotteryData ?? defaultLotteryState(),
        activityLog: activityLogData ?? [],
        monthlyPlanning,
        assetClassification,
        ledgerIdentity,
        dataRevision,
        workspaceDrafts,
        healthReviews,
        reportRevisions,
        goalScenarios,
        workspaceViews,
        hydrated: false,
      });

      // The version and migrated ledger are one batch. A crash must never leave
      // a version-only "existing installation" with its canonical data missing.
      if (isFirstRun || storedVersion !== APP_VERSION || reportMigration.changed > 0
        || revisionIntegrity.changed || classificationIntegrity.changed || ledgerIdentityCreated) {
        const mgr = storageService.getDesktopManager();
        if (!isFirstRun && mgr && !(await mgr.backupNow(true))) throw new Error('升级前备份不可用');
        const state = get();
        await storageService.setBatch([
          ...PERSIST_KEYS.map(({ key, pick }) => ({ key, value: JSON.stringify(pick(state)) })),
          { key: STORAGE_VERSION_KEY, value: APP_VERSION },
        ]);
        if (migrationNote) get().pushToast(migrationNote, 'info');
      }
      await storageService.flushAdapter();
      // 历史版本把附件内联在状态文件里（导致状态文件涨到 9 MB、每次保存都在重写它）。
      // 这里把它们搬到数据根下的独立文件；失败不阻塞启动，附件仍可按内联值读取。
      try {
        const moved = await migrateInlineAttachments();
        if (moved) {
          await storageService.flushAdapter();
          get().pushToast(`已把 ${moved} 个附件移出状态文件（改为独立文件存储）`, 'info');
        }
        const refs = get().monthlyPlanning.sessions.flatMap((task) =>
          task.documents
            .filter((document) => document.relativePath.startsWith('monthly-attach:'))
            .map((document) => ({ key: document.relativePath, sha256: document.sha256 })));
        const converted = await migrateLegacyBase64AttachmentFiles(refs);
        if (converted) {
          get().pushToast(`已把 ${converted} 个附件转换为原始二进制存储`, 'info');
        }
      } catch (error) {
        console.warn('[monthly] 附件外移失败，仍按内联值读取:', error);
      }
      set({ hydrated: true });
      } catch (error) {
        storageService.pauseWrites();
        set({ hydrated: false, recoveryError: error instanceof Error ? error.message : '数据加载失败', saveStatus: 'error' });
        throw error;
      }
      })().finally(() => { hydration = null; });
      return hydration;
    },

    // ---------------------------------------------------------------------
    pushToast(message, kind = 'info') {
      const id = uuid();
      set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
      setTimeout(() => get().dismissToast(id), 4000);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    setImportModalOpen(open) {
      set({ importModalOpen: open });
    },
    dismissCelebration() {
      set({ celebration: null });
    },

    // ---------------------------------------------------------------------
    addParentChannel(name, emoji, color) {
      const channel = makeChannel(name, emoji, color);
      set((s) => ({ channels: [...s.channels, channel] }));
      get().pushToast(`已添加渠道「${name}」`, 'success');
      persist();
    },
    updateParentChannel(id, patch) {
      set((s) => ({ channels: updateChannel(s.channels, id, patch) }));
      persist();
    },
    setChannelArchived(id, archived) {
      set((s) => ({
        channels: s.channels.map((channel) => channel.id === id
          ? { ...channel, archived, updatedAt: new Date().toISOString() }
          : channel),
      }));
      get().logActivity('channel-archive', archived ? '归档渠道（余额继续计入总资产）' : '恢复归档渠道', 'channel', id);
      persist();
    },
    deleteParentChannel(id) {
      set((s) => ({ channels: removeChannel(s.channels, id) }));
      persist();
    },
    toggleChannel(id) {
      set((s) => ({ channels: toggleChannelExpanded(s.channels, id) }));
      persist();
    },
    addSubChannel(parentId, name, emoji, color, strategy = 'transfer') {
      const prevTotal = totalAssets(get().channels);
      const child = makeSubChannel(parentId, name, emoji, color);
      const result = promoteParentToChildren(get().channels, parentId, child, strategy);
      commitChannelChange(prevTotal, result.channels);
      if (result.lostAmount > 0) {
        get().logActivity('channel-structure', `添加子渠道「${name}」并清空父渠道直接金额 ¥${result.lostAmount.toFixed(2)}`, 'channel', parentId);
      }
    },
    updateSubChannelInfo(parentId, childId, patch) {
      set((s) => ({ channels: updateSubChannel(s.channels, parentId, childId, patch) }));
      persist();
    },
    deleteSubChannel(parentId, childId, strategy = 'keep-direct') {
      const prevTotal = totalAssets(get().channels);
      const result = collapseParentToDirectAmount(get().channels, parentId, childId, strategy);
      commitChannelChange(prevTotal, result.channels);
      if (result.lostAmount > 0) {
        get().logActivity('channel-structure', `删除子渠道并同时删除金额 ¥${result.lostAmount.toFixed(2)}`, 'channel', parentId);
      }
    },
    setAmount(target, amount) {
      const prevTotal = totalAssets(get().channels);
      commitChannelChange(prevTotal, setLeafAmount(get().channels, target, amount));
    },
    prepareAmountBatch(changes, referenceDate) {
      const state = get();
      return buildAmountBatchProposal({
        channels: state.channels,
        history: state.history,
        baseRevision: state.dataRevision,
      }, changes, referenceDate);
    },
    async confirmAmountBatch(proposal) {
      const initial = get();
      const initialResult = confirmAmountBatchProposal({
        channels: initial.channels,
        history: initial.history,
        baseRevision: initial.dataRevision,
      }, proposal);
      if (!initialResult.changed) return;

      const release = beginLedgerMaintenance('正在保存批量金额');
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');

        const current = get();
        const result = confirmAmountBatchProposal({
          channels: current.channels,
          history: current.history,
          baseRevision: current.dataRevision,
        }, proposal);
        if (!result.changed) return;

        const newTotal = totalAssets(result.channels);
        const crossed = crossedLevelAchievements(proposal.oldTotal, newTotal);
        const nextAchievements = crossed.length
          ? mergeLevelAchievements(current.levelAchievements, crossed)
          : current.levelAchievements;
        const { event, newGoalAchieved } = detectCelebrations(
          proposal.oldTotal,
          newTotal,
          current.countdown,
          current.goalAchieved,
        );

        // This transaction owns the maintenance lease; commit through the guarded
        // store's internal setter so ordinary writers remain blocked throughout.
        rawSet({
          channels: result.channels,
          history: result.history,
          ...(crossed.length ? { levelAchievements: nextAchievements } : {}),
          ...(newGoalAchieved ? { goalAchieved: newGoalAchieved } : {}),
          ...(event ? { celebration: event } : {}),
        });
        if (event?.goal) get().triggerCoinRain();
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },

    // ---------------------------------------------------------------------
    addHistoryPoint(date, totalAmount, source = 'manual') {
      const incoming: HistoryPoint = {
        date,
        totalAmount: round2(totalAmount),
        source,
        updatedAt: new Date().toISOString(),
        timestamp: Date.now(),
      };
      const result = prepareHistoryUpsert(get().history, incoming);
      if (!result.ok) {
        // 同日期唯一：不静默覆盖，返回冲突交给 UI 处理
        return { conflict: true, existing: result.existing };
      }
      set({ history: result.history });
      persist();
      return { conflict: false };
    },
    overwriteHistoryPoint(date, totalAmount, source = 'manual') {
      const incoming: HistoryPoint = {
        date,
        totalAmount: round2(totalAmount),
        source,
        updatedAt: new Date().toISOString(),
        timestamp: Date.now(),
      };
      set((s) => ({ history: overwriteHistoryPoint(s.history, incoming) }));
      persist();
    },
    updateHistoryPoint(date, totalAmount) {
      set((s) => ({
        history: s.history.map((h) => (h.date === date ? { ...h, totalAmount: round2(totalAmount), updatedAt: new Date().toISOString() } : h)),
      }));
      persist();
    },
    async setHistoryEventNote(date, note, baseRevision) {
      if (typeof note !== 'string' || note.length > 2000) throw new Error('事件备注最多 2000 字');
      const assertCurrent = () => {
        const state = get();
        if (state.dataRevision !== baseRevision) throw new Error('数据已变化，请重新打开备注');
        if (state.history.filter(point => point.date === date).length !== 1) throw new Error('历史日期不存在或重复，请先检查数据');
        return state;
      };
      const normalizedNote = note.trim();
      const initial = assertCurrent();
      if ((initial.history.find(point => point.date === date)?.eventNote ?? '') === normalizedNote) return;
      const release = beginLedgerMaintenance('正在保存事件备注');
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');
        const current = assertCurrent();
        rawSet({ history: current.history.map(point => point.date === date
          ? { ...point, eventNote: normalizedNote || undefined, eventNoteUpdatedAt: new Date().toISOString() }
          : point) });
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },
    prepareHistoryEdit(command, baseRevision) {
      const state = get();
      if (state.dataRevision !== baseRevision) throw new Error('数据已变化，请重新打开历史记录');
      return buildHistoryEdit({ history: state.history, baseRevision }, command);
    },
    async confirmHistoryEdit(proposal, overwrite = false) {
      const validate = () => checkHistoryEdit({ history: get().history, baseRevision: get().dataRevision }, proposal, overwrite);
      if (!validate().changed) return;
      const release = beginLedgerMaintenance('正在保存历史变更');
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');
        const result = validate();
        rawSet({ history: result.history });
        persist();
        await storageService.flush();
      } finally {
        release();
      }
    },
    deleteHistoryPoint(date) {
      set((s) => ({ history: s.history.filter((h) => h.date !== date) }));
      persist();
    },
    deleteHistoryPoints(dates) {
      const set_ = new Set(dates);
      set((s) => ({ history: s.history.filter((h) => !set_.has(h.date)) }));
      persist();
    },
    prepareWeeklySnapshot(referenceDate) {
      const s = get();
      const total = totalAssets(s.channels);
      const snapshotChannels: Channel[] = s.channels.map((c) => ({
        ...c,
        children: c.children ? c.children.map((child) => ({ ...child })) : undefined,
      }));
      const snapshot: HistoryPoint = {
        date: referenceDate,
        totalAmount: total,
        channels: snapshotChannels,
        wealthLevel: getLevelByAmount(total).name,
        timestamp: Date.now(),
        updatedAt: new Date().toISOString(),
        source: 'weekly-report',
      };
      const existing = s.history.find((h) => h.date === referenceDate);
      if (!existing) return { conflict: false, identical: false, snapshot };
      const identical = existing.totalAmount === total && JSON.stringify(existing.channels ?? null) === JSON.stringify(snapshotChannels);
      if (identical) return { conflict: false, identical: true, snapshot };
      return { conflict: true, identical: false, snapshot, existing };
    },
    commitWeeklySnapshot(snapshot) {
      set((s) => ({ history: overwriteHistoryPoint(s.history, snapshot) }));
      persist();
    },

    // Report writes use prepareReport/confirmReport so conflict approval,
    // revision checks, backups, and report projections share one path.
    prepareReport(type, referenceDate = todayString()) {
      return prepareReportGeneration({ ...get(), baseRevision: get().dataRevision }, type, referenceDate);
    },
    async confirmReport(proposal, approval = {}) {
      const initial = confirmReportProposal({ ...get(), baseRevision: get().dataRevision }, proposal, approval);
      if (!initial.changed) return initial.report;
      const release = beginLedgerMaintenance('正在保存报告和快照');
      try {
        await storageService.flush();
        const mgr = storageService.getDesktopManager();
        if (mgr && !(await mgr.backupNow(true))) throw new Error('操作前备份不可用');
        const result = confirmReportProposal({ ...get(), baseRevision: get().dataRevision }, proposal, approval);
        if (result.changed) {
          const previous = get().reports.find((report) => report.id === result.report.id);
          let reportRevisions = get().reportRevisions;
          if (previous) reportRevisions = await ensureReportBaseSnapshot(reportRevisions, previous, get().dataRevision);
          reportRevisions = await appendReportSnapshot(reportRevisions, result.report, 'generated', get().dataRevision);
          rawSet({ history: result.history, reports: result.reports, reportRevisions });
          persist([STORAGE_KEYS.wealthTrackerData, STORAGE_KEYS.financialReports, STORAGE_KEYS.reportRevisions]);
          await storageService.flush();
          if (mgr) await drainReportProjection();
        }
        return result.report;
      } finally {
        release();
      }
    },
    async updateReportMetadata(id, patch, baseRevision = get().dataRevision) {
      const allowed = ['titleMode', 'standardTitle', 'customTitle', 'tags', 'customSummary', 'archiveNote'];
      if (Object.keys(patch).some(field => !allowed.includes(field))) throw new Error('元数据编辑包含不允许的字段');
      await commitReportList('正在保存报告备注', baseRevision, reports => reports.map((r) => {
          if (r.id !== id) return r;
          const next: FinancialReport = { ...r, ...patch, revision: (r.revision ?? 1) + 1, updatedAt: new Date().toISOString() };
          if (patch.titleMode === 'custom' && patch.customTitle?.trim()) {
            next.title = patch.customTitle.trim();
          } else if (patch.titleMode === 'auto') {
            next.customTitle = undefined;
            next.title = next.standardTitle ?? next.title;
          }
          return next;
        }));
    },
    async commitReportEdit(id, edited, audit, opts = {}) {
      if (opts.baseRevision !== undefined && opts.baseRevision !== get().dataRevision) throw new Error('数据已变化，请重新打开报告编辑');
      validateLedgerShape(null, [edited]);
      const proposal = prepareReportEdit({ ...get(), baseRevision: get().dataRevision }, id, edited, opts);
      if (proposal.conflicts.some(c => c.kind === 'period')) throw new Error('目标周期已有报告，请选择其他周期');
      const release = beginLedgerMaintenance('正在保存报告编辑');
      try {
        await storageService.flush();
        const mgr = storageService.getDesktopManager();
        if (mgr && !(await mgr.backupNow(true))) throw new Error('操作前备份不可用');
        const result = confirmReportProposal({ ...get(), baseRevision: get().dataRevision }, proposal, { overwriteSnapshot: !!opts.syncHistory });
        const original = get().reports.find(r => r.id === id)!;
        const report = { ...result.report, repairAudit: [...(original.repairAudit ?? []), ...audit],
          fieldProvenance: { ...original.fieldProvenance, ...Object.fromEntries(audit.map(a => [a.field, 'manual-repair' as const])) } };
        let reportRevisions = await ensureReportBaseSnapshot(get().reportRevisions, original, get().dataRevision);
        reportRevisions = await appendReportSnapshot(reportRevisions, report, 'edited', get().dataRevision);
        rawSet({ reports: result.reports.map(r => r.id === id ? report : r), history: result.history, reportRevisions });
        persist([STORAGE_KEYS.wealthTrackerData, STORAGE_KEYS.financialReports, STORAGE_KEYS.reportRevisions]);
        await storageService.flush();
        if (mgr) await drainReportProjection();
        return report;
      } finally {
        release();
      }
    },
    async repairReport(id, repaired, baseRevision) {
      const original = get().reports.find(r => r.id === id);
      if (!original) throw new Error('报告已被删除，请重新打开');
      const addedAudit = (repaired.repairAudit ?? []).filter(a => !(original.repairAudit ?? []).some(existing => JSON.stringify(existing) === JSON.stringify(a)));
      return get().commitReportEdit(id, repaired, addedAudit, { baseRevision });
    },
    async archiveReport(id, note) {
      await commitReportList('正在保存报告归档', get().dataRevision, reports => reports.map(r => r.id === id ? { ...toggleReportArchive(r, note), revision: (r.revision ?? 1) + 1 } : r));
    },
    async deleteReport(id) {
      await get().deleteReports([id]);
    },
    async deleteReports(ids) {
      const set_ = new Set(ids);
      await commitReportList('正在删除所选报告', get().dataRevision, reports => reports.filter(r => !set_.has(r.id)));
    },
    setReportSortSpec(spec) {
      set({ reportSortSpec: spec });
      persist();
    },
    async runMonthlyBackfill(baseRevision = get().dataRevision) {
      const s = get();
      if (baseRevision !== s.dataRevision) throw new Error('数据已变化，请重新预览月报补全');
      const result = runBackfill(s.reports, s.history);
      if (!result.created.length && !result.repaired.length) return { created: [], repaired: [] };
      validateLedgerShape(null, result.reports);
      const release = beginLedgerMaintenance('正在补全历史月报');
      try {
        await storageService.flush();
        const mgr = storageService.getDesktopManager();
        if (mgr && !(await mgr.backupNow(true))) throw new Error('操作前备份不可用');
        if (baseRevision !== get().dataRevision) throw new Error('数据已变化，请重新预览月报补全');
        rawSet({ reports: result.reports });
        persist();
        await storageService.flush();
        if (mgr) await drainReportProjection();
        return { created: result.created, repaired: result.repaired };
      } finally {
        release();
      }
    },

    // ---------------------------------------------------------------------
    addSortRule(rule) {
      const full: CustomSortRule = { ...rule, id: randomId('rule'), createdAt: new Date().toISOString() };
      set((s) => ({ sortRules: [...s.sortRules, full] }));
      persist();
    },
    deleteSortRule(id) {
      set((s) => ({ sortRules: s.sortRules.filter((r) => r.id !== id) }));
      persist();
    },
    recordSortHistory(key, label) {
      const entry = { key, label, timestamp: new Date().toISOString() };
      set((s) => {
        const history = [{ ...entry }, ...s.sortHistory.history.filter((h) => h.key !== key)].slice(0, 10);
        return { sortHistory: { history } };
      });
      persist();
    },
    clearSortHistory() {
      set({ sortHistory: { history: [] } });
      persist();
    },
    setActiveSortKey(key) {
      set({ activeSortKey: key });
      persist();
    },
    togglePinChannel(id) {
      set((s) => {
        const has = s.pinnedChannelIds.includes(id);
        return { pinnedChannelIds: has ? s.pinnedChannelIds.filter((x) => x !== id) : [...s.pinnedChannelIds, id] };
      });
      persist();
    },
    setSmartSortConfig(config) {
      set({ smartSortConfig: config });
      persist();
    },
    setProfile(profile) {
      set({ profile: { ...profile, updatedAt: new Date().toISOString() } });
      persist();
    },
    setAppearance(appearance) {
      set({ appearance });
      persist();
    },
    async setupAccount(displayName, method, secret) {
      const record = await createAuthRecord(secret, method);
      const account: LocalAccount = {
        username: displayName,
        displayName,
        avatarEmoji: '👤',
        lockEnabled: true,
        lockMethod: method,
        autoLockMinutes: 0,
        requireOnLaunch: true,
        created: true,
      };
      set({ account, authRecord: record, locked: false });
      persist();
      return true;
    },
    async login(secret) {
      const record = get().authRecord;
      if (!record) return false;
      const ok = await verifySecret(secret, record);
      if (ok) set({ locked: false });
      return ok;
    },
    logout() {
      set({ locked: true });
    },
    disableAccount() {
      set({ account: null, authRecord: null, locked: false });
      persist();
    },

    // ---------------------------------------------------------------------
    setCountdown(countdown) {
      set({ countdown });
      persist();
    },
    setCountdownOpacity(opacity) {
      const clamped = Math.max(0, Math.min(1, opacity));
      set({ countdownOpacity: clamped });
      persist();
    },
    upsertGoal(goal) {
      set((s) => {
        const exists = s.goals.some((g) => g.id === goal.id);
        const goals = exists
          ? s.goals.map((g) => (g.id === goal.id ? { ...goal, updatedAt: new Date().toISOString() } : g))
          : [...s.goals, { ...goal, updatedAt: new Date().toISOString() }];
        const primaryGoalId = s.primaryGoalId ?? goal.id;
        const primary = goals.find((g) => g.id === primaryGoalId);
        return { goals, primaryGoalId, countdown: primary ? countdownFromGoal(primary) : s.countdown };
      });
      persist();
    },
    deleteGoal(id) {
      set((s) => {
        const goals = s.goals.filter((g) => g.id !== id);
        let primaryGoalId = s.primaryGoalId;
        if (primaryGoalId === id) primaryGoalId = goals[0]?.id ?? null;
        const primary = primaryGoalId ? goals.find((g) => g.id === primaryGoalId) : undefined;
        return { goals, primaryGoalId, countdown: primary ? countdownFromGoal(primary) : s.countdown };
      });
      persist();
    },
    setPrimaryGoal(id) {
      set((s) => {
        const primary = s.goals.find((g) => g.id === id);
        return { primaryGoalId: id, countdown: primary ? countdownFromGoal(primary) : s.countdown };
      });
      persist();
    },

    // ---------------------------------------------------------------------
    // Lottery（独立资金池，不影响财富资产）
    addLotteryTransaction(tx) {
      set((s) => ({ lottery: { ...s.lottery, transactions: [tx, ...s.lottery.transactions] } }));
      persist();
    },
    updateLotteryTransaction(id, tx) {
      set((s) => ({
        lottery: {
          ...s.lottery,
          transactions: s.lottery.transactions.map((t) => (t.id === id ? { ...tx, id, updatedAt: new Date().toISOString() } : t)),
        },
      }));
      persist();
    },
    deleteLotteryTransaction(id) {
      set((s) => ({ lottery: { ...s.lottery, transactions: s.lottery.transactions.filter((t) => t.id !== id) } }));
      persist();
      get().logActivity('lottery-transaction-delete', '删除一笔彩票交易', 'lottery', id);
    },
    importLotteryTransactions(txs) {
      const existingFps = new Set(get().lottery.transactions.map((t) => t.importFingerprint).filter((f): f is string => !!f));
      const added = txs.filter((t) => !t.importFingerprint || !existingFps.has(t.importFingerprint));
      if (added.length === 0) return 0;
      set((s) => ({ lottery: { ...s.lottery, transactions: [...added, ...s.lottery.transactions] } }));
      persist();
      return added.length;
    },
    upsertLotteryProject(project) {
      set((s) => {
        const exists = s.lottery.projects.some((p) => p.id === project.id);
        const projects = exists
          ? s.lottery.projects.map((p) => (p.id === project.id ? { ...project, updatedAt: new Date().toISOString() } : p))
          : [...s.lottery.projects, { ...project, updatedAt: new Date().toISOString() }];
        return { lottery: { ...s.lottery, projects } };
      });
      persist();
    },
    deleteLotteryProject(id) {
      set((s) => ({ lottery: { ...s.lottery, projects: s.lottery.projects.filter((p) => p.id !== id) } }));
      persist();
    },
    archiveLotteryProject(id) {
      set((s) => ({
        lottery: {
          ...s.lottery,
          projects: s.lottery.projects.map((p) =>
            p.id === id ? { ...p, status: 'archived' as const, updatedAt: new Date().toISOString() } : p,
          ),
        },
      }));
      persist();
    },
    setLotteryPool(pool) {
      set((s) => ({ lottery: { ...s.lottery, pool } }));
      persist();
    },
    setLotterySettings(settings) {
      set((s) => ({ lottery: { ...s.lottery, settings } }));
      persist();
    },
    applyLotteryExcelImport(preview) {
      const s = get();
      const existingProjectIds = new Set(s.lottery.projects.map((p) => p.id));
      const newProjects = preview.projects.filter((p) => !existingProjectIds.has(p.id));
      const existingFps = new Set(s.lottery.transactions.map((t) => t.importFingerprint).filter((f): f is string => !!f));
      const newTxs = preview.transactions.filter((t) => !t.importFingerprint || !existingFps.has(t.importFingerprint));
      if (newProjects.length === 0 && newTxs.length === 0) return { projectsAdded: 0, transactionsAdded: 0 };
      set((state) => ({
        lottery: {
          ...state.lottery,
          projects: [...state.lottery.projects, ...newProjects],
          transactions: [...newTxs, ...state.lottery.transactions],
        },
      }));
      persist();
      get().logActivity('lottery-import', `导入彩票 Excel：新增 ${newProjects.length} 个项目、${newTxs.length} 笔交易`, 'lottery', undefined);
      return { projectsAdded: newProjects.length, transactionsAdded: newTxs.length };
    },

    // ---------------------------------------------------------------------
    // Activity Log（不记录完整资产 JSON / 密码 / PIN）
    logActivity(type, description, entityType, entityId) {
      const entry: ActivityLogEntry = {
        id: uuid(),
        type,
        timestamp: new Date().toISOString(),
        entityType,
        entityId,
        description,
      };
      set((s) => ({ activityLog: [entry, ...s.activityLog].slice(0, 500) }));
      persist();
    },
    markGoalAchieved() {
      set({ goalAchieved: { hasAchievedGoal: true } });
      persist();
    },
    resetGoal() {
      set({ goalAchieved: { hasAchievedGoal: false } });
      persist();
    },

    // ---------------------------------------------------------------------
    setCoinRainConfig(config) {
      set({ coinRainConfig: config });
      persist();
    },
    setChartSettings(settings) {
      set({ chartSettings: settings });
      persist();
    },
    triggerCoinRain() {
      if (get().coinRainConfig.intensity === 'off') return;
      set({ coinRainActive: true });
    },
    stopCoinRain() {
      set({ coinRainActive: false });
    },

    // ---------------------------------------------------------------------
    async exportData() {
      const s = get();
      const source: BackupSource = {
        channels: s.channels,
        history: s.history,
        reports: s.reports,
        sortRules: s.sortRules.filter((r) => !r.isSystem),
        countdown: s.countdown,
        goalAchieved: s.goalAchieved,
        countdownOpacity: s.countdownOpacity,
        coinRainConfig: s.coinRainConfig,
        chartSettings: s.chartSettings,
        sortHistory: s.sortHistory,
        timeRangeHistory: s.timeRangeHistory,
        countdownProgressHistory: s.countdownProgressHistory,
        currentWealthLevel: s.currentWealthLevel,
        wealthTrackerHistory: s.wealthTrackerHistory,
        lottery: s.lottery,
        goals: { goals: s.goals, primaryGoalId: s.primaryGoalId },
        levelAchievements: s.levelAchievements,
        monthlyPlanning: s.monthlyPlanning,
        assetClassification: s.assetClassification,
      };
      const backup = buildBackup(source);
      const text = JSON.stringify(backup, null, 2);
      const filename = backupFilename();
      await saveTextFile(filename, text);
      get().pushToast(`数据已成功导出为 ${filename}`, 'success');
    },
    async importData(jsonText, mode = 'replace', baseRevision = get().dataRevision) {
      const result = parseBackup(jsonText);
      if (!result.ok) return { ok: false, message: result.error };
      if (baseRevision !== get().dataRevision) throw new Error('数据已变化，请重新预览导入');
      const d: ImportedData = result.data;
      const release = beginLedgerMaintenance('正在导入数据');
      try {
      await storageService.flush();
      const mgr = storageService.getDesktopManager();
      if (mgr && !(await mgr.backupNow(true))) throw new Error('操作前备份不可用');
      if (baseRevision !== get().dataRevision) throw new Error('数据已变化，请重新预览导入');
      if (mode === 'merge') {
        const s = get();
        const merged = mergeData(
          { channels: s.channels, history: s.history, reports: s.reports },
          { channels: d.channels, history: d.history, reports: d.reports },
        );
        validateLedgerShape({ channels: merged.channels, history: merged.history }, merged.reports);
        rawSet({
          channels: normalizeChannelAmounts(merged.channels),
          history: merged.history,
          reports: merged.reports,
          assetClassification: d.assetClassification
            ? mergeAssetClassificationStates(s.assetClassification, d.assetClassification)
            : s.assetClassification,
        });
        persist();
        await storageService.flush();
        if (mgr) await drainReportProjection();
        return { ok: true, message: `合并导入成功：渠道 ${merged.channels.length} 个、历史 ${merged.history.length} 条、报告 ${merged.reports.length} 份` };
      }

      rawSet({
        channels: normalizeChannelAmounts(d.channels),
        history: d.history,
        reports: d.reports,
        sortRules: d.sortRules.length ? d.sortRules : defaultSortRules(),
        countdown: d.countdown,
        goalAchieved: d.goalAchieved,
        countdownOpacity: d.countdownOpacity,
        coinRainConfig: d.coinRainConfig ?? defaultCoinRainConfig(),
        chartSettings: d.chartSettings ?? defaultChartSettings(),
        sortHistory: d.sortHistory ?? { history: [] },
        timeRangeHistory: d.timeRangeHistory ?? { records: [] },
        countdownProgressHistory: d.countdownProgressHistory ?? [],
        currentWealthLevel: d.currentWealthLevel ?? { level: '' },
        wealthTrackerHistory: d.wealthTrackerHistory ?? [],
        levelAchievements: d.levelAchievements ?? deriveLevelAchievements(d.history),
        lottery: d.lottery ?? defaultLotteryState(),
        goals: d.goals?.goals ?? [],
        primaryGoalId: d.goals?.primaryGoalId ?? null,
        assetClassification: d.assetClassification ?? emptyAssetClassificationState(),
      });
      persist();
      await storageService.flush();
      if (mgr) await drainReportProjection();
      return {
        ok: true,
        message: `导入成功：${d.channels.length} 个渠道、${d.history.length} 条历史记录${
          d.reports.length ? `、${d.reports.length} 份报告` : ''
        }`,
      };
      } finally { release(); }
    },
    async applyDataFixes(baseRevision = get().dataRevision, fix) {
      const s = get();
      if (baseRevision !== s.dataRevision) throw new Error('数据已变化，请重新预览修复');
      const { issues } = checkDataHealth(s.channels, s.history);
      const scoped = fix ? issues.filter((issue) => issue.fix === fix) : issues;
      if (scoped.length === 0) return { fixed: 0 };
      const { channels, history, fixed } = applyHealthFixes(s.channels, s.history, scoped);
      if (!fixed) return { fixed: 0 };
      const release = beginLedgerMaintenance('正在修复数据');
      try {
        await storageService.flush();
        const mgr = storageService.getDesktopManager();
        if (mgr && !(await mgr.backupNow(true))) throw new Error('操作前备份不可用');
        if (baseRevision !== get().dataRevision) throw new Error('数据已变化，请重新预览修复');
        // Only use the reviewed fix output. Global normalization could silently
        // rewrite unrelated amounts or erase unresolved evidence.
        rawSet({ channels, history });
        persist();
        await storageService.flush();
        return { fixed };
      } finally { release(); }
    },
    async commitHealthFix(proposal) {
      const snapshot = (): HealthScanInput => {
        const state = get();
        return {
          channels: state.channels,
          history: state.history,
          reports: state.reports,
          goals: state.goals,
          primaryGoalId: state.primaryGoalId,
          levelAchievements: state.levelAchievements,
          lottery: state.lottery,
          monthlyPlanning: state.monthlyPlanning,
          assetClassification: state.assetClassification,
        };
      };
      const initial = get();
      assertHealthFixProposal(snapshot(), initial.dataRevision, proposal);
      const release = beginLedgerMaintenance('正在应用单项健康修复');
      try {
        await storageService.flush();
        const manager = storageService.getDesktopManager();
        if (manager && !(await manager.backupNow(true))) throw new Error('操作前备份不可用');
        const current = get();
        assertHealthFixProposal(snapshot(), current.dataRevision, proposal);
        const audit: ActivityLogEntry = {
          id: crypto.randomUUID(),
          type: 'health-fix',
          timestamp: new Date().toISOString(),
          entityType: 'health-issue',
          entityId: proposal.issueId,
          description: `${proposal.summary}；操作 ${proposal.operationId}`,
        };
        rawSet({
          channels: proposal.after.channels,
          history: proposal.after.history,
          activityLog: [audit, ...current.activityLog].slice(0, 200),
        });
        persist([STORAGE_KEYS.wealthTrackerData, STORAGE_KEYS.activityLog]);
        await storageService.flush();
        const issueStillExists = checkDataHealth(get().channels, get().history).issues
          .some((issue) => issue.id === proposal.issueId && issue.fingerprint === proposal.issueFingerprint);
        if (issueStillExists) throw new Error('修复已写入，但重新扫描仍发现同一问题；请立即核对备份');
        consumeHealthFixProposal(proposal);
        return { fixed: 1 };
      } finally {
        release();
      }
    },
  };
});

storageService.registerDrainHook(() => persistNow(useAppStore.getState));

/** Reserve synchronously before the first await; the owner must always release in finally. */
export function beginLedgerMaintenance(label: string): () => void {
  const state = useAppStore.getState();
  if (!state.hydrated || state.recoveryError) throw new Error('当前数据不可编辑，请先完成恢复');
  if (state.maintenanceLabel) throw new Error(`${state.maintenanceLabel}，请等待完成`);
  useAppStore.setState({ maintenanceLabel: label });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    useAppStore.setState({ maintenanceLabel: null });
  };
}

useAppStore.subscribe((state, previous) => {
  const protectedDataChanged = state.channels !== previous.channels
    || state.history !== previous.history
    || state.reports !== previous.reports
    || state.monthlyPlanning !== previous.monthlyPlanning
    || state.assetClassification !== previous.assetClassification
    || state.goals !== previous.goals
    || state.primaryGoalId !== previous.primaryGoalId
    || state.lottery !== previous.lottery;
  if (state.hydrated && previous.hydrated && protectedDataChanged) {
    useAppStore.setState({ dataRevision: state.dataRevision + 1 });
    schedulePersist(useAppStore.getState, [STORAGE_KEYS.dataRevision]);
  }
  if (state.hydrated && state.reports !== previous.reports && storageService.getDesktopManager()) {
    const queue = enqueueReportProjection(useAppStore.getState().reportProjectionQueue, previous.reports, state.reports);
    if (queue !== useAppStore.getState().reportProjectionQueue) {
      useAppStore.setState({ reportProjectionQueue: queue });
      schedulePersist(useAppStore.getState);
    }
  }
});

/** 派生：当前总资产。 */
export function selectTotalAssets(s: AppState): number {
  return totalAssets(s.channels);
}
