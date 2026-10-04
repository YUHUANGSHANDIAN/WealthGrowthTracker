/**
 * 平台能力层（v1.3）：统一探测运行平台与能力，避免到处 if Android / if Windows。
 * UI 根据 capability 显示功能；业务数据 JSON 跨平台互通。
 */

export type PlatformId = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web';

export interface PlatformCapabilities {
  platform: PlatformId;
  arch: string;
  isTauri: boolean;
  isMobile: boolean;
  canOpenFolder: boolean;
  canNativeShare: boolean;
  canCopyImage: boolean;
  canSaveFile: boolean;
  canPickDirectory: boolean;
  canUsePwaInstall: boolean;
}

function detectPlatform(ua: string): PlatformId {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macos';
  if (/linux/i.test(ua)) return 'linux';
  return 'web';
}

function detectArch(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/arm64|aarch64/i.test(ua)) return 'arm64';
  if (/x86_64|amd64|win64|x64/i.test(ua)) return 'x64';
  return 'unknown';
}

export function detectCapabilities(env: { ua: string; isTauri: boolean; hasShare: boolean; hasClipboardItem: boolean } = {
  ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  isTauri: typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  hasShare: typeof navigator !== 'undefined' && !!navigator.share,
  hasClipboardItem: typeof window !== 'undefined' && 'ClipboardItem' in window && !!navigator.clipboard,
}): PlatformCapabilities {
  const platform = detectPlatform(env.ua);
  const isMobile = platform === 'android' || platform === 'ios';
  const desktop = platform === 'windows' || platform === 'macos' || platform === 'linux';
  return {
    platform,
    arch: detectArch(),
    isTauri: env.isTauri,
    isMobile,
    // 打开数据文件夹仅桌面 Tauri 有意义（Android 用 scoped storage / SAF）
    canOpenFolder: env.isTauri && desktop,
    canNativeShare: env.hasShare,
    canCopyImage: env.hasClipboardItem,
    canSaveFile: true,
    canPickDirectory: false,
    canUsePwaInstall: !env.isTauri && !isMobile,
  };
}

/** 惰性缓存（避免重复探测；可在测试中重置）。 */
let cached: PlatformCapabilities | null = null;
export function platformCapabilities(): PlatformCapabilities {
  if (!cached) cached = detectCapabilities();
  return cached;
}
export function resetPlatformCache(): void {
  cached = null;
}

/** 平台信息（供设置「关于」展示）。 */
export interface PlatformInfo {
  platform: string;
  architecture: string;
  storageBackend: string;
  appVersion: string;
  reportSchemaVersion: number;
}

export function buildPlatformInfo(opts: { appVersion: string; reportSchemaVersion: number; storageBackend: string }): PlatformInfo {
  const caps = platformCapabilities();
  return {
    platform: caps.platform,
    architecture: caps.arch,
    storageBackend: opts.storageBackend,
    appVersion: opts.appVersion,
    reportSchemaVersion: opts.reportSchemaVersion,
  };
}
