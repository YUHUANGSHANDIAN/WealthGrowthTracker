import { describe, it, expect } from 'vitest';
import { detectCapabilities, resetPlatformCache } from '../../src/utils/platform';

describe('平台能力层', () => {
  it('Windows Tauri：可打开文件夹', () => {
    const caps = detectCapabilities({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', isTauri: true, hasShare: false, hasClipboardItem: true });
    expect(caps.platform).toBe('windows');
    expect(caps.canOpenFolder).toBe(true);
    expect(caps.isMobile).toBe(false);
  });

  it('Android：不显示打开文件夹，走 scoped storage', () => {
    const caps = detectCapabilities({ ua: 'Mozilla/5.0 (Linux; Android 14)', isTauri: true, hasShare: true, hasClipboardItem: false });
    expect(caps.platform).toBe('android');
    expect(caps.canOpenFolder).toBe(false);
    expect(caps.isMobile).toBe(true);
    expect(caps.canNativeShare).toBe(true);
  });

  it('macOS / Linux 桌面可打开文件夹', () => {
    const mac = detectCapabilities({ ua: 'Macintosh; Intel Mac OS X 10_15', isTauri: true, hasShare: false, hasClipboardItem: true });
    expect(mac.platform).toBe('macos');
    expect(mac.canOpenFolder).toBe(true);
    const linux = detectCapabilities({ ua: 'X11; Linux x86_64', isTauri: true, hasShare: false, hasClipboardItem: true });
    expect(linux.platform).toBe('linux');
    expect(linux.canOpenFolder).toBe(true);
  });

  it('Web：可 PWA 安装，不可打开文件夹', () => {
    const caps = detectCapabilities({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome', isTauri: false, hasShare: false, hasClipboardItem: true });
    expect(caps.platform).toBe('linux');
    expect(caps.isTauri).toBe(false);
    expect(caps.canOpenFolder).toBe(false);
    expect(caps.canUsePwaInstall).toBe(true);
  });

  it('缓存可重置', () => {
    resetPlatformCache();
    expect(() => resetPlatformCache()).not.toThrow();
  });
});
