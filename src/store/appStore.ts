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
import { storageService } from '../services/storage';
import {
  buildBackup,
  parseBackup,
  type BackupSource,
  type ImportedData,
} from '../services/export';
import { saveTextFile, backupFilename } from '../services/export/download';
import { generateReport, toggleReportArchive } from '../features/reports/generate';
import { normalizeFinancialReport } from '../features/reports/normalize';
import { runBackfill } from '../features/reports/backfill';
import { reportFileBase, reportHtml } from '../features/reports/reportFile';
import { buildReportIndex } from '../features/reports/reportIndex';
import { migrateChannelsV12, migrateChannelsV15, migrateReportsV13, needsV12Migration, needsV15Migration } from '../services/migration';
import { DEFAULT_REPORT_SORT, type ReportSortSpec } from '../features/reports/reportSort';
import { detectCelebrations, type CelebrationEvent } from '../utils/celebrate';
import { DEFAULT_SMART_CONFIG } from '../utils/smartSort';
import { mergeData } from '../utils/mergeData';
import { checkDataHealth, applyHealthFixes } from '../utils/dataHealth';
import { createAuthRecord, verifySecret, type AuthRecord } from '../utils/auth';
import {
  crossedLevelAchievements,
  deriveLevelAchievements,
  mergeLevelAchievements,
} from '../utils/levelAchievements';
import { countdownFromGoal, countdownToGoal } from '../utils/goals';
import { defaultLotteryState } from '../features/lottery/lotteryMath';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface AppState {
  // 运行时状态
  hydrated: boolean;
  toasts: Toast[];
  coinRainActive: boolean;
  /** 当前庆祝事件（等级升级 / 目标达成），由 CelebrationOverlay 消费。 */
  celebration: CelebrationEvent | null;

  // 业务数据（持久化）
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
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

  // ---- 历史 ----
  addHistoryPoint: (date: string, totalAmount: number, source?: HistorySource) => { conflict: boolean; existing?: HistoryPoint };
  overwriteHistoryPoint: (date: string, totalAmount: number, source?: HistorySource) => void;
  updateHistoryPoint: (date: string, totalAmount: number) => void;
  deleteHistoryPoint: (date: string) => void;
  deleteHistoryPoints: (dates: string[]) => void;
  /** 构造周报生成的 Daily Snapshot 并检查当天 History 冲突（不写入）。 */
  prepareWeeklySnapshot: (referenceDate: string) => { conflict: boolean; identical: boolean; snapshot: HistoryPoint; existing?: HistoryPoint };
  /** 写入周报 Daily Snapshot（创建或覆盖当天，一天一条）。 */
  commitWeeklySnapshot: (snapshot: HistoryPoint) => void;

  // ---- 报告 ----
  generateReportNow: (reportType: ReportType, referenceDate?: string) => FinancialReport;
  /** 写入报告：同周期唯一——有 existing 则更新（递增 revision、保留自定义元数据），否则新建。 */
  commitReport: (generated: FinancialReport, existing?: FinancialReport) => FinancialReport;
  updateReportMetadata: (id: string, patch: Partial<Pick<FinancialReport, 'titleMode' | 'standardTitle' | 'customTitle' | 'tags' | 'customSummary' | 'archiveNote'>>) => void;
  /** 高级编辑报告全字段（记录 manual-report-edit 审计；可选择同步对应 History）。 */
  commitReportEdit: (id: string, edited: FinancialReport, audit: ReportRepairAudit[], opts?: { syncHistory?: boolean }) => FinancialReport;
  repairReport: (id: string, repaired: FinancialReport) => void;
  archiveReport: (id: string, note?: string) => void;
  deleteReport: (id: string) => void;
  deleteReports: (ids: string[]) => void;
  setReportSortSpec: (spec: ReportSortSpec) => void;
  /** 补生成缺失的历史月度报告（幂等，返回 create/repair 的 periodKey）。 */
  runMonthlyBackfill: () => { created: string[]; repaired: string[] };

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
  importData: (jsonText: string, mode?: 'replace' | 'merge') => Promise<{ ok: boolean; message: string }>;
  applyDataFixes: () => Promise<{ fixed: number }>;
}

