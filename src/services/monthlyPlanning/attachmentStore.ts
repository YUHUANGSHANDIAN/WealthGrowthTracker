import { isTauri, createTauriFileSystem, type FileSystem } from '../storage/fs';
import { storageService } from '../storage';
import { ATTACHMENT_PREFIX, AttachmentError, attachmentFileName, isAttachmentKey } from './attachmentCodec';

/**
 * 附件存储后端。
 *
 * 关键约束（这是 v1.8.0-preview.3 之前的一个真实缺陷）：桌面适配器把所有键写进**同一个**
 * `data/app-state.json`。附件如果走 `storageService.setRaw`，几 MB 图片就会让状态文件涨到 9 MB，
 * 于是每次保存都要重写整份文件、每次写入还要复制一份等大的备份——界面因此长时间无响应。
 *
 * 所以桌面端把附件写成数据根下的独立文件 `monthly-planning/attachments/<sha256>.<ext>`（base64 文本），
 * 浏览器端继续用适配器键（IndexedDB 每条记录独立，本来就没有这个问题）。
 * 读取时若文件不存在会回退到状态里的内联值，因此升级过程不会丢附件。
 */
export const ATTACHMENT_DIR = 'monthly-planning/attachments';

export interface AttachmentBackend {
  read(key: string): Promise<string | null>;
  write(key: string, base64: string): Promise<void>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

let tauriFsPromise: Promise<FileSystem> | null = null;
function tauriFs(): Promise<FileSystem> {
  tauriFsPromise ??= createTauriFileSystem();
  return tauriFsPromise;
}

export function createFileAttachmentBackend(fs: FileSystem): AttachmentBackend {
  return {
    async read(key) {
      const path = `${ATTACHMENT_DIR}/${attachmentFileName(key)}`;
      try {
        return await fs.readTextFile(path);
      } catch {
        // 迁移未跑完或历史数据仍内联：回退到状态里的旧值，绝不因为换布局而读不到。
        return storageService.getRaw(key);
      }
    },
    async write(key, base64) {
      try {
        await fs.mkdir(ATTACHMENT_DIR);
        await fs.writeTextFile(`${ATTACHMENT_DIR}/${attachmentFileName(key)}`, base64);
      } catch (cause) {
        throw new AttachmentError(`附件写入失败：${cause instanceof Error ? cause.message : '存储不可用'}`);
      }
      // 文件写成功后再清掉可能存在的内联副本；失败只影响体积，不影响可读性。
      try { await storageService.remove(key); } catch { /* 保持内联副本 */ }
    },
    async remove(key) {
      try { await fs.removeFile(`${ATTACHMENT_DIR}/${attachmentFileName(key)}`); } catch { /* 文件可能不在 */ }
      await storageService.remove(key);
    },
    async exists(key) {
      if (await fs.exists(`${ATTACHMENT_DIR}/${attachmentFileName(key)}`)) return true;
      return (await storageService.getRaw(key)) !== null;
    },
  };
}

export function createAdapterAttachmentBackend(adapter: typeof storageService): AttachmentBackend {
  return {
    read: (key) => adapter.getRaw(key),
    async write(key, base64) { await adapter.setRaw(key, base64); },
    remove: (key) => adapter.remove(key),
    async exists(key) { return (await adapter.getRaw(key)) !== null; },
  };
}

let cachedBackend: AttachmentBackend | null = null;

/** 当前平台的附件后端：桌面写文件，其它平台写适配器键。 */
export function attachmentBackend(): AttachmentBackend {
  if (cachedBackend) return cachedBackend;
  cachedBackend = isTauri()
    ? createFileAttachmentBackend({ ...(createLazyFileSystem()) })
    : createAdapterAttachmentBackend(storageService);
  return cachedBackend;
}

/** 桌面文件系统是惰性初始化的，这里包一层同步接口。 */
function createLazyFileSystem(): FileSystem {
  return {
    readTextFile: (p) => tauriFs().then((fs) => fs.readTextFile(p)),
    writeTextFile: (p, c) => tauriFs().then((fs) => fs.writeTextFile(p, c)),
    exists: (p) => tauriFs().then((fs) => fs.exists(p)),
    mkdir: (p) => tauriFs().then((fs) => fs.mkdir(p)),
    readDir: (p) => tauriFs().then((fs) => fs.readDir(p)),
    removeFile: (p) => tauriFs().then((fs) => fs.removeFile(p)),
    copyFile: (s, d) => tauriFs().then((fs) => fs.copyFile(s, d)),
    rename: (s, d) => tauriFs().then((fs) => fs.rename(s, d)),
  };
}

/** 仅供测试：注入后端。 */
export function setAttachmentBackendForTest(backend: AttachmentBackend | null): void {
  cachedBackend = backend;
}

/**
 * 把历史上内联在状态文件里的附件搬进独立文件，并返回搬迁数量。
 * 幂等：跑第二次时状态里已经没有可搬的键。失败不抛出——数据仍可内联读取。
 */
export async function migrateInlineAttachments(backendOverride?: AttachmentBackend): Promise<number> {
  if (!isTauri()) return 0;
  const inlineKeys = await storageService.listRawKeys?.(ATTACHMENT_PREFIX);
  if (!inlineKeys?.length) return 0;
  const backend = backendOverride ?? attachmentBackend();
  let moved = 0;
  for (const key of inlineKeys) {
    if (!isAttachmentKey(key)) continue;
    const value = await storageService.getRaw(key);
    if (value === null) continue;
    await backend.write(key, value);
    moved += 1;
  }
  return moved;
}
