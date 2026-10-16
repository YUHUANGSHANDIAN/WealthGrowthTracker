/** 附件键与编解码的单一来源：内容寻址键 `monthly-attach:<sha256>.<ext>`。 */
export const ATTACHMENT_PREFIX = 'monthly-attach:';

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

/** 键 → 数据根下的相对路径；键已被 `isAttachmentKey` 校验过，不含路径分隔符。 */
export function attachmentFileName(key: string): string {
  if (!isAttachmentKey(key)) throw new AttachmentError('附件引用无效');
  return key.slice(ATTACHMENT_PREFIX.length);
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
