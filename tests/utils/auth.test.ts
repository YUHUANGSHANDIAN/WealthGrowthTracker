import { describe, it, expect } from 'vitest';
import { compareSemVer, createAuthRecord, verifySecret } from '../../src/utils/auth';

describe('本地账户认证', () => {
  it('PBKDF2：正确密码通过、错误密码拒绝、不明文存储', async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) return; // 无 WebCrypto 环境跳过
    const record = await createAuthRecord('123456', 'pin');
    // 记录不含明文
    expect(JSON.stringify(record)).not.toContain('123456');
    expect(record.salt).toBeTruthy();
    expect(record.hash).toBeTruthy();

    expect(await verifySecret('123456', record)).toBe(true);
    expect(await verifySecret('654321', record)).toBe(false);
  });

  it('compareSemVer 语义化版本比较', () => {
    expect(compareSemVer('1.2.0', '1.2.0')).toBe(0);
    expect(compareSemVer('1.3.0', '1.2.0')).toBe(1);
    expect(compareSemVer('1.2.0', '1.3.0')).toBe(-1);
    expect(compareSemVer('2.0.0', '1.9.9')).toBe(1);
    // 处理 v 前缀
    expect(compareSemVer('v1.3.0', '1.2.0')).toBe(1);
  });
});
