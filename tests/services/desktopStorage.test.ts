import { describe, it, expect, beforeEach } from 'vitest';
import type { FileSystem } from '../../src/services/storage/fs';
import { STORAGE_KEYS } from '../../src/constants/storageKeys';
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

  it('状态字节未变化时不重复创建等大的备份，变化后才新建', async () => {
    const adapter = new DesktopFileStorageAdapter(fs);
    await adapter.setItem('foo', 'bar');
    await adapter.flush();
    const mgr = new DesktopDataManager(fs);
    const before = (await mgr.listBackups()).length;
    expect(before).toBeGreaterThan(0);

    const first = await mgr.backupNow(true);
    const second = await mgr.backupNow(true);
    expect(second).toBe(first);
    expect((await mgr.listBackups()).length).toBe(before);

    await adapter.setItem('foo', 'baz');
    await adapter.flush();
    const mid = (await mgr.listBackups()).length;
    const third = await mgr.backupNow(true);
    expect(third).not.toBe(first);
    expect((await mgr.listBackups()).length).toBe(mid + 1);
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

  it('损坏主文件：保留原文件，显式恢复之前拒绝读取与写入', async () => {
    // 先写一份有效状态 + 一份备份
    const a1 = new DesktopFileStorageAdapter(fs);
    await a1.setItem('foo', JSON.stringify({ ok: true }));
    await a1.setItem(STORAGE_KEYS.wealthTrackerData, JSON.stringify({ channels: [], history: [] }));
    await a1.flush(); // 触发一次自动备份
    const mgr = new DesktopDataManager(fs);
    const backups = await mgr.listBackups();
    expect(backups.length).toBeGreaterThan(0);

    // 破坏主文件
    fs.files.set(STATE_PATH, '{{{ not valid json');

    const a2 = new DesktopFileStorageAdapter(fs);
    await expect(a2.getItem('foo')).rejects.toThrow('主数据文件损坏');
    await expect(a2.setItem('foo', 'empty')).rejects.toThrow();
    await expect(a2.flush()).rejects.toThrow();
    expect(fs.files.get(STATE_PATH)).toBe('{{{ not valid json');
    await mgr.restoreBackup(backups[0]!);
    expect([...fs.files.entries()].find(([name]) => name.startsWith(`${STATE_PATH}.preserved-`))?.[1]).toBe('{{{ not valid json');
    await a2.reload();
    expect(JSON.parse((await a2.getItem('foo'))!)).toEqual({ ok: true });
  });

  it('自动备份：同字节复用、内容变化才新建，且从不批量删除旧备份', async () => {
    const a = new DesktopFileStorageAdapter(fs);
    await a.setItem('foo', 'bar');
    await a.flush();
    const mgr = new DesktopDataManager(fs);
    const backups = (await mgr.listBackups()).filter((f) => !f.includes('_manual_'));
    expect(backups.length).toBeGreaterThan(0);

    // 状态未变化：不再堆出等大的重复备份
    const base = (await mgr.listBackups()).length;
    await mgr.backupNow(true);
    expect((await mgr.listBackups()).length).toBe(base);

    // 内容变化：仍然会新建一份
    await a.setItem('foo', 'changed');
    await a.flush();
    const mid = (await mgr.listBackups()).length;
    const created = await mgr.backupNow(true);
    expect(created).toBeTruthy();
    expect((await mgr.listBackups()).length).toBe(mid + 1);

    // 塞入 65 份历史自动备份，验证应用不批量删除旧备份
    for (let i = 0; i < 65; i++) {
      fs.files.set(`${BACKUPS_DIR}/wealth-backup_2026-01-01_${String(i).padStart(2, '0')}0000.json`, '{}');
    }
    const after = await mgr.listBackups();
    expect(after.filter((f) => f.includes('2026-01-01')).length).toBe(65);
    expect(after.length).toBe(mid + 1 + 65);
  });

  it('从备份恢复：覆盖主数据文件', async () => {
    const a = new DesktopFileStorageAdapter(fs);
    await a.setItem('foo', 'v1');
    await a.setItem(STORAGE_KEYS.wealthTrackerData, JSON.stringify({ channels: [], history: [] }));
    await a.flush();
    const mgr = new DesktopDataManager(fs);
    const name = await mgr.backupNow(true);
    expect(name).toBeTruthy();

    await a.setItem('foo', 'v2');
    await a.flush();
    await mgr.restoreBackup(name!);

    const restored = JSON.parse(fs.files.get(STATE_PATH)!);
    expect(restored.payload.foo).toBe('v1');
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

  it('未初始化 flush 不得覆盖磁盘上已有状态', async () => {
    fs.files.set(STATE_PATH, JSON.stringify({ existing: 'saved' }));
    const adapter = new DesktopFileStorageAdapter(fs);
    await adapter.flush();
    expect(JSON.parse(fs.files.get(STATE_PATH)!).payload).toEqual({ existing: 'saved' });
  });

  it('写入失败可见，下一次 flush 可重试', async () => {
    const adapter = new DesktopFileStorageAdapter(fs);
    await adapter.setItem('foo', 'bar');
    const original = fs.rename.bind(fs);
    fs.rename = async () => { throw new Error('permission denied'); };
    await expect(adapter.flush()).rejects.toThrow('数据文件写入');
    fs.rename = original;
    await adapter.flush();
    expect(JSON.parse(fs.files.get(STATE_PATH)!).payload).toEqual({ foo: 'bar' });
  });

  it('并发 flush 按顺序提交快照', async () => {
    const adapter = new DesktopFileStorageAdapter(fs);
    await adapter.setItem('foo', 'first');
    const first = adapter.flush();
    await adapter.setItem('foo', 'second');
    const second = adapter.flush();
    await Promise.all([first, second]);
    expect(JSON.parse(fs.files.get(STATE_PATH)!).payload).toEqual({ foo: 'second' });
  });

  it('备份拷贝失败会阻止通过', async () => {
    fs.files.set(STATE_PATH, JSON.stringify({ foo: 'saved' }));
    fs.copyFile = async () => {};
    await expect(new DesktopDataManager(fs).backupNow(true)).rejects.toThrow('创建数据备份失败');
  });

  it('旧格式升级保留未知 key，先逐字备份再写 Envelope', async () => {
    const original = '{ "foo": "old", "unknown-extension": "保留🌱" }';
    fs.files.set(STATE_PATH, original);
    const adapter = new DesktopFileStorageAdapter(fs);
    await adapter.setItem('foo', 'new');
    await adapter.flush();
    const state = JSON.parse(fs.files.get(STATE_PATH)!);
    expect(state.storageSchemaVersion).toBe(1);
    expect(state.payload).toEqual({ foo: 'new', 'unknown-extension': '保留🌱' });
    const backups = await adapter.manager.listBackups();
    const manual = backups.filter(name => name.includes('_manual_'));
    expect(manual).toHaveLength(1);
    expect(fs.files.get(`${BACKUPS_DIR}/${manual[0]}`)).toBe(original);
    await adapter.flush();
    expect((await adapter.manager.listBackups()).filter(name => name.includes('_manual_'))).toHaveLength(1);
  });

  it('Envelope 写回保留未知 metadata 和 revision 单调性', async () => {
    fs.files.set(STATE_PATH, JSON.stringify({ storageSchemaVersion: 1, revision: 12, extension: { label: '中文' }, payload: { foo: 'old' } }));
    const adapter = new DesktopFileStorageAdapter(fs);
    await adapter.setItem('foo', 'new');
    await adapter.flush();
    const state = JSON.parse(fs.files.get(STATE_PATH)!);
    expect(state.extension).toEqual({ label: '中文' });
    expect(state.revision).toBeGreaterThan(12);
    const reopened = new DesktopFileStorageAdapter(fs);
    expect(await reopened.getItem('foo')).toBe('new');
    await adapter.flush();
    expect(JSON.parse(fs.files.get(STATE_PATH)!).revision).toBe(state.revision);
  });

  it('未来 Schema 即使存在旧备份也拒绝读写，不修改原文件', async () => {
    const original = JSON.stringify({ storageSchemaVersion: 2, revision: 4, payload: { foo: 'future' } });
    fs.files.set(STATE_PATH, original);
    fs.files.set(`${BACKUPS_DIR}/wealth-backup_2026-01-01_000000.json`, '{"foo":"old"}');
    const adapter = new DesktopFileStorageAdapter(fs);
    await expect(adapter.getItem('foo')).rejects.toMatchObject({ reason: 'future-schema' });
    await expect(adapter.setItem('foo', 'overwrite')).rejects.toThrow();
    await expect(adapter.flush()).rejects.toThrow();
    expect(fs.files.get(STATE_PATH)).toBe(original);
  });

  it('旧格式备份失败阻断升级，修复后可重试', async () => {
    const original = '{"foo":"old"}';
    fs.files.set(STATE_PATH, original);
    const adapter = new DesktopFileStorageAdapter(fs);
    await adapter.setItem('foo', 'new');
    const copy = fs.copyFile.bind(fs);
    fs.copyFile = async () => { throw new Error('disk full'); };
    await expect(adapter.flush()).rejects.toThrow();
    expect(fs.files.get(STATE_PATH)).toBe(original);
    fs.copyFile = copy;
    await adapter.flush();
    expect(JSON.parse(fs.files.get(STATE_PATH)!).payload.foo).toBe('new');
  });

  it('备份在预览后改变或原文件保留失败时，不替换主文件', async () => {
    const name = 'wealth-backup_2026-01-01_000000.json';
    const original = '{"foo":"current"}';
    fs.files.set(STATE_PATH, original);
    fs.files.set(`${BACKUPS_DIR}/${name}`, '{"foo":"backup"}');
    const manager = new DesktopDataManager(fs);
    const preview = await manager.inspectBackup(name);
    fs.files.set(`${BACKUPS_DIR}/${name}`, JSON.stringify({ foo: 'changed', [STORAGE_KEYS.wealthTrackerData]: JSON.stringify({ channels: [], history: [] }) }));
    await expect(manager.restoreBackup(name, preview.raw)).rejects.toThrow('备份已变化');
    expect(fs.files.get(STATE_PATH)).toBe(original);
    fs.copyFile = async () => {};
    await expect(manager.restoreBackup(name)).rejects.toThrow();
    expect(fs.files.get(STATE_PATH)).toBe(original);
  });

  it('恢复旧备份不能绕过未来主文件只读限制', async () => {
    const name = 'wealth-backup_2026-01-01_000000.json';
    const original = '{"storageSchemaVersion":2,"revision":0,"payload":{}}';
    fs.files.set(STATE_PATH, original);
    fs.files.set(`${BACKUPS_DIR}/${name}`, JSON.stringify({ foo: 'old', [STORAGE_KEYS.wealthTrackerData]: JSON.stringify({ channels: [], history: [] }) }));
    await expect(new DesktopDataManager(fs).restoreBackup(name)).rejects.toMatchObject({ reason: 'future-schema' });
    expect(fs.files.get(STATE_PATH)).toBe(original);
  });

  it.each([
    ['缺少主数据', { foo: 'backup' }],
    ['损坏的内层 JSON', { [STORAGE_KEYS.wealthTrackerData]: '{' }],
    ['非法渠道金额', { [STORAGE_KEYS.wealthTrackerData]: JSON.stringify({ channels: [{ id: 'bank', amount: null }], history: [] }) }],
    ['非法历史日期', { [STORAGE_KEYS.wealthTrackerData]: JSON.stringify({ channels: [], history: [{ date: '2026-02-30', totalAmount: 100 }] }) }],
    ['未来报告 Schema', { [STORAGE_KEYS.financialReports]: JSON.stringify([{ id: 'future', startDate: '2026-01-01', endDate: '2026-01-31', totalAmount: 100, reportSchemaVersion: 999 }]) }],
  ])('恢复前拒绝%s，不写主文件或保留副本', async (_label, payload) => {
    const name = 'wealth-backup_2026-01-01_000000.json';
    const original = '{"foo":"current"}';
    fs.files.set(STATE_PATH, original);
    fs.files.set(`${BACKUPS_DIR}/${name}`, JSON.stringify({ storageSchemaVersion: 1, revision: 1, payload }));
    const before = [...fs.files.entries()];
    await expect(new DesktopDataManager(fs).restoreBackup(name)).rejects.toMatchObject({ reason: 'invalid-state' });
    expect([...fs.files.entries()]).toEqual(before);
  });

  it('Envelope 兼容也不能覆盖含未来报告的主文件', async () => {
    const name = 'wealth-backup_2026-01-01_000000.json';
    const original = JSON.stringify({ [STORAGE_KEYS.financialReports]: JSON.stringify([{ reportSchemaVersion: 999 }]) });
    fs.files.set(STATE_PATH, original);
    fs.files.set(`${BACKUPS_DIR}/${name}`, JSON.stringify({ [STORAGE_KEYS.wealthTrackerData]: JSON.stringify({ channels: [], history: [] }) }));
    await expect(new DesktopDataManager(fs).restoreBackup(name)).rejects.toMatchObject({ reason: 'future-schema' });
    expect(fs.files.get(STATE_PATH)).toBe(original);
    expect([...fs.files.keys()].filter(path => path.includes('.preserved-'))).toEqual([]);
  });

  it('有效备份的未知财务字段和 storage key 逐字恢复', async () => {
    const name = 'wealth-backup_2026-01-01_000000.json';
    const raw = JSON.stringify({
      [STORAGE_KEYS.wealthTrackerData]: JSON.stringify({ channels: [{ id: 'bank', amount: 0, extension: '保留🌱' }], history: [], extension: { source: 'legacy' } }),
      'unknown-storage-key': '保留扩展',
    }, null, 2);
    fs.files.set(`${BACKUPS_DIR}/${name}`, raw);
    await new DesktopDataManager(fs).restoreBackup(name);
    expect(fs.files.get(STATE_PATH)).toBe(raw);
  });
});
