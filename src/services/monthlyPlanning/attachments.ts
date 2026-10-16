import { attachmentBackend } from './attachmentStore';
import {
  ATTACHMENT_PREFIX, AttachmentError, attachmentKey, base64ToBytes, bytesToBase64, isAttachmentKey, sha256Hex,
} from './attachmentCodec';

/**
 * 附件库：内容寻址存储，状态里只保留引用 + SHA-256。
 * 桌面端落在数据根下的 `monthly-planning/attachments/`，浏览器端落在适配器键上；
 * 无论哪种，**状态文件本身都不再承载附件内容**（否则每次保存都要重写几 MB）。
 */
export { ATTACHMENT_PREFIX, AttachmentError, attachmentKey, isAttachmentKey, base64ToBytes, bytesToBase64, sha256Hex };

export interface AttachmentRef {
  key: string;
  sha256: string;
  bytes: number;
  mime: string;
  name: string;
}

export async function putAttachment(input: { name: string; mime: string; bytes: Uint8Array }): Promise<AttachmentRef> {
  if (!input.bytes.length) throw new AttachmentError('附件为空');
  const hash = await sha256Hex(input.bytes);
  const key = attachmentKey(hash, input.name);
  const backend = attachmentBackend();
  if (await backend.exists(key)) {
    return { key, sha256: hash, bytes: input.bytes.length, mime: input.mime, name: input.name };
  }
  await backend.write(key, bytesToBase64(input.bytes));
  return { key, sha256: hash, bytes: input.bytes.length, mime: input.mime, name: input.name };
}

export async function getAttachment(ref: Pick<AttachmentRef, 'key' | 'sha256'>): Promise<Uint8Array> {
  if (!isAttachmentKey(ref.key)) throw new AttachmentError('附件引用无效');
  const raw = await attachmentBackend().read(ref.key);
  if (raw === null) throw new AttachmentError('附件不存在（可能已被清理）');
  const bytes = base64ToBytes(raw);
  const hash = await sha256Hex(bytes);
  if (hash !== ref.sha256) throw new AttachmentError('附件哈希不符，已阻止使用');
  return bytes;
}

/** 单个明确键的删除；不做前缀批删。 */
export async function removeAttachment(key: string): Promise<void> {
  if (!isAttachmentKey(key)) throw new AttachmentError('附件引用无效，拒绝删除');
  await attachmentBackend().remove(key);
}

export async function verifyAttachment(ref: Pick<AttachmentRef, 'key' | 'sha256'>): Promise<{ ok: boolean; reason?: string }> {
  try {
    await getAttachment(ref);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '附件校验失败' };
  }
}

export async function verifyAttachments(refs: ReadonlyArray<Pick<AttachmentRef, 'key' | 'sha256'>>): Promise<Array<{ key: string; ok: boolean; reason?: string }>> {
  const results: Array<{ key: string; ok: boolean; reason?: string }> = [];
  for (const ref of refs) {
    const result = await verifyAttachment(ref);
    results.push({ key: ref.key, ...result });
  }
  return results;
}
