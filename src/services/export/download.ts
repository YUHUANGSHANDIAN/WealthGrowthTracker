/**
 * 文件下载适配：浏览器用 Blob + <a download>，灵光环境用 lingguang.saveFile。
 * 统一由业务层调用，避免业务组件直接接触平台差异。
 */

/** 浏览器端触发文本文件下载。 */
function downloadInBrowser(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟 revoke，确保下载已开始。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SaveResult {
  /** 是否由平台（灵光 saveFile）处理。 */
  handledByPlatform: boolean;
  filename: string;
}

/**
 * 保存文本文件。返回是否由灵光平台处理（平台处理时浏览器不再触发下载）。
 */
export async function saveTextFile(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<SaveResult> {
  if (typeof window !== 'undefined' && window.lingguang?.saveFile) {
    try {
      await window.lingguang.saveFile({ data: text, fileName: filename });
      return { handledByPlatform: true, filename };
    } catch (err) {
      console.warn('[export] 灵光 saveFile 失败，回退到浏览器下载:', err);
    }
  }
  downloadInBrowser(filename, text, mime);
  return { handledByPlatform: false, filename };
}

/** 生成带时间戳的备份文件名（与旧版格式一致）。 */
export function backupFilename(prefix = 'wealth_tracker_backup', ext = 'json'): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  return `${prefix}_${stamp}.${ext}`;
}
