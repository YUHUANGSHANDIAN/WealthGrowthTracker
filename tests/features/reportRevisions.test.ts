import { describe, expect, it } from 'vitest';
import type { FinancialReport } from '../../src/types';
import {
  appendReportSnapshot,
  ensureReportBaseSnapshot,
  reportRevisionsFor,
  verifyReportRevisionIntegrity,
} from '../../src/features/reports/revisions';
import { emptyReportRevisionState } from '../../src/domain/workspace/state';

function report(overrides: Partial<FinancialReport> = {}): FinancialReport {
  return {
    id: 'report-1',
    reportType: 'monthly',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    title: '合成月报',
    totalAmount: 100,
    changeAmount: 10,
    changePercentage: 11.11,
    channelDetails: [],
    isArchived: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    revision: 1,
    ...overrides,
  };
}

describe('报告修订历史', () => {
  it('内容哈希可校验，并可同时返回多个版本', async () => {
    let state = await appendReportSnapshot(emptyReportRevisionState(), report(), 'generated', 1, '2026-11-01T00:00:00.000Z');
    state = await ensureReportBaseSnapshot(state, report(), 1);
    state = await appendReportSnapshot(state, report({ totalAmount: 120, revision: 2 }), 'edited', 2, '2026-11-02T00:00:00.000Z');
    await expect(verifyReportRevisionIntegrity(state)).resolves.toBeUndefined();
    expect(reportRevisionsFor(state, 'report-1')).toHaveLength(2);
    expect(reportRevisionsFor(state, 'report-1')[0]?.snapshot.totalAmount).toBe(120);
  });

  it('被篡改的快照会被拒绝', async () => {
    const state = await appendReportSnapshot(emptyReportRevisionState(), report(), 'generated', 1);
    state.revisions[0]!.snapshot.totalAmount = 999;
    await expect(verifyReportRevisionIntegrity(state)).rejects.toThrow('哈希不符');
  });
});
