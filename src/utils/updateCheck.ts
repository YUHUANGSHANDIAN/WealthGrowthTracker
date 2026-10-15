import { compareSemVer } from './auth';
import { platformCapabilities, type PlatformCapabilities } from './platform';
import { APP_REPOSITORY, UPDATE_CHECK_REPOSITORIES } from '../constants/brand';

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface UpdateCheckResult {
  current: string;
  latest: string;
  isNewer: boolean;
  url: string;
  notes: string;
  publishedAt: string;
  assets: ReleaseAsset[];
}

const releaseApi = (repo: string) => `https://api.github.com/repos/${repo}/releases/latest`;

/**
 * 手动检查更新：仅在用户主动点击时联网查询 GitHub Releases（不发送任何资产/个人数据）。
 */
export async function checkForUpdate(current: string): Promise<UpdateCheckResult> {
  let lastError: unknown = null;
  // 仓库改名后先请求新 slug；失败再回退旧 slug（GitHub 对改名仓库提供 301 重定向）。
  for (const repo of UPDATE_CHECK_REPOSITORIES) {
    try {
      const res = await fetch(releaseApi(repo), { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) { lastError = new Error(`检查更新失败（HTTP ${res.status}）`); continue; }
      const data = (await res.json()) as { tag_name: string; html_url: string; body: string; published_at: string; assets: { name: string; browser_download_url: string }[] };
      const latest = data.tag_name.replace(/^v/, '');
      return {
        current,
        latest,
        isNewer: compareSemVer(latest, current) > 0,
        url: data.html_url,
        notes: data.body ?? '',
        publishedAt: data.published_at,
        assets: (data.assets ?? []).map((a) => ({ name: a.name, downloadUrl: a.browser_download_url })),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('检查更新失败');
}

/** 按当前平台推荐对应资产（Android→APK，macOS→DMG，Linux→AppImage/DEB，Windows→EXE）。 */
export function recommendAsset(assets: ReleaseAsset[], caps: PlatformCapabilities = platformCapabilities()): ReleaseAsset | null {
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (caps.platform === 'android') {
      if (n.endsWith('.apk')) return 0;
      if (n.endsWith('.aab')) return 1;
    } else if (caps.platform === 'macos') {
      if (n.endsWith('.dmg')) return 0;
      if (n.includes('macos')) return 1;
    } else if (caps.platform === 'linux') {
      if (n.endsWith('.appimage')) return 0;
      if (n.endsWith('.deb')) return 1;
      if (n.endsWith('.rpm')) return 2;
    } else {
      if (n.endsWith('.exe')) return 0;
      if (n.endsWith('.msi')) return 1;
    }
    return 99;
  };
  const usable = assets.filter((a) => !a.name.endsWith('.txt') && !a.name.endsWith('.sig'));
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => rank(a.name) - rank(b.name))[0] ?? null;
}

export function releasePageUrl(): string {
  return `https://github.com/${APP_REPOSITORY}/releases`;
}
