import type { StorageAdapter } from './types';
import type { FileSystem } from './fs';

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
  const tmp = `${relPath}.tmp`;
  await fs.writeTextFile(tmp, content);
  await fs.rename(tmp, relPath);
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
      const name = `${prefix}_${fileTimestamp()}.json`;
      await this.fs.copyFile(STATE_PATH, `${BACKUPS_DIR}/${name}`);
      if (!manual) await this.rotateAutoBackups();
      return name;
    } catch (err) {
      console.warn('[desktop] 备份失败:', err);
      return null;
    }
  }

  /** 自动备份轮换：仅清理旧的自动备份，保留最近 60 个，绝不删除手动备份。 */
  private async rotateAutoBackups(): Promise<void> {
    const files = await this.listBackups();
    const auto = files.filter((f) => f.startsWith('wealth-backup_') && !f.includes('_manual_')).sort();
    while (auto.length > 60) {
      const oldest = auto.shift();
      if (oldest) await this.fs.removeFile(`${BACKUPS_DIR}/${oldest}`).catch(() => {});
    }
  }

  async listBackups(): Promise<string[]> {
    try {
      const entries = await this.fs.readDir(BACKUPS_DIR);
      return entries.filter((n) => n.endsWith('.json')).sort().reverse();
    } catch {
      return [];
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

  /** 从备份恢复主数据文件（原子）。 */
  async restoreBackup(name: string): Promise<void> {
    await this.ensureDirs();
    await this.fs.copyFile(`${BACKUPS_DIR}/${name}`, STATE_PATH);
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
  private lastAutoBackupDate = '';

  constructor(private fs: FileSystem) {
    this.manager = new DesktopDataManager(fs);
  }

  private ensureInit(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.load();
    return this.initPromise;
  }

  /** 从文件重新加载（用于「从备份恢复」后刷新内存缓存）。 */
  async reload(): Promise<void> {
    this.initPromise = null;
    this.cache = {};
    await this.load();
  }

  private async load(): Promise<void> {
    await this.manager.ensureDirs();
    let raw: string | null = null;
    try {
      raw = await this.fs.readTextFile(STATE_PATH);
    } catch {
      raw = null; // 首次运行
    }
    if (raw == null) return;

    try {
      this.cache = JSON.parse(raw) as Record<string, string>;
    } catch {
      // 损坏：保留原文件，尝试最近备份恢复
      await this.manager.preserveCorruptState();
      const latest = await this.manager.latestBackup();
      if (latest) {
        try {
          const backupRaw = await this.fs.readTextFile(`${BACKUPS_DIR}/${latest}`);
          this.cache = JSON.parse(backupRaw) as Record<string, string>;
        } catch {
          this.cache = {};
        }
      } else {
        this.cache = {};
      }
    }
  }

  async getItem(key: string): Promise<string | null> {
    await this.ensureInit();
    return this.cache[key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.ensureInit();
    this.cache[key] = value;
    this.scheduleFlush();
  }

  async removeItem(key: string): Promise<void> {
    await this.ensureInit();
    delete this.cache[key];
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 500);
  }

  /** 立即持久化（也用于应用退出前）。 */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      await atomicWrite(this.fs, STATE_PATH, JSON.stringify(this.cache, null, 2));
      await this.autoBackupIfDue();
    } catch (err) {
      console.warn('[desktop] 写入失败:', err);
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
