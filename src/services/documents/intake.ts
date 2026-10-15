import type { Platform, SourceDocument } from '../../domain/portfolio/types';

/** 单个来源文件上限：防止把超大导出文件直接读进内存。 */
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

export type DocumentKind = 'docx' | 'image' | 'markdown' | 'text' | 'csv';

const EXTENSIONS: Record<string, DocumentKind> = {
  docx: 'docx',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', bmp: 'image', heic: 'image',
  md: 'markdown', txt: 'text', csv: 'csv',
};

export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match ? match[1]!.toLowerCase() : '';
}

export function classifyDocument(name: string, mime = ''): DocumentKind | null {
  const extension = fileExtension(name);
  if (EXTENSIONS[extension]) return EXTENSIONS[extension];
  if (mime.includes('wordprocessingml')) return 'docx';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/csv')) return 'csv';
  if (mime.startsWith('text/markdown')) return 'markdown';
  if (mime.startsWith('text/')) return 'text';
  return null;
}

export function assertIntakeAllowed(name: string, byteLength: number): DocumentKind {
  if (!Number.isFinite(byteLength) || byteLength <= 0) throw new Error('文件为空或大小无效');
  if (byteLength > MAX_SOURCE_BYTES) throw new Error(`文件超过 ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB 上限，请先导出缩小后的版本`);
  const kind = classifyDocument(name);
  if (!kind) throw new Error(`不支持的文件类型：${name}`);
  return kind;
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 私有相对路径：只保存相对数据根的引用，按内容哈希分桶。 */
export function privateRelativePath(hash: string, name: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('哈希无效');
  const extension = fileExtension(name) || 'bin';
  return `monthly-planning/${hash.slice(0, 2)}/${hash}.${extension}`;
}

export function detectPlatform(name: string): Platform {
  if (/微信|理财通/.test(name)) return 'wechat';
  if (/支付宝|余额宝|帮你投/.test(name)) return 'alipay';
  if (/京东|白条/.test(name)) return 'jd';
  if (/手工|manual/i.test(name)) return 'manual';
  return 'other';
}

export interface IntakeInput {
  id: string;
  name: string;
  mime: string;
  byteLength: number;
  hash: string;
  importedAt: string;
  declaredDate?: string;
  scopeNote?: string;
}

export interface IntakeResult {
  document: SourceDocument;
  /** 命中同哈希既有文件时返回其 ID，不重复入库 */
  duplicateOf?: string;
}

/** 文件级幂等：内容哈希相同即视为同一份证据，不重复建立文档。 */
export function intakeDocument(input: IntakeInput, existing: readonly SourceDocument[]): IntakeResult {
  const kind = assertIntakeAllowed(input.name, input.byteLength);
  const duplicate = existing.find((document) => document.sha256 === input.hash);
  if (duplicate) {
    return {
      document: duplicate,
      duplicateOf: duplicate.id,
    };
  }
  const document: SourceDocument = {
    id: input.id,
    relativePath: privateRelativePath(input.hash, input.name),
    sha256: input.hash,
    originalName: input.name,
    mime: input.mime || kind,
    platform: detectPlatform(input.name),
    ...(input.declaredDate ? { declaredDate: input.declaredDate } : {}),
    importedAt: input.importedAt,
    ...(input.scopeNote ? { scopeNote: input.scopeNote } : {}),
    integrity: 'ok',
    parseState: 'pending',
  };
  return { document };
}
