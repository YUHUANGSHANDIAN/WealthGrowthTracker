import type { HistoryPoint, HistorySource } from '../../types';
import { addDays, todayString } from '../../utils/date';
import { diffMoney, round2, sumMoney } from '../../utils/money';

type Tone = 'emerald' | 'blue' | 'purple' | 'slate' | 'amber' | 'red';

export const HISTORY_SOURCE_META: Record<HistorySource, { label: string; tone: Tone }> = {
  'live-snapshot': { label: '实时快照', tone: 'emerald' },
  manual: { label: '手动记录', tone: 'slate' },
  'weekly-report': { label: '周报生成', tone: 'blue' },
  import: { label: '导入记录', tone: 'purple' },
  'legacy-txt-import': { label: '旧版 TXT 导入', tone: 'amber' },
  'legacy-image-import': { label: '旧版图片导入', tone: 'amber' },
  'ocr-repair': { label: 'OCR 修复', tone: 'amber' },
  'historical-backfill': { label: '历史补全', tone: 'blue' },
};

export function historySource(source?: HistorySource): { label: string; tone: Tone } {
  return source && Object.prototype.hasOwnProperty.call(HISTORY_SOURCE_META, source)
    ? HISTORY_SOURCE_META[source]
    : { label: source ? '其他来源' : '来源未记录', tone: 'slate' };
}

export function isHistoryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export interface HistoryCoverage {
  kind: 'reconciled' | 'total-only' | 'inconsistent' | 'invalid';
  label: string;
  detail: string;
  tone: Tone;
}

/** Coverage describes this stored observation; it never infers missing accounts. */
export function historyCoverage(point: HistoryPoint): HistoryCoverage {
  if (!Number.isFinite(point.totalAmount) || point.totalAmount < 0) {
    return { kind: 'invalid', label: '金额无效', detail: '总资产无法用于比较，请在数据中心核对原始记录。', tone: 'red' };
  }
  if (!point.channels) {
    return { kind: 'total-only', label: '仅有总额', detail: '未记录渠道构成；可以比较总额，不能解释渠道变化。', tone: 'slate' };
  }
  const inconsistent: HistoryCoverage = {
    kind: 'inconsistent', label: '构成待核对', detail: '渠道结构或金额与总额不一致，请在数据中心核对。', tone: 'amber',
  };
  const ids = new Set<string>();
  try {
    const amounts: number[] = [];
    for (const parent of point.channels) {
      if (!parent.id || ids.has(parent.id) || !parent.isParent || !Number.isFinite(parent.amount) || parent.amount < 0) return inconsistent;
      ids.add(parent.id);
      const children = parent.children ?? [];
      for (const child of children) {
        if (!child.id || ids.has(child.id) || child.parentId !== parent.id || !Number.isFinite(child.amount) || child.amount < 0) return inconsistent;
        ids.add(child.id);
      }
      const amount = children.length ? sumMoney(children.map(child => child.amount)) : round2(parent.amount);
      if (amount !== round2(parent.amount)) return inconsistent;
      amounts.push(amount);
    }
    if (sumMoney(amounts) !== round2(point.totalAmount)) return inconsistent;
  } catch {
    return inconsistent;
  }
  return {
    kind: 'reconciled', label: '构成一致',
    detail: `已记录 ${point.channels.length} 个父渠道，渠道合计与总额一致；不代表已核实外部账户。`, tone: 'emerald',
  };
}

export interface HistoryRow {
  point: HistoryPoint;
  coverage: HistoryCoverage;
  previousDate: string | null;
  difference: number | null;
  future: boolean;
  validDate: boolean;
}

/** Compare with the preceding valid observation before applying a page's date filter. */
export function buildHistoryRows(history: readonly HistoryPoint[], referenceDate = todayString()): HistoryRow[] {
  let previous: HistoryPoint | null = null;
  return [...history].sort((a, b) => a.date.localeCompare(b.date)).map(point => {
    const validDate = isHistoryDate(point.date);
    const future = validDate && point.date > referenceDate;
    const valid = validDate && !future && Number.isFinite(point.totalAmount) && point.totalAmount >= 0;
    const comparable = valid && previous && previous.date < point.date ? previous : null;
    const row: HistoryRow = {
      point, coverage: historyCoverage(point), validDate, future,
      previousDate: comparable?.date ?? null,
      difference: comparable ? diffMoney(point.totalAmount, comparable.totalAmount) : null,
    };
    if (valid) previous = point;
    return row;
  });
}

/** A single null marker per missing run keeps real calendar gaps visible. */
export function historyChartPoints(rows: readonly HistoryRow[]): { date: string; value: number | null }[] {
  const points: { date: string; value: number | null }[] = [];
  let previousDate: string | null = null;
  for (const row of rows) {
    if (!row.validDate || row.future || row.point.date === previousDate) continue;
    if (previousDate && Date.parse(row.point.date) - Date.parse(previousDate) > 86_400_000) {
      points.push({ date: addDays(previousDate, 1), value: null });
    }
    points.push({ date: row.point.date, value: row.coverage.kind === 'invalid' ? null : row.point.totalAmount });
    previousDate = row.point.date;
  }
  return points;
}

export function historyRecordTime(point: HistoryPoint): { label: string; iso: string; text: string } | null {
  const recorded = point.timestamp !== undefined && Number.isFinite(point.timestamp) && Number.isFinite(new Date(point.timestamp).getTime());
  const value = recorded ? point.timestamp! : point.updatedAt ? Date.parse(point.updatedAt) : Number.NaN;
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return null;
  return {
    label: recorded ? '记录时间' : '更新时间',
    iso: new Date(value).toISOString(),
    text: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value),
  };
}
