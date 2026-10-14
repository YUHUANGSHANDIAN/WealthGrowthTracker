import type { StorageAdapter } from './types';
import type { FileSystem } from './fs';
import { APP_VERSION } from '../../constants/version';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { inspectRecoveryCandidate } from './recoveryCandidate';
import { REPORT_SCHEMA_VERSION } from '../../features/reports/normalize';

/** 数据目录名（用户可在资源管理器中直接找到）。 */
export const DATA_FOLDER = '财富成长记';
export const STATE_PATH = 'data/app-state.json';
export const BACKUPS_DIR = 'backups';
export const REPORTS_DIR = 'reports';
export const EXPORTS_DIR = 'exports';

export type ReportKind = 'weekly' | 'monthly' | 'yearly';

function fileTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 原子写入：先写临时文件，再 rename 覆盖，降低断电/崩溃造成 JSON 损坏的风险。 */
async function atomicWrite(fs: FileSystem, relPath: string, content: string): Promise<void> {
  const dir = relPath.split('/').slice(0, -1).join('/');
  if (dir) await fs.mkdir(dir);
  const tmp = `${relPath}.${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}.tmp`;
  await fs.writeTextFile(tmp, content);
  await fs.rename(tmp, relPath);
}

export type StorageRecoveryReason = 'config' | 'unavailable' | 'permission' | 'corrupt' | 'invalid-state' | 'future-schema';

/** A desktop read failed; callers must enter recovery instead of hydrating empty defaults. */
export class StorageRecoveryError extends Error {
  constructor(readonly reason: StorageRecoveryReason, message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StorageRecoveryError';
  }
}

export class StorageWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StorageWriteError';
  }
}

/** 桌面数据目录管理器：目录结构、自动/手动备份、恢复、报告文件输出。 */
export class DesktopDataManager {
  constructor(private fs: FileSystem) {}

  async ensureDirs(): Promise<void> {
    await this.fs.mkdir('data');
    await this.fs.mkdir(BACKUPS_DIR);
    await this.fs.mkdir(`${REPORTS_DIR}/weekly`);
    await this.fs.mkdir(`${REPORTS_DIR}/monthly`);
    await this.fs.mkdir(`${REPORTS_DIR}/yearly`);
    await this.fs.mkdir(EXPORTS_DIR);
  }

  /** 把当前主数据文件备份到 backups/（manual 标记为手动，永不自动清理）。 */
  async backupNow(manual = false): Promise<string | null> {
    try {
      await this.ensureDirs();
      const exists = await this.fs.exists(STATE_PATH);
      if (!exists) return null;
      const prefix = manual ? 'wealth-backup_manual' : 'wealth-backup';
      const name = `${prefix}_${fileTimestamp()}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}.json`;
      await this.fs.copyFile(STATE_PATH, `${BACKUPS_DIR}/${name}`);
      const original = await this.fs.readTextFile(STATE_PATH);
      const copied = await this.fs.readTextFile(`${BACKUPS_DIR}/${name}`);
      parseState(copied, '备份文件');
      if (original !== copied) throw new Error('备份读回校验失败');
      return name;
    } catch (err) {
      console.warn('[desktop] 备份失败:', err);
      throw new StorageWriteError('创建数据备份失败', err);
    }
  }

  // Retention is manual: never bulk-delete user backups.

  async listBackups(): Promise<string[]> {
    try {
      const entries = await this.fs.readDir(BACKUPS_DIR);
      return entries.filter((n) => n.endsWith('.json')).sort().reverse();
    } catch (cause) {
      throw new StorageWriteError('无法读取备份列表', cause);
    }
  }

  /** 最新一次备份文件名（无论手动/自动）。 */
  async latestBackup(): Promise<string | null> {
    const backups = await this.listBackups();
    return backups[0] ?? null;
  }

  /** 今天是否已有自动备份。 */
  async hasAutoBackupToday(): Promise<boolean> {
    const today = fileTimestamp().slice(0, 10);
    const backups = await this.listBackups();
    return backups.some((f) => f.startsWith('wealth-backup_') && f.includes(today));
  }

  async inspectBackup(name: string): Promise<{ raw: string; payload: Record<string, string> }> {
    if (!/^wealth-backup(?:_manual)?_[\w-]+\.json$/.test(name)) throw new Error('无效的备份文件名');
    const raw = await this.fs.readTextFile(`${BACKUPS_DIR}/${name}`);
    return { raw, payload: parseState(raw, '备份文件') };
  }

