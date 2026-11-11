import type { AssetClassificationState } from '../domain/assets/classification';
import type { MonthlyPlanningState } from '../domain/portfolio/types';
import type {
  Channel,
  FinancialReport,
  Goal,
  HistoryPoint,
  LevelAchievement,
  LotteryState,
} from '../types';
import {
  checkAchievementHealth,
  checkClassificationHealth,
  checkDataHealth,
  checkGoalHealth,
  checkLotteryHealth,
  checkMonthlyHealth,
  checkReportHealth,
  type DataIssue,
} from './dataHealth';

export interface HealthScanInput {
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
  goals: Goal[];
  primaryGoalId: string | null;
  levelAchievements: LevelAchievement[];
  lottery: LotteryState;
  monthlyPlanning: MonthlyPlanningState;
  assetClassification: AssetClassificationState;
  attachmentStatus?: ReadonlyArray<{ key: string; ok: boolean; reason?: string }>;
  carriedItems?: ReadonlyArray<{ id: string; label: string; stale: boolean; status: string }>;
}

/** The sole deterministic data-health scan used by both the screen and AI context. */
export function scanAllHealth(input: HealthScanInput): DataIssue[] {
  const base = checkDataHealth(input.channels, input.history);
  return [
    ...base.issues,
    ...checkReportHealth(input.reports),
    ...checkGoalHealth(input.goals, input.primaryGoalId),
    ...checkAchievementHealth(input.levelAchievements),
    ...checkLotteryHealth(input.lottery),
    ...checkMonthlyHealth(input.monthlyPlanning, {
      attachmentStatus: input.attachmentStatus,
      carriedItems: input.carriedItems,
    }),
    ...checkClassificationHealth(input.channels, input.monthlyPlanning, input.assetClassification),
  ];
}
