import type { FinancialReport } from '../../types';
import { canonicalJson, sha256Text } from '../../utils/canonicalHash';
import type { ReportRevisionRecord, ReportRevisionState } from '../../domain/workspace/types';

export type ReportRevisionAction = ReportRevisionRecord['action'];

export async function reportSnapshotHash(report: FinancialReport): Promise<string> {
  return sha256Text(canonicalJson(report));
}

export async function reportRevisionRecord(
  report: FinancialReport,
  action: ReportRevisionAction,
  baseDataRevision: number,
  capturedAt = new Date().toISOString(),
): Promise<ReportRevisionRecord> {
  const contentHash = await reportSnapshotHash(report);
  const revision = report.revision ?? 1;
  return {
    id: `${report.id}@${revision}:${contentHash}`,
    reportId: report.id,
    revision,
    action,
    capturedAt,
    baseDataRevision,
    contentHash,
    snapshot: JSON.parse(JSON.stringify(report)) as Record<string, unknown>,
  };
}

export async function appendReportSnapshot(
  state: ReportRevisionState,
  report: FinancialReport,
  action: ReportRevisionAction,
  baseDataRevision: number,
  capturedAt = new Date().toISOString(),
): Promise<ReportRevisionState> {
  const revision = await reportRevisionRecord(report, action, baseDataRevision, capturedAt);
  if (state.revisions.some((item) => item.id === revision.id)) return state;
  return { schemaVersion: 1, revisions: [...state.revisions, revision] };
}

export async function ensureReportBaseSnapshot(
  state: ReportRevisionState,
  report: FinancialReport,
  baseDataRevision: number,
): Promise<ReportRevisionState> {
  if (state.revisions.some((item) => item.reportId === report.id && item.revision === (report.revision ?? 1))) return state;
  return appendReportSnapshot(state, report, 'edited', baseDataRevision);
}

export async function verifyReportRevisionIntegrity(state: ReportRevisionState): Promise<void> {
  for (const revision of state.revisions) {
    const hash = await reportSnapshotHash(revision.snapshot as unknown as FinancialReport);
    if (hash !== revision.contentHash) throw new Error(`报告修订内容哈希不符：${revision.id}`);
  }
}

export function reportRevisionsFor(state: ReportRevisionState, reportId: string): ReportRevisionRecord[] {
  return state.revisions
    .filter((item) => item.reportId === reportId)
    .sort((a, b) => b.revision - a.revision || b.capturedAt.localeCompare(a.capturedAt));
}

export function withCurrentReport(
  revisions: ReportRevisionRecord[],
  report: FinancialReport,
): Array<ReportRevisionRecord | { id: 'current'; reportId: string; revision: number; current: FinancialReport }> {
  return [
    { id: 'current', reportId: report.id, revision: report.revision ?? 1, current: report },
    ...revisions.filter((item) => item.revision !== (report.revision ?? 1)),
  ];
}
