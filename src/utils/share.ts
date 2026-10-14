import type { FinancialReport } from '../types';
import { formatCNY } from './money';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** 报告文字摘要（用于邮件正文 / 剪贴板 fallback）。 */
export function reportTextSummary(report: FinancialReport): string {
  if (report.baselineStatus === 'unknown' || report.previousTotalAmount === undefined) {
    return `${report.title}\n周期：${report.startDate} ~ ${report.endDate}\n期末总资产：${formatCNY(report.totalAmount)}\n期初总资产：未知\n本期变化：无法计算（缺少期初历史快照）\n财富等级：${report.wealthLevelName ?? '—'}`;
  }
  const positive = report.changeAmount >= 0;
  return `${report.title}\n周期：${report.startDate} ~ ${report.endDate}\n期末总资产：${formatCNY(report.totalAmount)}\n期初总资产：${formatCNY(report.previousTotalAmount ?? 0)}\n本期变化：${positive ? '+' : ''}${formatCNY(report.changeAmount)}（${positive ? '+' : ''}${Math.abs(report.changePercentage).toFixed(1)}%）\n财富等级：${report.wealthLevelName ?? '—'}`;
}

/** mailto 链接（仅文字摘要，不自动附加图片）。 */
export function buildMailtoLink(report: FinancialReport): string {
  const subject = encodeURIComponent(report.title);
  const body = encodeURIComponent(reportTextSummary(report));
  return `mailto:?subject=${subject}&body=${body}`;
}

/** 系统分享是否可用（需 File Sharing 支持）。 */
export function systemShareAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.share && !!navigator.canShare;
}

/** 系统分享（Web Share API）。text 覆盖默认文字摘要（隐私模式）。 */
export async function systemShare(report: FinancialReport, file?: File, text?: string): Promise<boolean> {
  if (!systemShareAvailable()) return false;
  const body = text ?? reportTextSummary(report);
  try {
    if (file && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: report.title, text: body, files: [file] });
    } else {
      await navigator.share({ title: report.title, text: body });
    }
    return true;
  } catch {
    return false;
  }
}

/** 复制图片到剪贴板（支持 ClipboardItem image/png）。 */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && 'ClipboardItem' in window) {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 复制文本到剪贴板。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 把 SVG 字符串栅格化为图片 Blob（PNG/JPEG/WebP）。 */
export function renderSvgToBlob(
  svgString: string,
  format: ImageFormat,
  scale = 2,
  quality = 0.9,
  transparent = false,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('无法创建画布'));
      // JPEG 不支持透明；PNG/WebP 在 transparent 模式下不填白底
      if (!transparent || format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('栅格化失败'))), mime, quality);
    };
    img.onerror = () => reject(new Error('SVG 解析失败'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  });
}

/** 触发下载（Blob）。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
