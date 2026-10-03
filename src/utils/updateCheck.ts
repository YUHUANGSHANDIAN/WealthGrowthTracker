import { compareSemVer } from './auth';

export interface UpdateCheckResult {
  current: string;
  latest: string;
  isNewer: boolean;
  url: string;
  notes: string;
  publishedAt: string;
}

const REPO = 'YUHUANGSHANDIAN/wealth-growth-tracker';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

/**
 * 手动检查更新：仅在用户主动点击时联网查询 GitHub Releases（不发送任何资产/个人数据）。
 */
export async function checkForUpdate(current: string): Promise<UpdateCheckResult> {
  const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`检查更新失败（HTTP ${res.status}）`);
  const data = (await res.json()) as { tag_name: string; html_url: string; body: string; published_at: string };
  const latest = data.tag_name.replace(/^v/, '');
  return {
    current,
    latest,
    isNewer: compareSemVer(latest, current) > 0,
    url: data.html_url,
    notes: data.body ?? '',
    publishedAt: data.published_at,
  };
}

export function releasePageUrl(): string {
  return `https://github.com/${REPO}/releases`;
}
