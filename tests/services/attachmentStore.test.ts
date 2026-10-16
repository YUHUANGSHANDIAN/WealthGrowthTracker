import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileSystem } from '../../src/services/storage/fs';
import { storageService } from '../../src/services/storage';
import { ATTACHMENT_DIR, createFileAttachmentBackend, migrateInlineAttachments, setAttachmentBackendForTest } from '../../src/services/monthlyPlanning/attachmentStore';
import { attachmentKey, bytesToBase64 } from '../../src/services/monthlyPlanning/attachments';

class MemFS implements FileSystem {
  files = new Map<string, string>();
  async readTextFile(p: string): Promise<string> {
    const value = this.files.get(p);
    if (value === undefined) throw new Error(`not found: ${p}`);
    return value;
  }
  async writeTextFile(p: string, c: string): Promise<void> { this.files.set(p, c); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async mkdir(_p: string): Promise<void> { /* 逻辑目录 */ }
  async readDir(): Promise<string[]> { return []; }
  async removeFile(p: string): Promise<void> { this.files.delete(p); }
  async copyFile(s: string, d: string): Promise<void> { const v = this.files.get(s); if (v !== undefined) this.files.set(d, v); }
  async rename(s: string, d: string): Promise<void> { const v = this.files.get(s); if (v !== undefined) { this.files.set(d, v); this.files.delete(s); } }
}

const HASH = 'a'.repeat(64);
const KEY = attachmentKey(HASH, '微信渠道.jpg');
const BASE64 = bytesToBase64(new TextEncoder().encode('合成附件'));

afterEach(() => {
  setAttachmentBackendForTest(null);
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('附件文件后端', () => {
  it('写到数据根下的独立文件，并清掉可能存在的内联副本', async () => {
    const fs = new MemFS();
    await storageService.setRaw(KEY, BASE64); // 模拟历史内联值
    const backend = createFileAttachmentBackend(fs);
    await backend.write(KEY, BASE64);
    expect(fs.files.get(`${ATTACHMENT_DIR}/${HASH}.jpg`)).toBe(BASE64);
    expect(await storageService.getRaw(KEY)).toBeNull();
    expect(await backend.read(KEY)).toBe(BASE64);
    expect(await backend.exists(KEY)).toBe(true);
  });

  it('文件缺失时回退到内联值，升级过程不会读不到附件', async () => {
    const fs = new MemFS();
    await storageService.setRaw(KEY, BASE64);
    expect(await createFileAttachmentBackend(fs).read(KEY)).toBe(BASE64);
  });

  it('删除会同时清掉文件与内联值', async () => {
    const fs = new MemFS();
    const backend = createFileAttachmentBackend(fs);
    await backend.write(KEY, BASE64);
    await backend.remove(KEY);
    expect(fs.files.has(`${ATTACHMENT_DIR}/${HASH}.jpg`)).toBe(false);
    expect(await backend.read(KEY)).toBeNull();
  });

  it('把历史内联附件搬到文件后从状态里移除，重复执行不再搬', async () => {
    const fs = new MemFS();
    const backend = createFileAttachmentBackend(fs);
    setAttachmentBackendForTest(backend);
    await storageService.setRaw(KEY, BASE64);
    const listKeys = vi.spyOn(storageService, 'listRawKeys').mockResolvedValue([KEY]);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    try {
      expect(await migrateInlineAttachments(backend)).toBe(1);
      expect(fs.files.get(`${ATTACHMENT_DIR}/${HASH}.jpg`)).toBe(BASE64);
      expect(await storageService.getRaw(KEY)).toBeNull();
      listKeys.mockResolvedValue([]);
      expect(await migrateInlineAttachments(backend)).toBe(0);
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });
});
