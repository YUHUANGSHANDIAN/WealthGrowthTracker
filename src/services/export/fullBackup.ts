import { APP_VERSION } from '../../constants/version';
import { BUILD_COMMIT, BUILD_ID } from '../../constants/buildInfo';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { STORAGE_VERSION_KEY } from '../../constants/version';
import type { MonthlyPlanningState } from '../../domain/portfolio/types';
import { storageService } from '../storage';
import { collectAttachmentRefs } from '../monthlyPlanning/attachmentArchive';
import { getAttachment } from '../monthlyPlanning/attachments';
import { attachmentFileName } from '../monthlyPlanning/attachmentCodec';
import { parseMonthlyPlanningState } from '../monthlyPlanning/storage';
import { inspectRecoveryCandidate } from '../storage/recoveryCandidate';
import {
  parseGoalScenarioState,
  parseHealthReviewState,
  parseLedgerIdentity,
  parseReportRevisionState,
  parseWorkspaceDraftState,
  parseWorkspaceViewState,
} from '../../domain/workspace/state';
import {
  HEALTH_ASSISTANT_STORAGE_KEY,
  parseHealthAssistantState,
} from '../../domain/healthAssistant/state';

export const FULL_BACKUP_FORMAT = 'wealth-growth-tracker-full-backup';
export const FULL_BACKUP_FORMAT_VERSION = 1;
export const FULL_BACKUP_MAX_BYTES = 512 * 1024 * 1024;
export const FULL_BACKUP_MAX_FILES = 2_048;

export interface FullBackupFile {
  relativePath: string;
  bytes: number;
  sha256: string;
}

export interface FullBackupManifest {
  kind: typeof FULL_BACKUP_FORMAT;
  formatVersion: 1;
  appVersion: string;
  buildId: string;
  buildCommit: string;
  createdAt: string;
  storageSchemaVersion: 1;
  monthlySchemaVersion: 2;
  classificationSchemaVersion?: 1;
  workspaceSchemaVersion?: 1;
  healthAssistantSchemaVersion?: 1;
  fileCount: number;
  totalBytes: number;
  files: FullBackupFile[];
}

export interface RestoreRootFile {
  relativePath: string;
  sha256: string;
  contentBase64: string;
}

export interface FullBackupBuildResult {
  archive: Uint8Array;
  manifest: FullBackupManifest;
  filename: string;
  sha256: string;
}

export interface ParsedFullBackup {
  manifest: FullBackupManifest;
  stateText: string;
  aiMetadataText: string | null;
  files: RestoreRootFile[];
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc32: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Deterministic STORE-only ZIP. It avoids a second dependency and never silently compresses/encrypts data. */
export function createStoredZip(entries: readonly ZipEntry[], now = new Date()): Uint8Array {
  if (entries.length > FULL_BACKUP_MAX_FILES) throw new Error('完整备份文件数超过上限');
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.data.length > 0xffffffff || offset > 0xffffffff) throw new Error('完整备份超过 ZIP32 上限');
    const name = encoder.encode(safeZipName(entry.name));
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(entry.crc32), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(local, entry.data);
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(entry.crc32), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length + entry.data.length;
  }
  const central = concat(centralParts);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return concat([...localParts, central, eocd]);
}

function readU16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error('ZIP 结构越界');
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error('ZIP 结构越界');
  return view.getUint32(offset, true);
}

function safeZipName(name: string): string {
  if (!name || name.length > 512 || name.startsWith('/') || name.includes('\\')
    || name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`ZIP 包含不安全路径：${name}`);
  }
  return name;
}

export function parseStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (!bytes.length || bytes.length > FULL_BACKUP_MAX_BYTES) throw new Error('完整备份大小无效');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 完整备份');
  if (readU16(view, eocd + 4) !== 0 || readU16(view, eocd + 6) !== 0) throw new Error('不支持分卷 ZIP');
  const count = readU16(view, eocd + 10);
  const centralSize = readU32(view, eocd + 12);
  const centralOffset = readU32(view, eocd + 16);
  if (count === 0 || count > FULL_BACKUP_MAX_FILES) throw new Error('完整备份文件数无效');
  if (centralOffset + centralSize > eocd) throw new Error('ZIP 中央目录越界');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const output = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < count; index += 1) {
    if (readU32(view, cursor) !== 0x02014b50) throw new Error('ZIP 中央目录项无效');
    const flags = readU16(view, cursor + 8);
    const method = readU16(view, cursor + 10);
    const crc = readU32(view, cursor + 16);
    const compressedSize = readU32(view, cursor + 20);
    const size = readU32(view, cursor + 24);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    if (flags & 1) throw new Error('不支持加密 ZIP');
    if (method !== 0 || compressedSize !== size) throw new Error('完整备份必须使用无压缩 ZIP 条目');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeZipName(decoder.decode(nameBytes));
    if (output.has(name)) throw new Error(`ZIP 条目重复：${name}`);
    if (readU32(view, localOffset) !== 0x04034b50) throw new Error(`ZIP 本地头无效：${name}`);
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + size > bytes.length) throw new Error(`ZIP 数据越界：${name}`);
    const data = bytes.slice(dataOffset, dataOffset + size);
    if (crc32(data) !== crc) throw new Error(`ZIP 校验失败：${name}`);
    totalBytes += size;
    if (totalBytes > FULL_BACKUP_MAX_BYTES) throw new Error('完整备份解压后超过上限');
    output.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('ZIP 中央目录长度不一致');
  return output;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function timestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
}

