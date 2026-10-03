import { describe, it, expect, beforeEach } from 'vitest';
import type { FileSystem } from '../../src/services/storage/fs';
import {
  DesktopFileStorageAdapter,
  DesktopDataManager,
  STATE_PATH,
  BACKUPS_DIR,
  REPORTS_DIR,
} from '../../src/services/storage/desktop';

/** 内存文件系统：模拟「相对 Documents」的目录树。 */
class MemFS implements FileSystem {
  files = new Map<string, string>();

  async readTextFile(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`not found: ${p}`);
    return v;
  }
  async writeTextFile(p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(_p: string): Promise<void> {
    /* 目录为逻辑概念，无需真实创建 */
  }
  async readDir(p: string): Promise<string[]> {
    const names = new Set<string>();
    for (const k of this.files.keys()) {
      if (k.startsWith(p + '/')) {
        const rest = k.slice(p.length + 1);
        names.add(rest.split('/')[0]!);
      }
    }
    return [...names];
  }
  async removeFile(p: string): Promise<void> {
    this.files.delete(p);
  }
  async copyFile(s: string, d: string): Promise<void> {
    const v = this.files.get(s);
    if (v !== undefined) this.files.set(d, v);
  }
  async rename(s: string, d: string): Promise<void> {
    const v = this.files.get(s);
    if (v !== undefined) {
      this.files.set(d, v);
      this.files.delete(s);
    }
  }
}

describe('桌面文件存储', () => {
  let fs: MemFS;

  beforeEach(() => {
    fs = new MemFS();
  });

  it('首次启动：目录创建、无数据返回 null', async () => {
    const adapter = new DesktopFileStorageAdapter(fs);
    expect(await adapter.getItem('wealth_tracker_data')).toBeNull();
  });

  it('保存 → 落盘 → 重新读取一致', async () => {
    const a1 = new DesktopFileStorageAdapter(fs);
    await a1.setItem('foo', JSON.stringify({ x: 1 }));
    await a1.flush();
    expect(fs.files.has(STATE_PATH)).toBe(true);

    const a2 = new DesktopFileStorageAdapter(fs);
    const raw = await a2.getItem('foo');
    expect(JSON.parse(raw!)).toEqual({ x: 1 });
  });

  it('原子写入：落盘后不残留 .tmp 文件', async () => {
    const a = new DesktopFileStorageAdapter(fs);
    await a.setItem('foo', 'bar');
    await a.flush();
    const tmpFiles = [...fs.files.keys()].filter((k) => k.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
    expect(fs.files.has(STATE_PATH)).toBe(true);
  });

  it('损坏主文件：保留损坏文件并尝试从备份恢复', async () => {
    // 先写一份有效状态 + 一份备份
    const a1 = new DesktopFileStorageAdapter(fs);
    await a1.setItem('foo', JSON.stringify({ ok: true }));
    await a1.flush(); // 触发一次自动备份
    const mgr = new DesktopDataManager(fs);
    const backups = await mgr.listBackups();
    expect(backups.length).toBeGreaterThan(0);

    // 破坏主文件
    fs.files.set(STATE_PATH, '{{{ not valid json');

    const a2 = new DesktopFileStorageAdapter(fs);
    // 应能从备份恢复
    expect(JSON.parse((await a2.getItem('foo'))!)).toEqual({ ok: true });
    // 损坏文件被保留
    const corrupt = [...fs.files.keys()].filter((k) => k.includes('.corrupt-'));
    expect(corrupt.length).toBe(1);
  });

  it('自动备份：每天首次落盘生成备份，且轮换保留 60 个', async () => {
    const a = new DesktopFileStorageAdapter(fs);
    await a.setItem('foo', 'bar');
    await a.flush();
    const mgr = new DesktopDataManager(fs);
    const backups = (await mgr.listBackups()).filter((f) => !f.includes('_manual_'));
    expect(backups.length).toBeGreaterThan(0);

    // 制造 65 个自动备份，验证轮换到 60
    for (let i = 0; i < 65; i++) {
      fs.files.set(`${BACKUPS_DIR}/wealth-backup_2026-01-01_${String(i).padStart(2, '0')}0000.json`, '{}');
    }
    await mgr.backupNow(false);
    const after = (await mgr.listBackups()).filter((f) => f.startsWith('wealth-backup_') && !f.includes('_manual_'));
    expect(after.length).toBeLessThanOrEqual(60);
  });

  it('从备份恢复：覆盖主数据文件', async () => {
    const a = new DesktopFileStorageAdapter(fs);
    await a.setItem('foo', 'v1');
    await a.flush();
    const mgr = new DesktopDataManager(fs);
    const name = await mgr.backupNow(true);
    expect(name).toBeTruthy();

    await a.setItem('foo', 'v2');
    await a.flush();
    await mgr.restoreBackup(name!);

    const restored = JSON.parse(fs.files.get(STATE_PATH)!);
    expect(restored.foo).toBe('v1');
  });

  it('报告写入 weekly/monthly/yearly 目录', async () => {
    const mgr = new DesktopDataManager(fs);
    await mgr.writeReport('weekly', '2026-W40-weekly-report', '{"x":1}', '<html></html>');
    await mgr.writeReport('monthly', '2026-10-monthly-report', '{}');
    await mgr.writeReport('yearly', '2026-yearly-report', '{}');
    expect(fs.files.has(`${REPORTS_DIR}/weekly/2026-W40-weekly-report.json`)).toBe(true);
    expect(fs.files.has(`${REPORTS_DIR}/weekly/2026-W40-weekly-report.html`)).toBe(true);
    expect(fs.files.has(`${REPORTS_DIR}/monthly/2026-10-monthly-report.json`)).toBe(true);
    expect(fs.files.has(`${REPORTS_DIR}/yearly/2026-yearly-report.json`)).toBe(true);
  });
});
