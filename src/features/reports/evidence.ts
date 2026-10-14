import type { FinancialReport, ReportVerificationEvidence } from '../../types';
import { totalAssets } from '../../utils/channels';
import { round2 } from '../../utils/money';

export type { ReportVerificationEvidence } from '../../types';

export type EvidencedReport = FinancialReport & { verificationEvidence?: ReportVerificationEvidence };

/** Evidence is tied to the exact financial inputs; a source label is never evidence. */
export function reportFacts(report: FinancialReport): string {
  return JSON.stringify({
    period: [report.reportType, report.startDate, report.endDate],
    dataAsOf: report.dataAsOf,
    total: report.totalAmount,
    previous: report.previousTotalAmount,
    channels: report.channels,
    stats: [report.weeklyMax, report.weeklyMin, report.weeklyAvg, report.monthlyMax, report.monthlyMin, report.monthlyAvg, report.yearlyMax, report.yearlyMin, report.yearlyAvg],
  });
}

export function hasValidReportEvidence(report: FinancialReport): boolean {
  const evidence = (report as EvidencedReport).verificationEvidence;
  return !!evidence && evidence.kind === 'snapshot-reconciliation' && evidence.facts === reportFacts(report)
    && evidence.endDate === report.dataAsOf && !!report.channels
    && round2(totalAssets(report.channels)) === round2(report.totalAmount)
    && Number.isFinite(report.previousTotalAmount);
}