async function captureStateEnvelope(revision: number, includeHealthAssistantConversations: boolean): Promise<string> {
  const keys = new Set<string>([STORAGE_VERSION_KEY, ...Object.values(STORAGE_KEYS)]);
  const listed = await storageService.listRawKeys('');
  for (const key of listed ?? []) keys.add(key);
  if (includeHealthAssistantConversations) keys.add(HEALTH_ASSISTANT_STORAGE_KEY);
  else keys.delete(HEALTH_ASSISTANT_STORAGE_KEY);
  const payload: Record<string, string> = {};
  for (const key of [...keys].sort()) {
    const value = await storageService.getRaw(key);
    if (value !== null) payload[key] = value;
  }
  return JSON.stringify({ storageSchemaVersion: 1, revision, payload }, null, 2);
}

function sanitizeAiMetadata(raw: string | null): string | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  assertNoSecrets(parsed);
  return JSON.stringify(parsed);
}

function assertNoSecrets(parsed: unknown): void {
  const forbidden = /^(api.?key|token|secret|authorization|password)$/i;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.test(key)) throw new Error(`AI 元数据包含不应进入备份的字段：${key}`);
      visit(child);
    }
  };
  visit(parsed);
}

export async function buildFullBackup(input: {
  revision: number;
  monthlyPlanning: MonthlyPlanningState;
  aiMetadata?: string | null;
  includeHealthAssistantConversations?: boolean;
  now?: Date;
}): Promise<FullBackupBuildResult> {
  const now = input.now ?? new Date();
  const includeHealthAssistantConversations = input.includeHealthAssistantConversations === true;
  const stateText = await captureStateEnvelope(input.revision, includeHealthAssistantConversations);
  const aiMetadataText = sanitizeAiMetadata(input.aiMetadata ?? null);
  const files: Array<{ path: string; data: Uint8Array }> = [
    { path: 'data/app-state.json', data: new TextEncoder().encode(stateText) },
  ];
  if (aiMetadataText) files.push({ path: 'client-meta/ai-connections.json', data: new TextEncoder().encode(aiMetadataText) });
  for (const ref of collectAttachmentRefs(input.monthlyPlanning)) {
    const bytes = await getAttachment({ key: ref.key, sha256: ref.sha256 });
    files.push({ path: `monthly-planning/attachments/${attachmentFileName(ref.key)}`, data: bytes });
  }
  const manifestFiles: FullBackupFile[] = [];
  for (const file of files) manifestFiles.push({ relativePath: file.path, bytes: file.data.length, sha256: await sha256(file.data) });
  const manifest: FullBackupManifest = {
    kind: FULL_BACKUP_FORMAT,
    formatVersion: FULL_BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    buildId: BUILD_ID,
    buildCommit: BUILD_COMMIT,
    createdAt: now.toISOString(),
    storageSchemaVersion: 1,
    monthlySchemaVersion: 2,
    classificationSchemaVersion: 1,
    workspaceSchemaVersion: 1,
    ...(includeHealthAssistantConversations ? { healthAssistantSchemaVersion: 1 as const } : {}),
    fileCount: manifestFiles.length,
    totalBytes: manifestFiles.reduce((sum, file) => sum + file.bytes, 0),
    files: manifestFiles,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const entries: ZipEntry[] = [
    { name: 'manifest.json', data: manifestBytes, crc32: crc32(manifestBytes) },
    ...files.map((file) => ({ name: file.path, data: file.data, crc32: crc32(file.data) })),
  ];
  const archive = createStoredZip(entries, now);
  return {
    archive,
    manifest,
    filename: `wealth-full-backup_${timestamp(now)}.wgtbackup.zip`,
    sha256: await sha256(archive),
  };
}

export async function parseFullBackup(bytes: Uint8Array): Promise<ParsedFullBackup> {
  const entries = parseStoredZip(bytes);
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) throw new Error('完整备份缺少 manifest.json');
  let manifest: FullBackupManifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as FullBackupManifest;
  } catch {
    throw new Error('完整备份 manifest 不是有效 JSON');
  }
  if (manifest.kind !== FULL_BACKUP_FORMAT || manifest.formatVersion !== FULL_BACKUP_FORMAT_VERSION) {
    throw new Error('完整备份格式或版本不受支持');
  }
  if (manifest.storageSchemaVersion > 1 || manifest.monthlySchemaVersion > 2
    || (manifest.classificationSchemaVersion !== undefined && manifest.classificationSchemaVersion > 1)
    || (manifest.workspaceSchemaVersion !== undefined && manifest.workspaceSchemaVersion > 1)
    || (manifest.healthAssistantSchemaVersion !== undefined && manifest.healthAssistantSchemaVersion > 1)) {
    throw new Error('完整备份来自更新版本，当前版本禁止恢复');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length + 1 !== entries.size
    || manifest.files.length > FULL_BACKUP_MAX_FILES) throw new Error('完整备份文件清单不一致');
  const listed = new Set(manifest.files.map((file) => file.relativePath));
  for (const name of entries.keys()) if (name !== 'manifest.json' && !listed.has(name)) throw new Error(`ZIP 含未登记文件：${name}`);
  const files: RestoreRootFile[] = [];
  let total = 0;
  for (const file of manifest.files) {
    const data = entries.get(file.relativePath);
    if (!data) throw new Error(`完整备份缺少文件：${file.relativePath}`);
    if (data.length !== file.bytes || await sha256(data) !== file.sha256) throw new Error(`完整备份文件校验失败：${file.relativePath}`);
    if (!file.relativePath.startsWith('data/') && !file.relativePath.startsWith('monthly-planning/attachments/')
      && !file.relativePath.startsWith('client-meta/')) throw new Error(`完整备份含不允许的文件：${file.relativePath}`);
    files.push({ relativePath: file.relativePath, sha256: file.sha256, contentBase64: bytesToBase64(data) });
    total += data.length;
  }
  if (total !== manifest.totalBytes || files.length !== manifest.fileCount) throw new Error('完整备份清单统计不一致');
  const stateBytes = entries.get('data/app-state.json');
  if (!stateBytes) throw new Error('完整备份缺少主数据文件');
  const stateText = new TextDecoder('utf-8', { fatal: true }).decode(stateBytes);
  inspectRecoveryCandidate(stateText);
  const envelope = JSON.parse(stateText) as { payload?: Record<string, unknown> };
  if (envelope.payload?.monthly_planning_state) {
    const raw: unknown = typeof envelope.payload.monthly_planning_state === 'string'
      ? JSON.parse(envelope.payload.monthly_planning_state)
      : envelope.payload.monthly_planning_state;
    parseMonthlyPlanningState(raw);
  }
  const payload = envelope.payload ?? {};
  const parseStored = (key: string): unknown => {
    const raw = payload[key];
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string') throw new Error(`完整备份工作区字段无效：${key}`);
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`完整备份工作区字段不是有效 JSON：${key}`);
    }
  };
  parseLedgerIdentity(parseStored(STORAGE_KEYS.ledgerIdentity));
  parseWorkspaceDraftState(parseStored(STORAGE_KEYS.workspaceDrafts));
  parseHealthReviewState(parseStored(STORAGE_KEYS.healthReviews));
  parseReportRevisionState(parseStored(STORAGE_KEYS.reportRevisions));
  parseGoalScenarioState(parseStored(STORAGE_KEYS.goalScenarios));
  parseWorkspaceViewState(parseStored(STORAGE_KEYS.workspaceUi));
  parseHealthAssistantState(parseStored(HEALTH_ASSISTANT_STORAGE_KEY));
  const storedDataRevision = parseStored(STORAGE_KEYS.dataRevision);
  if (storedDataRevision !== undefined
    && (typeof storedDataRevision !== 'number' || !Number.isSafeInteger(storedDataRevision) || storedDataRevision < 0)) {
    throw new Error('完整备份数据 revision 无效');
  }
  const aiBytes = entries.get('client-meta/ai-connections.json');
  const aiMetadataText = aiBytes ? new TextDecoder('utf-8', { fatal: true }).decode(aiBytes) : null;
  if (aiMetadataText) {
    try {
      assertNoSecrets(JSON.parse(aiMetadataText) as unknown);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'AI 连接元数据无效');
    }
  }
  return {
    manifest,
    stateText,
    aiMetadataText,
    files,
  };
}

