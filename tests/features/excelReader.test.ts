import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLotteryExcelFile } from '../../src/features/lottery/excelReader';
import { EXCEL_LIMITS } from '../../src/features/lottery/excelLimits';

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { WorkerDouble.instances.push(this); }
}

function file(name = 'synthetic.xlsx'): File {
  const result = new File(['synthetic'], name);
  Object.defineProperty(result, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
  return result;
}

beforeEach(() => {
  WorkerDouble.instances = [];
  vi.stubGlobal('Worker', WorkerDouble);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Excel worker lifecycle', () => {
  it('invalid extension and pre-cancel never create a worker', async () => {
    await expect(readLotteryExcelFile(file('notes.txt'))).rejects.toThrow('XLS');
    const controller = new AbortController();
    controller.abort();
    await expect(readLotteryExcelFile(file(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(WorkerDouble.instances).toHaveLength(0);
  });
  it('cancel terminates the worker and ignores any late successful reply', async () => {
    const controller = new AbortController();
    const pending = readLotteryExcelFile(file(), controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    const worker = WorkerDouble.instances[0]!;
    controller.abort();
    worker.onmessage?.({ data: { ok: true, preview: {} } });
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('timeout rejects and terminates parsing without returning a partial preview', async () => {
    const pending = readLotteryExcelFile(file());
    const rejection = expect(pending).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(EXCEL_LIMITS.timeoutMs + 1);
    await rejection;
    expect(WorkerDouble.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it('worker failure terminates and exposes an actionable error', async () => {
    const pending = readLotteryExcelFile(file());
    const rejection = expect(pending).rejects.toThrow('进程失败');
    await Promise.resolve();
    WorkerDouble.instances[0]!.onerror?.();
    await rejection;
    expect(WorkerDouble.instances[0]!.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
