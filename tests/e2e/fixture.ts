import type { Channel, FinancialReport, Goal, HistoryPoint, LotteryState } from '../../src/types';
import { STORAGE_KEYS } from '../../src/constants/storageKeys';
import { APP_VERSION, STORAGE_VERSION_KEY } from '../../src/constants/version';
import { emptyMonthlyPlanningState } from '../../src/services/monthlyPlanning/storage';
import { emptyAssetClassificationState } from '../../src/domain/assets/classification';
import { emptyGoalScenarioState, emptyHealthReviewState, emptyReportRevisionState, emptyWorkspaceViewState } from '../../src/domain/workspace/state';
import { createFinanceDraftSession } from '../../src/domain/portfolio/session';
import type { Holding, HoldingObservation } from '../../src/domain/portfolio/types';

const today = '2026-11-08';

function channels(scale = 1): Channel[] {
  const money = (value: number) => Math.round(value * scale * 100) / 100;
  return [
    {
      id: 'alipay', name: '支付宝', emoji: '💙', amount: 0, color: '#3b82f6', isParent: true, isExpanded: true,
      children: [
        { id: 'alipay_fund', name: '基金', emoji: '📈', amount: money(186_000), color: '#3b82f6', parentId: 'alipay' },
        { id: 'alipay_gold', name: '银行黄金', emoji: '🥇', amount: money(42_000), color: '#d97706', parentId: 'alipay' },
        { id: 'alipay_yue', name: '余额宝', emoji: '💵', amount: money(31_000), color: '#0ea5e9', parentId: 'alipay' },
      ],
    },
    {
      id: 'wechat', name: '微信', emoji: '💚', amount: money(22_000), color: '#22c55e', isParent: true, isExpanded: true,
    },
    {
      id: 'bank', name: '银行卡', emoji: '🏦', amount: 0, color: '#64748b', isParent: true, isExpanded: true,
      children: [
        { id: 'bank_cash', name: '活期', emoji: '💳', amount: money(68_000), color: '#64748b', parentId: 'bank' },
        { id: 'bank_fixed', name: '定期', emoji: '🔒', amount: money(90_000), color: '#475569', parentId: 'bank' },
      ],
    },
  ];
}

function snapshot(date: string, scale: number): HistoryPoint {
  const snapshotChannels = channels(scale);
  const total = snapshotChannels.reduce((sum, channel) => sum + (channel.children?.reduce((childSum, child) => childSum + child.amount, 0) ?? channel.amount), 0);
  return {
    date,
    totalAmount: Math.round(total * 100) / 100,
    channels: snapshotChannels,
    source: 'manual',
    timestamp: Date.parse(`${date}T10:00:00+08:00`),
    updatedAt: `${date}T10:00:00+08:00`,
  };
}

const history = [
  snapshot('2026-05-01', 0.82),
  snapshot('2026-06-01', 0.86),
  snapshot('2026-07-01', 0.9),
  snapshot('2026-08-01', 0.91),
  snapshot('2026-09-01', 0.95),
  snapshot('2026-10-01', 0.97),
  snapshot('2026-10-15', 0.99),
  snapshot('2026-11-01', 1.01),
  snapshot('2026-11-05', 1.02),
  snapshot('2026-11-08', 1.03),
];

function report(id: string, month: string, total: number): FinancialReport {
  return {
    id,
    reportType: 'monthly',
    startDate: `${month}-01`,
    endDate: `${month}-31`,
    title: `${month} 月度财务报告`,
    totalAmount: total,
    changeAmount: 4_200,
    changePercentage: 1.02,
    previousTotalAmount: total - 4_200,
    baselineStatus: 'known',
    channelDetails: [
      { id: 'alipay', name: '支付宝', emoji: '💙', amount: total * 0.54, isParent: true, children: [], percentage: 54 },
      { id: 'bank', name: '银行卡', emoji: '🏦', amount: total * 0.32, isParent: true, children: [], percentage: 32 },
      { id: 'wechat', name: '微信', emoji: '💚', amount: total * 0.14, isParent: true, children: [], percentage: 14 },
    ],
    isArchived: false,
    createdAt: `${month}-31T10:00:00+08:00`,
    periodKey: `monthly:${month}`,
    dataAsOf: `${month}-15`,
    integrityStatus: 'verified',
    generationSource: 'normal',
    revision: 1,
  };
}

const goals: Goal[] = [{
  id: 'goal-home',
  name: '家庭安全垫',
  icon: '🏠',
  targetAmount: 500_000,
  startDateTime: '2026-01-01T00:00',
  targetDateTime: '2028-12-31T00:00',
  timezone: 'Asia/Shanghai',
  displayMode: 'calendar',
  status: 'active',
  priority: 1,
  color: '#10B981',
  showSeconds: false,
  createdAt: '2026-01-01T00:00:00+08:00',
  updatedAt: '2026-11-01T00:00:00+08:00',
}];

