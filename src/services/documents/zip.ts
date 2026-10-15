/**
 * 最小 ZIP 读写器：
 * - 读：解析中央目录，仅按需解压单个条目；`store` 与 `deflate` 两种方法。
 * - 写：只写 `store`（无压缩），供测试夹具与纯导出使用。
 * 安全边界：条目数上限、单条与总解压体积上限、拒绝绝对路径/上级跳转/反斜杠路径。
 */

export interface ZipEntryInfo {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2_048,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
};

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

/** 拒绝会逃出目标目录或有歧义的条目名。 */
export function assertSafeEntryName(name: string): void {
  if (!name || name.length > 512) throw new ZipError('ZIP 条目名无效');
  if (name.includes('\0')) throw new ZipError('ZIP 条目名含非法字符');
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) throw new ZipError('ZIP 条目使用绝对路径');
  const normalized = name.replace(/\\/g, '/');
  if (normalized.split('/').some((segment) => segment === '..')) throw new ZipError('ZIP 条目包含上级跳转');
}

export class ZipArchive {
  private constructor(
    private readonly bytes: Uint8Array,
    private readonly entries: Map<string, ZipEntryInfo>,
  ) {}

  static open(buffer: ArrayBuffer | Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 22) throw new ZipError('ZIP 文件过小或已损坏');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const scanStart = Math.max(0, bytes.length - 66_000);
    for (let index = bytes.length - 22; index >= scanStart; index -= 1) {
      if (readU32(view, index) === EOCD_SIGNATURE) { eocd = index; break; }
    }
    if (eocd < 0) throw new ZipError('不是有效的 ZIP（未找到中央目录）');
    const entryCount = readU16(view, eocd + 10);
    const directoryOffset = readU32(view, eocd + 16);
    if (entryCount > limits.maxEntries) throw new ZipError(`ZIP 条目过多：${entryCount}`);
    const entries = new Map<string, ZipEntryInfo>();
    let cursor = directoryOffset;
    let total = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > bytes.length || readU32(view, cursor) !== CENTRAL_SIGNATURE) throw new ZipError('ZIP 中央目录损坏');
      const method = readU16(view, cursor + 10);
      const compressedSize = readU32(view, cursor + 20);
      const uncompressedSize = readU32(view, cursor + 24);
      const nameLength = readU16(view, cursor + 28);
      const extraLength = readU16(view, cursor + 30);
      const commentLength = readU16(view, cursor + 32);
      const name = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      assertSafeEntryName(name);
      total += uncompressedSize;
      if (uncompressedSize > limits.maxEntryBytes) throw new ZipError(`ZIP 条目过大：${name}`);
      if (total > limits.maxTotalBytes) throw new ZipError('ZIP 解压总量超过上限（疑似压缩炸弹）');
      entries.set(name, { name, method, compressedSize, uncompressedSize });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return new ZipArchive(bytes, entries);
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  info(name: string): ZipEntryInfo | null {
    return this.entries.get(name) ?? null;
  }

  /** 读取单个条目内容（deflate 走 DecompressionStream('deflate-raw')）。 */
  async read(name: string): Promise<Uint8Array> {
    const info = this.entries.get(name);
    if (!info) throw new ZipError(`ZIP 中不存在条目：${name}`);
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    let cursor = -1;
    const directoryOffset = this.findLocalOffset(view, name);
    if (directoryOffset === null) throw new ZipError(`ZIP 缺少本地文件头：${name}`);
    cursor = directoryOffset;
    if (readU32(view, cursor) !== LOCAL_SIGNATURE) throw new ZipError('ZIP 本地文件头损坏');
    const nameLength = readU16(view, cursor + 26);
    const extraLength = readU16(view, cursor + 28);
    const dataStart = cursor + 30 + nameLength + extraLength;
    const compressed = this.bytes.subarray(dataStart, dataStart + info.compressedSize);
    if (info.method === 0) return compressed.slice();
    if (info.method !== 8) throw new ZipError(`不支持的压缩方法：${info.method}`);
    if (typeof DecompressionStream === 'undefined') throw new ZipError('当前环境不支持 deflate 解压');
    const stream = new Blob([compressed.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    const result = new Uint8Array(buffer);
    if (result.byteLength !== info.uncompressedSize) throw new ZipError(`ZIP 条目大小不符：${name}`);
    return result;
  }

  private findLocalOffset(view: DataView, wanted: string): number | null {
    const bytes = this.bytes;
    for (let cursor = 0; cursor + 30 <= bytes.length; cursor += 1) {
      if (readU32(view, cursor) !== LOCAL_SIGNATURE) continue;
      const method = readU16(view, cursor + 8);
      const nameLength = readU16(view, cursor + 26);
      if (nameLength === 0 || nameLength > 512 || cursor + 30 + nameLength > bytes.length) continue;
      const name = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(cursor + 30, cursor + 30 + nameLength));
      const info = this.entries.get(name);
      if (!info || method !== info.method) continue;
      if (name === wanted) return cursor;
    }
    return null;
  }
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

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 生成未压缩（store）ZIP，供测试夹具与纯导出使用。 */
export function writeZip(entries: ReadonlyArray<{ name: string; data: Uint8Array | string }>): Uint8Array {
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    assertSafeEntryName(entry.name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    return { name: encoder.encode(entry.name), data, crc: crc32(data) };
  });
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of prepared) {
    const local = new Uint8Array(30 + entry.name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, LOCAL_SIGNATURE, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8 文件名标记
    view.setUint16(8, 0, true); // store
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, entry.name.length, true);
    local.set(entry.name, 30);
    chunks.push(local, entry.data);
    const centralEntry = new Uint8Array(46 + entry.name.length);
    const centralView = new DataView(centralEntry.buffer);
    centralView.setUint32(0, CENTRAL_SIGNATURE, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, entry.crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, entry.name.length, true);
    centralView.setUint32(42, offset, true);
    centralEntry.set(entry.name, 46);
    central.push(centralEntry);
    offset += local.length + entry.data.length;
  }
  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, EOCD_SIGNATURE, true);
  eocdView.setUint16(8, prepared.length, true);
  eocdView.setUint16(10, prepared.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of all) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}
