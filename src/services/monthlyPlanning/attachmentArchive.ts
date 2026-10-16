import { APP_VERSION } from '../../constants/version';
import { attachmentBackend } from './attachmentStore';
import type { MonthlyPlanningState } from '../../domain/portfolio/types';
import {
  AttachmentError, base64ToBytes, bytesToBase64, getAttachment, isAttachmentKey, putAttachment, sha256Hex,
} from './attachments';

/**
 * 含附件的单文件归档：把会话文档引用的附件内容与它们的索引清单打成一个 JSON。
 *
 * 边界（与结构化 JSON 备份互补，互不替代）：
 * - 归档只携带附件内容与「哪个会话的哪份文档用了它」，**不创建会话、不写结构化数据**；
 * - 导出时逐个读取并校验哈希，缺失或哈希不符就整体失败，不产出半成品；
 * - 导入时先全量校验、再写入：任一项哈希不符即整批拒绝，绝不写坏一个附件库。
 */
export const ATTACHMENT_ARCHIVE_KIND = 'wealth-growth-tracker-attachment-archive';
export const ATTACHMENT_ARCHIVE_SCHEMA_VERSION = 1;
/** 单文件上限：超过它就不再产出（导不回来的备份没有意义）。 */
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ATTACHMENTS = 500;
const BASE64_TEXT = /^[A-Za-z0-9+/]*={0,2}$/;
const HASH = /^[a-f0-9]{64}$/;

export interface AttachmentArchiveEntry {
  key: string;
  sha256: string;
  name: string;
  mime: string;
  bytes: number;
  data: string;
}

export interface AttachmentArchiveDocumentRef {
  sessionKey: string;
  documentId: string;
  key: string;
  sha256: string;
  originalName: string;
}

export interface AttachmentArchive {
  kind: typeof ATTACHMENT_ARCHIVE_KIND;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  documents: AttachmentArchiveDocumentRef[];
  attachments: AttachmentArchiveEntry[];
}

export interface ArchiveBuildResult {
  text: string;
  attachmentCount: number;
  totalBytes: number;
}

export interface ArchiveImportResult {
  imported: number;
  skipped: number;
  failed: number;
  failures: Array<{ key: string; reason: string }>;
}

export type ArchiveParseResult =
  | { ok: true; archive: AttachmentArchive }
  | { ok: false; error: string };

export interface CollectedRef {
  key: string;
  sha256: string;
  name: string;
  mime: string;
  sessionKey: string;
  documentId: string;
}

/** 枚举所有会话文档引用的附件键，按 key 去重（同一份文件可能被多个月引用）。 */
export function collectAttachmentRefs(state: MonthlyPlanningState): CollectedRef[] {
  const byKey = new Map<string, CollectedRef>();
  for (const session of state.sessions) {
    for (const document of session.documents) {
      if (!isAttachmentKey(document.relativePath)) continue;
      if (!HASH.test(document.sha256)) continue;
      if (byKey.has(document.relativePath)) continue;
      byKey.set(document.relativePath, {
        key: document.relativePath,
        sha256: document.sha256,
        name: document.originalName,
        mime: document.mime ?? '',
        sessionKey: session.key,
        documentId: document.id,
      });
    }
  }
  return [...byKey.values()];
}

