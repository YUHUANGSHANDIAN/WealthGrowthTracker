import { describe, expect, it } from 'vitest';
import { confirmReportProposal, prepareReportGeneration } from '../../src/features/reports/transaction';

function state() {
  return { baseRevision: 1, channels: [], reports: [], history: [{ date: '2026-10-04', totalAmount: 100 }] };
}

describe('report preview integrity', () => {
  it('rejects altered facts before confirmation', () => {
    const base = state();
    const proposal = prepareReportGeneration(base, 'weekly', '2026-10-04');
    proposal.report.totalAmount = 999;
    expect(() => confirmReportProposal(base, proposal)).toThrow('预览已变化');
  });

  it('rejects removed conflict requirements and arbitrary deserialized replacements', () => {
    const original = state();
    const first = prepareReportGeneration(original, 'weekly', '2026-10-04');
    const base = { ...original, reports: [first.report], history: [{ date: '2026-10-04', totalAmount: 150 }] };
    const proposal = prepareReportGeneration(base, 'weekly', '2026-10-04');
    expect(proposal.conflicts).not.toHaveLength(0);
    proposal.conflicts = [];
    expect(() => confirmReportProposal(base, proposal)).toThrow('预览已变化');
    const fresh = prepareReportGeneration(base, 'weekly', '2026-10-04');
    expect(() => confirmReportProposal(base, JSON.parse(JSON.stringify(fresh)), { overwriteReport: true })).toThrow('不是本次准备');
  });
});