const PERSIST_KEYS: Array<{ key: string; pick: (s: AppState) => unknown }> = [
  {
    key: STORAGE_KEYS.wealthTrackerData,
    pick: (s) => ({ channels: s.channels, history: s.history }),
  },
  { key: STORAGE_KEYS.financialReports, pick: (s) => s.reports },
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
];

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(get: () => AppState): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const s = get();
    if (!s.hydrated) return;
    for (const { key, pick } of PERSIST_KEYS) {
      await storageService.setJSON(key, pick(s));
    }
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

export const useAppStore = create<AppState>()((set, get) => {
  const persist = () => schedulePersist(get);

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
    toasts: [],
    coinRainActive: false,
    celebration: null,

    channels: [],
    history: [],
    reports: [],
    sortRules: [],
    sortHistory: { history: [] },
    activeSortKey: 'default',
    pinnedChannelIds: [],
    reportSortSpec: DEFAULT_REPORT_SORT,
    smartSortConfig: DEFAULT_SMART_CONFIG,
    profile: { defaultCurrency: 'CNY' },
    appearance: { themeMode: 'system', followWealthTheme: true, animationIntensity: 'normal', backgroundOpacity: 30, reduceMotion: 'system' },
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

    // ---------------------------------------------------------------------
    async hydrate() {
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
      ]);

      const isFirstRun = !wtd;
      const storedVersion = await storageService.getRaw(STORAGE_VERSION_KEY);
      let channels = wtd?.channels?.length ? wtd.channels : defaultChannels();
      const history = wtd?.history?.length ? wtd.history : defaultHistory();

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

      set({
        channels: normalizeChannelAmounts(channels),
        history,
        reports: normalizedReports,
        sortRules: allRules,
        sortHistory: sortHistory ?? { history: [] },
        activeSortKey: sortConfig?.activeKey ?? 'default',
        pinnedChannelIds: sortConfig?.pinned ?? [],
        reportSortSpec: reportSortSettings ?? DEFAULT_REPORT_SORT,
        smartSortConfig: smartSortConfig ?? DEFAULT_SMART_CONFIG,
        profile: profile ?? { defaultCurrency: 'CNY' },
        appearance: appearance ?? { themeMode: 'system', followWealthTheme: true, animationIntensity: 'normal', backgroundOpacity: 30, reduceMotion: 'system' },
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
        hydrated: true,
      });

      // 版本升级检测：先备份再写回新版本号（仅桌面文件存储有意义）。
      if (!isFirstRun && storedVersion !== APP_VERSION) {
        const mgr = storageService.getDesktopManager();
        if (mgr) await mgr.backupNow(true);
        await storageService.setRaw(STORAGE_VERSION_KEY, APP_VERSION);
        // 报告 schema 升级：备份成功后持久化规范化报告，并用新渲染器重写桌面 JSON/HTML。
        if (reportMigration.changed > 0) {
          await storageService.setJSON(STORAGE_KEYS.financialReports, normalizedReports);
          if (mgr) {
            for (const r of normalizedReports) {
              void mgr.writeReport(r.reportType, reportFileBase(r), JSON.stringify(r, null, 2), reportHtml(r)).catch(() => {});
            }
            void mgr.writeReportIndex(JSON.stringify(buildReportIndex(normalizedReports), null, 2)).catch(() => {});
          }
        }
        if (migrationNote) get().pushToast(migrationNote, 'info');
      }

      if (isFirstRun) {
        // 首次运行：写入默认数据与版本号，保证刷新后仍在。
        await storageService.setRaw(STORAGE_VERSION_KEY, APP_VERSION);
        persist();
      }
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

    // ---------------------------------------------------------------------
    generateReportNow(reportType, referenceDate = todayString()) {
      const s = get();
      const generated = generateReport(s.history, reportType, referenceDate, s.channels);
      const existing = s.reports.find((r) => r.periodKey && r.periodKey === generated.periodKey);
      return get().commitReport(generated, existing);
    },
    commitReport(generated, existing) {
      const s = get();
      let report: FinancialReport;
      let reports: FinancialReport[];

      if (existing) {
        // 同周期唯一：绝不新增第二份 canonical report，只更新现有报告（递增 revision、保留自定义元数据与归档状态）。
        const prev = existing;
        const custom = prev.titleMode === 'custom' && prev.customTitle?.trim();
        report = {
          ...generated,
          id: prev.id,
          createdAt: prev.createdAt,
          revision: (prev.revision ?? 1) + 1,
          updatedAt: new Date().toISOString(),
          isArchived: prev.isArchived,
          archivedAt: prev.archivedAt,
          archiveNote: prev.archiveNote,
          // 保留用户自定义元数据
          titleMode: prev.titleMode ?? 'auto',
          standardTitle: generated.standardTitle ?? generated.title,
          customTitle: prev.customTitle,
          title: custom ? prev.customTitle! : generated.title,
          tags: prev.tags,
          customSummary: prev.customSummary,
          repairAudit: prev.repairAudit,
          fieldProvenance: prev.fieldProvenance,
        };
        reports = s.reports.map((r) => (r.id === prev.id ? report : r));
      } else {
        report = generated;
        reports = [report, ...s.reports];
      }

      set({ reports });
      persist();
      const mgr = storageService.getDesktopManager();
      if (mgr) {
        void (async () => {
          try {
            await mgr.writeReport(report.reportType, reportFileBase(report), JSON.stringify(report, null, 2), reportHtml(report));
            await mgr.writeReportIndex(JSON.stringify(buildReportIndex(reports), null, 2));
          } catch (err) {
            console.warn('[reports] 报告写盘失败:', err);
          }
        })();
      }
      const updated = !!existing;
      const verb = updated ? '已更新' : '已生成';
      get().pushToast(`${verb}报告「${report.title}」`, 'success');
      get().logActivity(
        updated ? 'report-update' : 'report-create',
        updated ? `更新报告「${report.title}」至 Revision ${report.revision}` : `生成报告「${report.title}」`,
        'report',
        report.id,
      );
      return report;
    },
    updateReportMetadata(id, patch) {
      set((s) => ({
        reports: s.reports.map((r) => {
          if (r.id !== id) return r;
          const next: FinancialReport = { ...r, ...patch, updatedAt: new Date().toISOString() };
          if (patch.titleMode === 'custom' && patch.customTitle?.trim()) {
            next.title = patch.customTitle.trim();
          } else if (patch.titleMode === 'auto') {
            next.customTitle = undefined;
            next.title = next.standardTitle ?? next.title;
          }
          return next;
        }),
      }));
      persist();
    },
    commitReportEdit(id, edited, audit, opts = {}) {
      const normalized = normalizeFinancialReport({ ...edited, reportSchemaVersion: 4 });
      const now = new Date().toISOString();
      set((s) => ({
        reports: s.reports.map((r) =>
          r.id === id
            ? {
                ...normalized,
                id,
                repairAudit: [...(r.repairAudit ?? []), ...audit],
                fieldProvenance: {
                  ...(r.fieldProvenance ?? {}),
                  ...Object.fromEntries(audit.map((a) => [a.field, 'manual-repair' as const])),
                },
                updatedAt: now,
              }
            : r,
        ),
      }));
      persist();

      // 可选：同步修正 dataAsOf 对应的 Daily History
      if (opts.syncHistory && normalized.dataAsOf) {
        const s = get();
        const existing = s.history.find((h) => h.date === normalized.dataAsOf);
        if (existing) {
          set((state) => ({
            history: overwriteHistoryPoint(state.history, {
              ...existing,
              totalAmount: normalized.totalAmount,
              channels: normalized.channels,
              wealthLevel: normalized.wealthLevelName ?? existing.wealthLevel,
              source: 'manual',
              updatedAt: now,
            }),
          }));
          persist();
        }
      }

      const mgr = storageService.getDesktopManager();
      if (mgr) {
        void mgr.writeReport(normalized.reportType, reportFileBase(normalized), JSON.stringify(normalized, null, 2), reportHtml(normalized)).catch(() => {});
      }
      return normalized;
    },
    repairReport(id, repaired) {
      set((s) => ({ reports: s.reports.map((r) => (r.id === id ? repaired : r)) }));
      persist();
      const mgr = storageService.getDesktopManager();
      if (mgr) {
        void mgr
          .writeReport(repaired.reportType, reportFileBase(repaired), JSON.stringify(repaired, null, 2), reportHtml(repaired))
          .catch(() => {});
      }
    },
    archiveReport(id, note) {
      set((s) => ({
        reports: s.reports.map((r) => (r.id === id ? toggleReportArchive(r, note) : r)),
      }));
      persist();
    },
    deleteReport(id) {
      set((s) => ({ reports: s.reports.filter((r) => r.id !== id) }));
      persist();
    },
    deleteReports(ids) {
      const set_ = new Set(ids);
      set((s) => ({ reports: s.reports.filter((r) => !set_.has(r.id)) }));
      persist();
    },
    setReportSortSpec(spec) {
      set({ reportSortSpec: spec });
      persist();
    },
    runMonthlyBackfill() {
      const s = get();
      const result = runBackfill(s.reports, s.history);
      set({ reports: result.reports });
      persist();
      if (result.created.length > 0) {
        get().logActivity('report-backfill', `补生成 ${result.created.length} 份历史月报`, 'reports');
      }
      return { created: result.created, repaired: result.repaired };
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
      };
      const backup = buildBackup(source);
      const text = JSON.stringify(backup, null, 2);
      const filename = backupFilename();
      await saveTextFile(filename, text);
      get().pushToast(`数据已成功导出为 ${filename}`, 'success');
    },
    async importData(jsonText, mode = 'replace') {
      const result = parseBackup(jsonText);
      if (!result.ok) return { ok: false, message: result.error };

      // 导入前先备份当前数据（桌面版），避免误操作造成资产数据丢失。
      const mgr = storageService.getDesktopManager();
      if (mgr) await mgr.backupNow(true);

      const d: ImportedData = result.data;
      if (mode === 'merge') {
        const s = get();
        const merged = mergeData(
          { channels: s.channels, history: s.history, reports: s.reports },
          { channels: d.channels, history: d.history, reports: d.reports },
        );
        set({ channels: normalizeChannelAmounts(merged.channels), history: merged.history, reports: merged.reports });
        persist();
        return { ok: true, message: `合并导入成功：渠道 ${merged.channels.length} 个、历史 ${merged.history.length} 条、报告 ${merged.reports.length} 份` };
      }

      set({
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
      });
      persist();
      return {
        ok: true,
        message: `导入成功：${d.channels.length} 个渠道、${d.history.length} 条历史记录${
          d.reports.length ? `、${d.reports.length} 份报告` : ''
        }`,
      };
    },
    async applyDataFixes() {
      const s = get();
      const { issues } = checkDataHealth(s.channels, s.history);
      if (issues.length === 0) return { fixed: 0 };
      const mgr = storageService.getDesktopManager();
      if (mgr) await mgr.backupNow(true);
      const { channels, history, fixed } = applyHealthFixes(s.channels, s.history, issues);
      set({ channels: normalizeChannelAmounts(channels), history });
      persist();
      get().logActivity('data-repair', `数据健康修复：${fixed} 类问题（修复前已备份）`, 'data');
      return { fixed };
    },
  };
});

/** 派生：当前总资产。 */
export function selectTotalAssets(s: AppState): number {
  return totalAssets(s.channels);
}