/** 导出：读全部附件（读取时即校验哈希），任一项失败就整体失败并列出键名。 */
export async function buildAttachmentArchive(state: MonthlyPlanningState, now: string): Promise<ArchiveBuildResult> {
  const refs = collectAttachmentRefs(state);
  const attachments: AttachmentArchiveEntry[] = [];
  const broken: string[] = [];
  let totalBytes = 0;
  for (const ref of refs) {
    try {
      const bytes = await getAttachment({ key: ref.key, sha256: ref.sha256 });
      totalBytes += bytes.length;
      attachments.push({
        key: ref.key, sha256: ref.sha256, name: ref.name, mime: ref.mime,
        bytes: bytes.length, data: bytesToBase64(bytes),
      });
    } catch (error) {
      broken.push(`${ref.name}（${ref.key}）：${error instanceof Error ? error.message : '读取失败'}`);
    }
  }
  if (broken.length) {
    throw new AttachmentError(`有 ${broken.length} 个附件无法读取，已中止导出：${broken.join('；')}`);
  }
  const archive: AttachmentArchive = {
    kind: ATTACHMENT_ARCHIVE_KIND,
    schemaVersion: ATTACHMENT_ARCHIVE_SCHEMA_VERSION,
    exportedAt: now,
    appVersion: APP_VERSION,
    documents: refs.map((ref) => ({
      sessionKey: ref.sessionKey, documentId: ref.documentId, key: ref.key,
      sha256: ref.sha256, originalName: ref.name,
    })),
    attachments,
  };
  const text = JSON.stringify(archive);
  if (text.length > MAX_ARCHIVE_BYTES) {
    throw new AttachmentError(`含附件备份约 ${formatMiB(text.length)}，超过 ${formatMiB(MAX_ARCHIVE_BYTES)} 上限；请先精简附件或分月导出`);
  }
  return { text, attachmentCount: attachments.length, totalBytes };
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** 导入前解析：只做结构校验，不写任何数据。 */
export function parseAttachmentArchive(text: string): ArchiveParseResult {
  if (text.length > MAX_ARCHIVE_BYTES) {
    return { ok: false, error: `含附件备份超过 ${formatMiB(MAX_ARCHIVE_BYTES)} 上限，已拒绝导入` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '归档结构无效' };
  const archive = value as Partial<AttachmentArchive>;
  if (archive.kind !== ATTACHMENT_ARCHIVE_KIND) return { ok: false, error: '这不是含附件备份文件（kind 不匹配）' };
  if (archive.schemaVersion !== ATTACHMENT_ARCHIVE_SCHEMA_VERSION) {
    return { ok: false, error: `归档 schemaVersion ${String(archive.schemaVersion)} 不受支持，请升级应用` };
  }
  if (!Array.isArray(archive.attachments) || !Array.isArray(archive.documents)) {
    return { ok: false, error: '归档缺少 attachments 或 documents 列表' };
  }
  if (archive.attachments.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `归档包含 ${archive.attachments.length} 个附件，超过 ${MAX_ATTACHMENTS} 上限` };
  }
  for (const entry of archive.attachments) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: '附件条目结构无效' };
    if (typeof entry.key !== 'string' || !isAttachmentKey(entry.key)) return { ok: false, error: '附件键无效' };
    if (typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256)) return { ok: false, error: `附件 ${entry.key} 的哈希无效` };
    if (typeof entry.name !== 'string' || !entry.name || entry.name.length > 255) return { ok: false, error: `附件 ${entry.key} 的文件名无效` };
    if (typeof entry.mime !== 'string' || entry.mime.length > 120) return { ok: false, error: `附件 ${entry.key} 的类型无效` };
    if (!Number.isSafeInteger(entry.bytes) || (entry.bytes as number) < 0) return { ok: false, error: `附件 ${entry.key} 的大小无效` };
    if (typeof entry.data !== 'string' || !BASE64_TEXT.test(entry.data)) return { ok: false, error: `附件 ${entry.key} 的内容不是合法 base64` };
    if (decodedByteLength(entry.data) !== entry.bytes) return { ok: false, error: `附件 ${entry.key} 声明大小与实际内容不一致` };
  }
  return { ok: true, archive: archive as AttachmentArchive };
}

/**
 * 导入：先全量解码校验哈希（任何一项不符即整批拒绝），再逐项写入。
 * 已存在且内容哈希一致的项记为跳过，重复导入幂等。
 */
export async function importAttachmentArchive(archive: AttachmentArchive): Promise<ArchiveImportResult> {
  const verified: Array<{ entry: AttachmentArchiveEntry; bytes: Uint8Array }> = [];
  const mismatched: string[] = [];
  for (const entry of archive.attachments) {
    const bytes = base64ToBytes(entry.data);
    const hash = await sha256Hex(bytes);
    if (hash !== entry.sha256) mismatched.push(`${entry.name}（声明 ${entry.sha256.slice(0, 12)}… 实际 ${hash.slice(0, 12)}…）`);
    verified.push({ entry, bytes });
  }
  if (mismatched.length) {
    throw new AttachmentError(`有 ${mismatched.length} 个附件哈希不符，已整批拒绝写入：${mismatched.join('；')}`);
  }
  const failures: Array<{ key: string; reason: string }> = [];
  let imported = 0;
  let skipped = 0;
  for (const { entry, bytes } of verified) {
    try {
      const existing = await attachmentBackend().read(entry.key);
      if (existing !== null) {
        const existingBytes = base64ToBytes(existing);
        const existingHash = await sha256Hex(existingBytes);
        if (existingHash === entry.sha256) skipped += 1;
        else failures.push({ key: entry.key, reason: '同键已存在但内容不一致，未覆盖' });
        continue;
      }
      const written = await putAttachment({ name: entry.name, mime: entry.mime, bytes });
      if (written.key !== entry.key || written.sha256 !== entry.sha256) {
        failures.push({ key: entry.key, reason: '写入后校验不一致' });
        continue;
      }
      imported += 1;
    } catch (error) {
      failures.push({ key: entry.key, reason: error instanceof Error ? error.message : '写入失败' });
    }
  }
  return { imported, skipped, failed: failures.length, failures };
}

/** 预览：统计归档里有多少附件已经存在（用于导入前告知用户会跳过什么）。 */
export async function countExistingAttachments(archive: AttachmentArchive): Promise<{ existing: number; missing: number }> {
  const backend = attachmentBackend();
  let existing = 0;
  for (const entry of archive.attachments) {
    if (await backend.exists(entry.key)) existing += 1;
  }
  return { existing, missing: archive.attachments.length - existing };
}
