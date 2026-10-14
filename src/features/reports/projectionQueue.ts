import type { FinancialReport } from '../../types';
import { buildReportIndex } from './reportIndex';
import { reportFileBase, reportHtml } from './reportFile';

/** A durable outbox in canonical storage; report files remain disposable projections. */
export interface ReportProjectionQueue {
  schemaVersion: 1;
  generation: number;
  reportIds: string[];
  indexPending: boolean;
  attempts: number;
  lastError: string | null;
}

export const emptyProjectionQueue = (): ReportProjectionQueue => ({ schemaVersion: 1, generation: 0, reportIds: [], indexPending: false, attempts: 0, lastError: null });

export function parseProjectionQueue(value: unknown): ReportProjectionQueue {
  if (value === null) return emptyProjectionQueue();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('报告文件重试队列损坏');
  const queue = value as Record<string, unknown>;
  if (queue.schemaVersion !== 1 || !Number.isSafeInteger(queue.generation) || (queue.generation as number) < 0 ||
    !Array.isArray(queue.reportIds) || queue.reportIds.some(id => typeof id !== 'string' || !id || id.length > 256) ||
    typeof queue.indexPending !== 'boolean' || !Number.isSafeInteger(queue.attempts) || (queue.attempts as number) < 0 ||
    (queue.lastError !== null && typeof queue.lastError !== 'string')) throw new Error('报告文件重试队列格式无效或来自更新版本');
  return { schemaVersion: 1, generation: queue.generation as number, reportIds: [...new Set(queue.reportIds as string[])], indexPending: queue.indexPending, attempts: queue.attempts as number, lastError: queue.lastError as string | null };
}

export function enqueueReportProjection(queue: ReportProjectionQueue, previous: FinancialReport[], next: FinancialReport[]): ReportProjectionQueue {
  const old = new Map(previous.map(report => [report.id, JSON.stringify(report)]));
  const changed = next.filter(report => old.get(report.id) !== JSON.stringify(report)).map(report => report.id);
  if (!changed.length && previous.length === next.length && previous.every(report => next.some(item => item.id === report.id))) return queue;
  const present = new Set(next.map(report => report.id));
  return { schemaVersion: 1, generation: queue.generation + 1, reportIds: [...new Set([...queue.reportIds, ...changed])].filter(id => present.has(id)), indexPending: true, attempts: 0, lastError: null };
}

export interface ReportProjectionWriter {
  writeReport: (type: FinancialReport['reportType'], base: string, json: string, html: string) => Promise<void>;
  writeReportIndex: (json: string) => Promise<void>;
}

/** Idempotent writes. A failure leaves the whole outbox pending for a safe retry. */
export async function writeReportProjection(queue: ReportProjectionQueue, reports: FinancialReport[], writer: ReportProjectionWriter): Promise<void> {
  const pending = new Set(queue.reportIds);
  for (const report of reports) {
    if (pending.has(report.id)) await writer.writeReport(report.reportType, reportFileBase(report), JSON.stringify(report, null, 2), reportHtml(report));
  }
  // Publish the index last, after all referenced report files have been written.
  if (queue.indexPending) await writer.writeReportIndex(JSON.stringify(buildReportIndex(reports), null, 2));
}
