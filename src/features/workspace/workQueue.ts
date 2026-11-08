import type { Channel, FinancialReport, Goal, HistoryPoint, LevelAchievement, LotteryState } from '../../types';
import type { AssetClassificationState } from '../../domain/assets/classification';
import type { MonthlyPlanningState } from '../../domain/portfolio/types';
import type { HealthReviewRecord, WorkspaceDraftState } from '../../domain/workspace/types';
import type { Route } from '../../store/navigationStore';
import {
  checkAchievementHealth,
  checkClassificationHealth,
  checkDataHealth,
  checkGoalHealth,
  checkLotteryHealth,
  checkMonthlyHealth,
  checkReportHealth,
  type DataIssue,
} from '../../utils/dataHealth';
import { taskKindOf } from '../../domain/portfolio/session';

export type WorkItemPriority = 'critical' | 'high' | 'normal';

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  priority: WorkItemPriority;
  source: 'health' | 'finance' | 'report' | 'draft';
  route: Partial<Route>;
  actionLabel: string;
  reviewStatus?: HealthReviewRecord['status'];
}

function currentReview(issue: DataIssue, reviews: HealthReviewRecord[], ledgerId: string): HealthReviewRecord | undefined {
  return reviews.find((review) => review.ledgerId === ledgerId && review.issueId === issue.id && review.fingerprint === issue.fingerprint);
}

export function collectVisibleIssues(input: {
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
  goals: Goal[];
  primaryGoalId: string | null;
  levelAchievements: LevelAchievement[];
  lottery: LotteryState;
  monthlyPlanning: MonthlyPlanningState;
  assetClassification: AssetClassificationState;
  healthReviews: HealthReviewRecord[];
  ledgerId: string;
  attachmentStatus?: Array<{ key: string; ok: boolean; reason?: string }>;
}): DataIssue[] {
  const base = checkDataHealth(input.channels, input.history);
  const all = [
    ...base.issues,
    ...checkReportHealth(input.reports),
    ...checkGoalHealth(input.goals, input.primaryGoalId),
    ...checkAchievementHealth(input.levelAchievements),
    ...checkLotteryHealth(input.lottery),
    ...checkMonthlyHealth(input.monthlyPlanning, { attachmentStatus: input.attachmentStatus }),
    ...checkClassificationHealth(input.channels, input.monthlyPlanning, input.assetClassification),
  ];
  return all.filter((issue) => currentReview(issue, input.healthReviews, input.ledgerId)?.status !== 'resolved');
}

export function buildWorkQueue(input: Parameters<typeof collectVisibleIssues>[0] & {
  dataRevision: number;
  drafts: WorkspaceDraftState;
}): WorkItem[] {
  const items: WorkItem[] = [];
  for (const issue of collectVisibleIssues(input)) {
    const review = currentReview(issue, input.healthReviews, input.ledgerId);
    const evidence = issue.evidenceRefs[0];
    const evidenceTask = evidence?.taskId
      ? input.monthlyPlanning.sessions.find((task) => task.key === evidence.taskId)
      : undefined;
    const route: Partial<Route> = evidence?.kind === 'holding'
      ? { tab: 'assets', assetView: 'holdings', holdingId: evidence.taskId ? `${evidence.taskId}:${evidence.id}` : evidence.id }
      : evidence?.kind === 'report'
        ? { tab: 'reports', reportId: evidence.id, reportMode: 'read' }
        : evidence?.kind === 'history'
          ? { tab: 'history', historyDate: evidence.date ?? evidence.id }
          : evidence?.kind === 'channel'
            ? { tab: 'assets', channelId: evidence.id }
            : evidence?.taskId
              ? { tab: 'monthly', financeTaskId: evidence.taskId, financeTaskKind: evidenceTask ? taskKindOf(evidenceTask) : 'monthly-review' }
              : issue.domain === 'reports' && issue.entityId
                ? { tab: 'reports', reportId: issue.entityId, reportMode: 'read' }
                : issue.domain === 'history' && issue.entityId
                  ? { tab: 'history', historyDate: issue.entityId }
                  : issue.domain === 'monthly'
                    ? { tab: 'monthly', financeTaskKind: 'monthly-review' }
                    : { tab: 'data', healthIssueId: issue.id };
    items.push({
      id: `health:${issue.id}`,
      title: issue.title,
      description: review?.status === 'acknowledged'
        ? `已阅但仍需处理：${issue.description}`
        : review?.status === 'deferred'
          ? `已暂缓${review.reviewAfter ? `至 ${review.reviewAfter}` : ''}：${issue.description}`
          : issue.description,
      priority: issue.severity === 'error' ? 'critical' : review?.status && review.status !== 'resolved' ? 'normal' : 'high',
      source: 'health',
      route,
      actionLabel: review?.status === 'deferred' ? '继续处理' : '查看证据',
      reviewStatus: review?.status,
    });
  }
  for (const task of input.monthlyPlanning.sessions) {
    if (task.state === 'blocked' || task.state === 'ready' || task.state === 'planned') {
      items.push({
        id: `finance:${task.key}:${task.state}`,
        title: task.title || task.key,
        description: task.state === 'blocked' ? '任务存在阻塞项，需要补充或核对。' : task.state === 'ready' ? '结果已生成，等待批准、复核或归档。' : '方案等待你的确认。',
        priority: task.state === 'blocked' ? 'critical' : 'high',
        source: 'finance',
        route: { tab: 'monthly', financeTaskKind: taskKindOf(task), financeTaskId: task.key },
        actionLabel: '继续任务',
      });
    }
  }
  for (const report of input.reports) {
    if (report.integrityStatus === 'needs-review') {
      items.push({
        id: `report:${report.id}:${report.revision ?? 1}`,
        title: report.title,
        description: '报告标记为需核对，仍需确认来源或冲突。',
        priority: 'high',
        source: 'report',
        route: { tab: 'reports', reportId: report.id },
        actionLabel: '查看报告',
      });
    }
  }
  for (const draft of input.drafts.drafts) {
    if (draft.baseRevision === input.dataRevision) continue;
    items.push({
      id: `draft:${draft.draftId}`,
      title: '有草稿需要重新核对',
      description: '源数据已经更新，旧草稿不能直接覆盖新事实。',
      priority: 'high',
      source: 'draft',
      route: draft.kind === 'report-edit'
        ? { tab: 'reports', reportId: draft.targetId }
        : draft.kind === 'finance-task' || draft.kind === 'finance-policy' || draft.kind === 'finance-comparison'
          ? { tab: 'monthly', financeTaskId: draft.targetId }
          : { tab: 'overview' },
      actionLabel: '查看草稿',
    });
  }
  const priority = { critical: 0, high: 1, normal: 2 };
  return items.sort((a, b) => priority[a.priority] - priority[b.priority] || a.title.localeCompare(b.title, 'zh'));
}
