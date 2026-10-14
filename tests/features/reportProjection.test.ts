import { describe, expect, it, vi } from 'vitest';
import { emptyProjectionQueue, enqueueReportProjection, parseProjectionQueue, writeReportProjection } from '../../src/features/reports/projectionQueue';
import { generateReport } from '../../src/features/reports/generate';

const makeReport = () => generateReport([{ date: '2026-09-30', totalAmount: 100 }], 'monthly', '2026-09-15', [], '2026-10-13');

describe('durable report projections', () => {
  it('coalesces changed reports and updates the index even for deletions', () => {
    const report = makeReport();
    const first = enqueueReportProjection(emptyProjectionQueue(), [], [report]);
    const second = enqueueReportProjection(first, [report], [{ ...report, totalAmount: 150 }]);
    expect(second.reportIds).toEqual([report.id]);
    expect(second.generation).toBe(first.generation + 1);
    const removed = enqueueReportProjection(second, [report], []);
    expect(removed.reportIds).toEqual([]);
    expect(removed.indexPending).toBe(true);
  });

  it('writes referenced files before the index and safely repeats a failed attempt', async () => {
    const report = makeReport();
    const queue = enqueueReportProjection(emptyProjectionQueue(), [], [report]);
    const calls: string[] = [];
    const writer = {
      writeReport: vi.fn(async () => { calls.push('report'); }),
      writeReportIndex: vi.fn(async (_contents: string) => { calls.push('index'); }),
    };
    writer.writeReport.mockRejectedValueOnce(new Error('disk failure'));
    await expect(writeReportProjection(queue, [report], writer)).rejects.toThrow('disk failure');
    expect(writer.writeReportIndex).not.toHaveBeenCalled();
    expect(queue.reportIds).toEqual([report.id]);
    await writeReportProjection(queue, [report], writer);
    expect(calls).toEqual(['report', 'index']);
    const index = JSON.parse(writer.writeReportIndex.mock.calls[0]![0] as string);
    expect(index.reports[0].reportId).toBe(report.id);
  });

  it('persists pending status across a round trip and refuses future or corrupt queues', () => {
    const queue = { ...enqueueReportProjection(emptyProjectionQueue(), [], [makeReport()]), attempts: 2, lastError: '文件等待同步' };
    expect(parseProjectionQueue(JSON.parse(JSON.stringify(queue)))).toEqual(queue);
    expect(() => parseProjectionQueue({ ...queue, schemaVersion: 2 })).toThrow();
    expect(() => parseProjectionQueue({ ...queue, reportIds: [42] })).toThrow();
  });
});
