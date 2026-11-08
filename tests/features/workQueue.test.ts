import { describe, expect, it } from 'vitest';
import { buildWorkQueue, collectVisibleIssues } from '../../src/features/workspace/workQueue';
import { checkDataHealth } from '../../src/utils/dataHealth';
import { emptyMonthlyPlanningState } from '../../src/services/monthlyPlanning/storage';
import { emptyAssetClassificationState } from '../../src/domain/assets/classification';
import { emptyWorkspaceDraftState } from '../../src/domain/workspace/state';
import { defaultLotteryState } from '../../src/features/lottery/lotteryMath';
import type { HealthReviewRecord } from '../../src/domain/workspace/types';

function baseInput() {
  const history = [{ date: '2026-11-01', totalAmount: -10 }];
  const issue = checkDataHealth([], history).issues.find((item) => item.title.includes('负'))!;
  const review: HealthReviewRecord = {
    id: `${issue.id}@ledger-1`,
    issueId: issue.id,
    ledgerId: 'ledger-1',
    code: issue.code,
    ruleVersion: issue.ruleVersion,
    status: 'acknowledged',
    reason: '已知，稍后核对',
    baseRevision: 1,
    fingerprint: issue.fingerprint,
    actorKind: 'user',
    sourceEventIds: [],
    operationId: 'op-1',
    updatedAt: '2026-11-07T00:00:00.000Z',
  };
  return {
    input: {
      channels: [],
      history,
      reports: [],
      goals: [],
      primaryGoalId: null,
      levelAchievements: [],
      lottery: defaultLotteryState(),
      monthlyPlanning: emptyMonthlyPlanningState(),
      assetClassification: emptyAssetClassificationState(),
      healthReviews: [review],
      ledgerId: 'ledger-1',
      drafts: emptyWorkspaceDraftState(),
      dataRevision: 1,
    },
    issue,
    review,
  };
}

describe('统一待办队列', () => {
  it('已阅但未解决的问题仍留在队列', () => {
    const { input } = baseInput();
    expect(collectVisibleIssues(input)).toHaveLength(1);
    expect(buildWorkQueue(input)[0]).toMatchObject({ reviewStatus: 'acknowledged' });
  });

  it('只有同一账本的已解决记录才隐藏问题', () => {
    const { input, review } = baseInput();
    input.healthReviews = [{ ...review, ledgerId: 'other-ledger', status: 'resolved', resolution: 'not-applicable' }];
    expect(collectVisibleIssues(input)).toHaveLength(1);
    input.healthReviews = [{ ...review, status: 'resolved', resolution: 'not-applicable' }];
    expect(collectVisibleIssues(input)).toHaveLength(0);
  });
});