const lottery: LotteryState = {
  pool: { id: 'synthetic-pool', name: '娱乐预算', openingBalance: 500, createdAt: '2026-01-01T00:00:00+08:00' },
  projects: [{
    id: 'synthetic-project',
    name: '周末娱乐记录',
    category: 'sports-football',
    status: 'active',
    startDate: '2026-09-01',
    dataCompleteness: 'summary-only',
    legacySummary: { income: 120, expense: 300, netProfitLoss: -180 },
    createdAt: '2026-09-01T00:00:00+08:00',
    updatedAt: '2026-11-01T00:00:00+08:00',
  }],
  transactions: [],
  settings: { showLotteryAppendix: false },
};

const holdingA: Holding = {
  id: 'synthetic-holding-a',
  platform: 'alipay',
  parentChannelId: 'alipay',
  childChannelId: 'alipay_fund',
  fundCode: '000001',
  shareClass: 'A',
  originalName: '合成指数基金 A',
  currency: 'CNY',
  productType: 'fund',
  exposureTags: ['equity'],
};

const holdingC: Holding = {
  ...holdingA,
  id: 'synthetic-holding-c',
  shareClass: 'C',
  originalName: '合成指数基金 C',
};

const quality = {
  source: 'evidence',
  attribution: 'confirmed',
  valuation: 'observed',
  time: 'observed',
  review: 'pending',
} as const;

const observations: HoldingObservation[] = [holdingA, holdingC].map((holding, index) => ({
  id: `synthetic-observation-${index}`,
  holdingId: holding.id,
  sessionKey: 'monthly-planning:2026-11',
  shares: '1000',
  marketValue: 120_000 + index * 1_000,
  nav: '1.2',
  navDate: '2026-11-05',
  evidence: [],
  quality,
}));

function monthlyState() {
  const base = createFinanceDraftSession({
    taskKind: 'monthly-review',
    taskId: 'monthly-planning:2026-11',
    planningMonth: '2026-11',
    timezone: 'Asia/Shanghai',
    today: '2026-11-08',
    now: '2026-11-08T10:00:00+08:00',
  });
  return {
    ...emptyMonthlyPlanningState(),
    sessions: [{
      ...base,
      key: 'monthly-planning:2026-11',
      title: '11 月资金与持仓核对',
      state: 'reviewing' as const,
      revision: 2,
      snapshotAsOf: '2026-11-05',
      valuationAsOf: '2026-11-05',
      documents: [],
      holdings: [holdingA, holdingC],
      observations,
    }],
  };
}

const workspaceDrafts = {
  schemaVersion: 1 as const,
  drafts: [{
    draftId: 'finance-task:monthly-planning:2026-11',
    kind: 'finance-task' as const,
    targetId: 'monthly-planning:2026-11',
    ledgerId: 'synthetic-ledger',
    baseRevision: 17,
    baseEntityRevision: 1,
    baseFingerprint: 'a'.repeat(64),
    payloadVersion: 1,
    updatedAt: '2026-11-07T18:00:00+08:00',
    payload: { note: '这是一个已保存但需要重新核对的合成草稿。' },
  }],
};

export function syntheticStorage(): Record<string, string> {
  return {
    [STORAGE_VERSION_KEY]: APP_VERSION,
    [STORAGE_KEYS.wealthTrackerData]: JSON.stringify({ channels: channels(), history }),
    [STORAGE_KEYS.financialReports]: JSON.stringify([report('report-oct', '2026-10', 438_000)]),
    [STORAGE_KEYS.goals]: JSON.stringify({ goals, primaryGoalId: goals[0]!.id }),
    [STORAGE_KEYS.countdownData]: JSON.stringify({
      targetAmount: 500_000,
      targetDate: '2028-12-31',
      startDate: '2026-01-01',
      targetName: '家庭安全垫',
      timezone: 'Asia/Shanghai',
      startDateTime: '2026-01-01T00:00',
      targetDateTime: '2028-12-31T00:00',
      displayMode: 'calendar',
      showSeconds: false,
    }),
    [STORAGE_KEYS.goalAchievementStatus]: JSON.stringify({ hasAchievedGoal: false }),
    [STORAGE_KEYS.lotteryState]: JSON.stringify(lottery),
    [STORAGE_KEYS.monthlyPlanning]: JSON.stringify(monthlyState()),
    [STORAGE_KEYS.assetClassification]: JSON.stringify(emptyAssetClassificationState()),
    [STORAGE_KEYS.dataRevision]: '18',
    [STORAGE_KEYS.ledgerIdentity]: JSON.stringify({
      schemaVersion: 1,
      ledgerId: 'synthetic-ledger',
      createdAt: '2026-01-01T00:00:00+08:00',
    }),
    [STORAGE_KEYS.workspaceDrafts]: JSON.stringify(workspaceDrafts),
    [STORAGE_KEYS.healthReviews]: JSON.stringify(emptyHealthReviewState()),
    [STORAGE_KEYS.reportRevisions]: JSON.stringify(emptyReportRevisionState()),
    [STORAGE_KEYS.goalScenarios]: JSON.stringify(emptyGoalScenarioState()),
    [STORAGE_KEYS.workspaceUi]: JSON.stringify(emptyWorkspaceViewState()),
    [STORAGE_KEYS.appearanceSettings]: JSON.stringify({
      themeMode: 'system',
      followWealthTheme: true,
      density: 'comfortable',
      animationIntensity: 'normal',
      backgroundOpacity: 20,
      reduceMotion: 'system',
    }),
  };
}

export const syntheticToday = today;
