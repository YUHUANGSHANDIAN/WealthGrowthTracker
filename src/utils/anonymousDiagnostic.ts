import type { Channel, FinancialReport, Goal, HistoryPoint, LevelAchievement, LotteryState } from '../types';
import { APP_VERSION } from '../constants/version';
import { BUILD_COMMIT, BUILD_ID } from '../constants/buildInfo';
import { REPORT_SCHEMA_VERSION } from '../features/reports/normalize';

/**
 * 匿名诊断导出（v1.5）：只包含可公开的聚合统计，方便排 Bug。
 * 绝不包含：金额、渠道名称、报告内容、彩票交易、用户名、PIN、密码。
 */

export interface AnonymousDiagnostic {
  generatedAt: string;
  appVersion: string;
  buildId: string;
  buildCommit: string;
  schemaVersions: { storageSchemaVersion: number; monthlySchemaVersion: number; reportSchemaVersion: number };
  counts: {
    channels: number;
    subChannels: number;
    historyPoints: number;
    reports: { weekly: number; monthly: number; yearly: number };
    goals: number;
    levelAchievements: number;
    lottery: { projects: number; transactions: number; detailedProjects: number; summaryOnlyProjects: number };
  };
  /** 健康问题「类型/域」（如 reports / lottery），不含任何实体 ID 或证据。 */
  healthIssueTypes: string[];
  platform: string;
  storageBackend: string;
}

export interface AnonymousDiagnosticInput {
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
  goals: Goal[];
  levelAchievements: LevelAchievement[];
  lottery: LotteryState;
  healthIssueTypes: string[];
  platform: string;
  storageBackend: string;
  monthlySchemaVersion?: number;
}

export function buildAnonymousDiagnostic(input: AnonymousDiagnosticInput): AnonymousDiagnostic {
  const subChannels = input.channels.reduce((a, c) => a + (c.children?.length ?? 0), 0);
  const weekly = input.reports.filter((r) => r.reportType === 'weekly').length;
  const monthly = input.reports.filter((r) => r.reportType === 'monthly').length;
  const yearly = input.reports.filter((r) => r.reportType === 'yearly').length;

  return {
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    buildId: BUILD_ID,
    buildCommit: BUILD_COMMIT,
    schemaVersions: {
      storageSchemaVersion: 1,
      monthlySchemaVersion: input.monthlySchemaVersion ?? 2,
      reportSchemaVersion: REPORT_SCHEMA_VERSION,
    },
    counts: {
      channels: input.channels.length,
      subChannels,
      historyPoints: input.history.length,
      reports: { weekly, monthly, yearly },
      goals: input.goals.length,
      levelAchievements: input.levelAchievements.length,
      lottery: {
        projects: input.lottery.projects.length,
        transactions: input.lottery.transactions.length,
        detailedProjects: input.lottery.projects.filter((p) => p.dataCompleteness === 'detailed').length,
        summaryOnlyProjects: input.lottery.projects.filter((p) => p.dataCompleteness === 'summary-only').length,
      },
    },
    healthIssueTypes: [...new Set(input.healthIssueTypes)].sort(),
    platform: input.platform,
    storageBackend: input.storageBackend,
  };
}
