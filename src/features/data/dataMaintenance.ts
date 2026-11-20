import type { HealthReviewRecord } from '../../domain/workspace/types';
import type { DataIssue } from '../../utils/dataHealth';

export const DATA_MAINTENANCE_TITLE = '数据健康与维护中心';

export function healthReviewBadge(
  issue: Pick<DataIssue, 'fingerprint'>,
  review: HealthReviewRecord | undefined,
): { label: string; tone: 'emerald' | 'amber' | 'blue' } | null {
  if (!review) return null;
  if (review.fingerprint !== issue.fingerprint) return { label: '证据已变化', tone: 'amber' };
  if (review.status === 'resolved') return { label: '已解决', tone: 'emerald' };
  if (review.status === 'deferred') return { label: '暂缓', tone: 'amber' };
  return { label: '已阅未解决', tone: 'blue' };
}
