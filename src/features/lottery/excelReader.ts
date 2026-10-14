import type { LotteryExcelPreview } from './excelImport';
import { EXCEL_LIMITS } from './excelLimits';

/** Isolate parsing from the UI and terminate on timeout, cancellation or completion. */
export async function readLotteryExcelFile(file: File, signal?: AbortSignal): Promise<LotteryExcelPreview> {
  if (file.size > EXCEL_LIMITS.fileBytes) throw new Error('Excel 文件超过 20 MB');
  if (!/\.(xls|xlsx)$/i.test(file.name)) throw new Error('请选择 XLS 或 XLSX 文件');
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excelImport.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, preview?: LotteryExcelPreview) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error); else resolve(preview!);
    };
    const cancel = () => finish(new DOMException('已取消', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Excel 解析超时，请缩小文件')), EXCEL_LIMITS.timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = event => event.data.ok ? finish(undefined, event.data.preview) : finish(new Error(event.data.error));
    worker.onerror = () => finish(new Error('Excel 解析进程失败'));
    worker.onmessageerror = () => finish(new Error('Excel 解析结果无法读取'));
    try { worker.postMessage(buffer, [buffer]); } catch (error) { finish(error instanceof Error ? error : new Error('无法启动 Excel 解析')); }
  });
}