  /** Restore only after preserving and verifying the original bytes, even if corrupt. */
  async restoreBackup(name: string, expectedRaw?: string): Promise<void> {
    const { raw } = await this.inspectBackup(name);
    if (expectedRaw !== undefined && raw !== expectedRaw) throw new Error('备份已变化，请重新预览');
    try {
      inspectRecoveryCandidate(raw);
    } catch (cause) {
      throw new StorageRecoveryError('invalid-state', '备份财务数据无效，主文件保持原样', cause);
    }
    await this.ensureDirs();
    if (await this.fs.exists(STATE_PATH)) {
      const original = await this.fs.readTextFile(STATE_PATH);
      try {
        const originalPayload = parseState(original, '原主数据文件');
        const originalReports: unknown = JSON.parse(originalPayload[STORAGE_KEYS.financialReports] ?? 'null');
        if (Array.isArray(originalReports) && originalReports.some(report =>
          report && typeof report === 'object' && typeof report.reportSchemaVersion === 'number' && report.reportSchemaVersion > REPORT_SCHEMA_VERSION)) {
          throw new StorageRecoveryError('future-schema', '原主文件含更新版本报告，当前版本禁止覆盖');
        }
      } catch (error) {
        if (error instanceof StorageRecoveryError && error.reason === 'future-schema') throw error;
      }
      const preserved = `${STATE_PATH}.preserved-${globalThis.crypto.randomUUID()}`;
      await this.fs.copyFile(STATE_PATH, preserved);
      if (await this.fs.readTextFile(preserved) !== original) throw new StorageWriteError('恢复前原文件保留校验失败');
    }
    await atomicWrite(this.fs, STATE_PATH, raw);
    if (await this.fs.readTextFile(STATE_PATH) !== raw) throw new StorageWriteError('恢复后读回校验失败；原文件已保留');
  }

  /** 把损坏的主文件重命名保留，避免被空数据覆盖。 */
  async preserveCorruptState(): Promise<void> {
    try {
      const exists = await this.fs.exists(STATE_PATH);
      if (!exists) return;
      await this.fs.rename(STATE_PATH, `${STATE_PATH}.corrupt-${fileTimestamp()}`);
    } catch (err) {
      console.warn('[desktop] 保留损坏文件失败:', err);
    }
  }

  /** 写入一份报告（JSON + 可选 HTML）到 reports/{type}/。 */
  async writeReport(kind: ReportKind, fileName: string, jsonContent: string, htmlContent?: string): Promise<void> {
    const dir = `${REPORTS_DIR}/${kind}`;
    await this.fs.mkdir(dir);
    await atomicWrite(this.fs, `${dir}/${fileName}.json`, jsonContent);
    if (htmlContent) await atomicWrite(this.fs, `${dir}/${fileName}.html`, htmlContent);
  }

  /** 写入 reports/index.json（报告索引，供维护，不作为第二数据库）。 */
  async writeReportIndex(indexJson: string): Promise<void> {
    await this.fs.mkdir(REPORTS_DIR);
    await atomicWrite(this.fs, `${REPORTS_DIR}/index.json`, indexJson);
  }
}

/**
 * 桌面文件存储适配器：把所有 storage key 缓存到内存，序列化后 debounce 原子写入
 * data/app-state.json。读取到损坏数据时保留损坏文件并尝试最近备份恢复。
 */
export class DesktopFileStorageAdapter implements StorageAdapter {
  readonly name = 'desktop' as const;
  readonly manager: DesktopDataManager;
  private cache: Record<string, string> = {};
  private initPromise: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private persistedPayload: string | null = null;
  private writePaused = false;
  private lastAutoBackupDate = '';
  private envelopeMetadata: Record<string, unknown> = {};
  private storageRevision = 0;
  private legacyNeedsBackup = false;

  constructor(private fs: FileSystem) {
    this.manager = new DesktopDataManager(fs);
  }

  private ensureInit(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.load();
    return this.initPromise;
  }

  /** 从文件重新加载（用于「从备份恢复」后刷新内存缓存）。 */
  async reload(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.writeQueue;
    this.initPromise = this.load();
    await this.initPromise;
  }

  private async load(): Promise<void> {
    this.cache = {};
    this.persistedPayload = null;
    this.envelopeMetadata = {};
    this.storageRevision = 0;
    this.legacyNeedsBackup = false;
    this.lastAutoBackupDate = '';
    try {
      await this.manager.ensureDirs();
    } catch (err) {
      throw new StorageRecoveryError('unavailable', '无法访问数据目录', err);
    }
    let raw: string | null = null;
    try {
      raw = await this.fs.readTextFile(STATE_PATH);
    } catch (err) {
      if (!(await this.fs.exists(STATE_PATH))) return; // confirmed first run
      throw new StorageRecoveryError('permission', '无法读取主数据文件', err);
    }
    if (raw == null) throw new StorageRecoveryError('corrupt', '主数据文件读取结果为空');

    try {
      const parsed = parseStorageState(raw, '主数据文件');
      this.cache = parsed.payload;
      this.persistedPayload = JSON.stringify(parsed.payload);
      this.envelopeMetadata = parsed.metadata;
      this.storageRevision = parsed.revision;
      this.legacyNeedsBackup = parsed.legacy;
    } catch (error) {
      if (error instanceof StorageRecoveryError && error.reason === 'future-schema') throw error;
      // Corrupt input is preserved, but never auto-promoted into a writeable empty state.
      const latest = await this.manager.latestBackup();
      if (latest) {
        try {
          const backupRaw = await this.fs.readTextFile(`${BACKUPS_DIR}/${latest}`);
          this.cache = parseState(backupRaw, '备份文件');
          throw new StorageRecoveryError('corrupt', `主数据文件损坏；已找到可选备份 ${latest}`, error);
        } catch (backupError) {
          if (backupError instanceof StorageRecoveryError) throw backupError;
          throw new StorageRecoveryError('corrupt', `主数据文件与备份 ${latest} 均无法读取`, backupError);
        }
      } else {
        throw new StorageRecoveryError('corrupt', '主数据文件损坏，且没有可用备份', error);
      }
    }
  }

