import { storageService } from '../storage';
import { StorageWriteError } from '../storage/desktop';

/**
 * 附件库：内容寻址存储，状态里只保留引用 + SHA-256。
 * 存的是独立存储键（`monthly-attach:<sha256>.<ext>`），因此结构化备份不会包含附件内容；
 * 完整含附件备份需要显式枚举这些键。
 */
export const ATTACHMENT_PREFIX = 'monthly-attach:';

export interface AttachmentRef {
  key: string;
  sha256: string;
  bytes: number;
  mime: string;
  name: string;
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

export function attachmentKey(hash: string, name: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new AttachmentError('附件哈希无效');
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? 'bin';
  return `${ATTACHMENT_PREFIX}${hash}.${extension}`;
}

export function isAttachmentKey(key: string): boolean {
  return key.startsWith(ATTACHMENT_PREFIX) && /^[a-f0-9]{64}\.[a-z0-9]+$/.test(key.slice(ATTACHMENT_PREFIX.length));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function putAttachment(input: { name: string; mime: string; bytes: Uint8Array }): Promise<AttachmentRef> {
  if (!input.bytes.length) throw new AttachmentError('附件为空');
  const hash = await sha256Hex(input.bytes);
  const key = attachmentKey(hash, input.name);
  const existing = await storageService.getRaw(key);
  if (existing) {
    return { key, sha256: hash, bytes: input.bytes.length, mime: input.mime, name: input.name };
  }
  try {
    await storageService.setRaw(key, bytesToBase64(input.bytes));
  } catch (error) {
    throw new AttachmentError(`附件保存失败：${error instanceof StorageWriteError ? error.message : '存储不可用'}`);
  }
  return { key, sha256: hash, bytes: input.bytes.length, mime: input.mime, name: input.name };
}

export async function getAttachment(ref: Pick<AttachmentRef, 'key' | 'sha256'>): Promise<Uint8Array> {
  if (!isAttachmentKey(ref.key)) throw new AttachmentError('附件引用无效');
  const raw = await storageService.getRaw(ref.key);
  if (raw === null) throw new AttachmentError('附件不存在（可能已被清理）');
  const bytes = base64ToBytes(raw);
  const hash = await sha256Hex(bytes);
  if (hash !== ref.sha256) throw new AttachmentError('附件哈希不符，已阻止使用');
  return bytes;
}

/** 单个明确键的删除；不做前缀批删。 */
export async function removeAttachment(key: string): Promise<void> {
  if (!isAttachmentKey(key)) throw new AttachmentError('附件引用无效，拒绝删除');
  await storageService.remove(key);
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
