import { describe, expect, it } from 'vitest';
import { emptyAssetClassificationState } from '../../src/domain/assets/classification';
import { emptyMonthlyPlanningState } from '../../src/services/monthlyPlanning/storage';
import type { Channel, HistoryPoint } from '../../src/types';
import { checkDataHealth } from '../../src/utils/dataHealth';
import type { HealthScanInput } from '../../src/utils/healthScan';
import { assertHealthFixProposal, prepareHealthFix } from '../../src/features/data/issueFix';
import { defaultLotteryState } from '../../src/features/lottery/lotteryMath';

const channels: Channel[] = [{
  id: 'cash',
  name: '现金',
  emoji: '💵',
  amount: Number.NaN,
  color: '#000',
  isParent: true,
  isExpanded: false,
  children: [],
}];
const history: HistoryPoint[] = [
  { date: '2026-01-01', totalAmount: 10 },
  { date: '2026-01-01', totalAmount: 20 },
];

function input(): HealthScanInput {
  return {
    channels,
    history,
    reports: [],
    goals: [],
    primaryGoalId: null,
    levelAchievements: [],
    lottery: defaultLotteryState(),
    monthlyPlanning: emptyMonthlyPlanningState(),
    assetClassification: emptyAssetClassificationState(),
  };
}

describe('issue-specific health repair', () => {
  it('changes only the selected fix and leaves another fixable issue untouched', () => {
    const duplicate = checkDataHealth(channels, history).issues.find((issue) => issue.fix === 'dedupe-history')!;
    const proposal = prepareHealthFix(input(), 4, duplicate.id, duplicate.fingerprint);
    expect(proposal.after.history).toEqual([{ date: '2026-01-01', totalAmount: 20 }]);
    expect(Number.isNaN(proposal.after.channels[0]!.amount)).toBe(true);
    expect(proposal.changedHistoryDates).toEqual(['2026-01-01']);
    expect(() => assertHealthFixProposal(input(), 4, proposal)).not.toThrow();
  });

  it('rejects stale fingerprints and tampered previews', () => {
    const duplicate = checkDataHealth(channels, history).issues.find((issue) => issue.fix === 'dedupe-history')!;
    expect(() => prepareHealthFix(input(), 4, duplicate.id, 'stale')).toThrow('指纹');
    const proposal = prepareHealthFix(input(), 4, duplicate.id, duplicate.fingerprint);
    expect(() => assertHealthFixProposal(input(), 5, proposal)).toThrow('数据已变化');
    expect(() => assertHealthFixProposal(input(), 4, { ...proposal, summary: 'tampered' })).toThrow('修改');
  });
});