  /** Drain writes at the storage boundary before migration, backup, or shutdown. */
  async drain(): Promise<void> {
    await this.flush();
    await this.writeQueue;
  }

  pauseWrites(): void { this.writePaused = true; }
  resumeWrites(): void { this.writePaused = false; }

  async getItem(key: string): Promise<string | null> {
    await this.ensureInit();
    return this.cache[key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.ensureInit();
    if (this.writePaused) throw new StorageWriteError('数据目录正在迁移，暂时不能写入');
    this.cache[key] = value;
    this.scheduleFlush();
  }

  async setItems(entries: ReadonlyArray<{ key: string; value: string }>): Promise<void> {
    await this.ensureInit();
    if (this.writePaused) throw new StorageWriteError('数据目录正在迁移，暂时不能写入');
    const next = { ...this.cache };
    for (const { key, value } of entries) next[key] = value;
    this.cache = next;
    // The Store already coalesces edits. A business batch has one disk commit,
    // without a second debounce window in the adapter.
    await this.flush();
  }

  async removeItem(key: string): Promise<void> {
    await this.ensureInit();
    if (this.writePaused) throw new StorageWriteError('数据目录正在迁移，暂时不能写入');
    delete this.cache[key];
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { void this.flush().catch((err) => console.error('[desktop] 写入失败:', err)); }, 500);
  }

  /** 立即持久化（也用于应用退出前）。 */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.ensureInit();
    if (this.writePaused) throw new StorageWriteError('数据目录正在迁移，无法刷新');
    // Capture now; queued writers must not observe later cache mutations.
    const payload = JSON.stringify(this.cache);
    const write = this.writeQueue.then(async () => {
      if (payload === this.persistedPayload && !this.legacyNeedsBackup) {
        await this.autoBackupIfDue();
        return;
      }
      if (this.legacyNeedsBackup) {
        const backup = await this.manager.backupNow(true);
        if (!backup) throw new StorageWriteError('旧数据升级前备份不可用');
        this.legacyNeedsBackup = false;
      }
      const revision = this.storageRevision + 1;
      const snapshot = JSON.stringify({
        ...this.envelopeMetadata,
        storageSchemaVersion: 1,
        appVersion: APP_VERSION,
        revision,
        updatedAt: new Date().toISOString(),
        payload: JSON.parse(payload),
      }, null, 2);
      await atomicWrite(this.fs, STATE_PATH, snapshot);
      this.storageRevision = revision;
      this.persistedPayload = payload;
      await this.autoBackupIfDue();
    });
    this.writeQueue = write.catch(() => {});
    try {
      await write;
    } catch (err) {
      throw new StorageWriteError('数据文件写入或自动备份失败', err);
    }
  }

  /** 每天首次持久化时自动备份一次。 */
  private async autoBackupIfDue(): Promise<void> {
    const today = fileTimestamp().slice(0, 10);
    if (this.lastAutoBackupDate === today) return;
    const has = await this.manager.hasAutoBackupToday();
    if (!has) await this.manager.backupNow(false);
    this.lastAutoBackupDate = today;
  }
}

function parseState(raw: string, label: string): Record<string, string> {
  return parseStorageState(raw, label).payload;
}

function parseStorageState(raw: string, label: string): {
  payload: Record<string, string>; metadata: Record<string, unknown>; revision: number; legacy: boolean;
} {
  let value: unknown;
  try { value = JSON.parse(raw); } catch (cause) { throw new StorageRecoveryError('corrupt', `${label}不是有效 JSON`, cause); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageRecoveryError('invalid-state', `${label}结构无效`);
  }
  let metadata: Record<string, unknown> = {};
  let payload: unknown = value;
  let revision = 0;
  const legacy = !('storageSchemaVersion' in value);
  if (!legacy) {
    const envelope = value as Record<string, unknown>;
    if (typeof envelope.storageSchemaVersion === 'number' && envelope.storageSchemaVersion > 1) {
      throw new StorageRecoveryError('future-schema', `${label}来自更新版本，请使用对应新版应用；当前版本禁止写入`);
    }
    if (envelope.storageSchemaVersion !== 1 || !Number.isSafeInteger(envelope.revision) || (envelope.revision as number) < 0) {
      throw new StorageRecoveryError('invalid-state', `${label}存储 Envelope 无效`);
    }
    payload = envelope.payload;
    revision = envelope.revision as number;
    metadata = { ...envelope };
    delete metadata.payload;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.values(payload).some(item => typeof item !== 'string')) {
    throw new StorageRecoveryError('invalid-state', `${label}结构无效`);
  }
  return { payload: payload as Record<string, string>, metadata, revision, legacy };
}
