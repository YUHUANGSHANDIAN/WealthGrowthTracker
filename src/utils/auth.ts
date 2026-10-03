/**
 * 本地账户认证（本地应用锁）。
 * - 使用 Web Crypto PBKDF2 + 随机盐，绝不明文保存 Password/PIN。
 * - 这是「应用锁」，不等于磁盘数据加密（app-state.json 仍为明文 JSON）。
 */

export interface AuthRecord {
  salt: string; // base64
  hash: string; // base64
  iterations: number;
  method: 'pin' | 'password';
}

const ITERATIONS = 150_000;
const HASH = 'SHA-256';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64(bytes.buffer);
}

async function derive(secret: string, salt: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(salt), iterations, hash: HASH },
    keyMaterial,
    256,
  );
  return toBase64(bits);
}

/** 创建认证记录（仅保存 salt + hash + 迭代次数）。 */
export async function createAuthRecord(secret: string, method: 'pin' | 'password'): Promise<AuthRecord> {
  const salt = generateSalt();
  const hash = await derive(secret, salt, ITERATIONS);
  return { salt, hash, iterations: ITERATIONS, method };
}

/** 校验密码/PIN 是否正确。 */
export async function verifySecret(secret: string, record: AuthRecord): Promise<boolean> {
  const hash = await derive(secret, record.salt, record.iterations);
  return hash === record.hash;
}

/** 简单 SemVer 比较：a > b 返回 1，a === b 返回 0，a < b 返回 -1。 */
export function compareSemVer(a: string, b: string): number {
  const pa = a.replace(/[^0-9.]/g, '').split('.').map(Number);
  const pb = b.replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
