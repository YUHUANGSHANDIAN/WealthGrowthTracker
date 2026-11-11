import type { Channel, HistoryPoint } from '../types';
import { channelAmount } from './channels';
import { todayString } from './date';
import { CHANNEL_TERMS, channelPath } from '../constants/channelTerms';

/** 渠道资产 CSV（方便 Excel/OriginPro/Python 分析）。 */
export function buildChannelsCsv(channels: Channel[]): { header: string[]; rows: (string | number)[][] } {
  const snapshotDate = todayString();
  const total = channels.reduce((a, c) => a + channelAmount(c), 0);
  const rows: (string | number)[][] = [];
  for (const c of channels) {
    if (c.children && c.children.length > 0) {
      for (const s of c.children) {
        rows.push([
          c.id, c.name, s.id, s.name, s.amount,
          total > 0 ? Math.round((s.amount / total) * 10000) / 100 : 0,
          snapshotDate, channelPath(c.name, s.name), 'subchannel',
        ]);
      }
    } else {
      rows.push([
        c.id, c.name, c.id, c.name, channelAmount(c),
        total > 0 ? Math.round((channelAmount(c) / total) * 10000) / 100 : 0,
        snapshotDate, `${c.name} · ${CHANNEL_TERMS.parentDirect}`, 'parent-direct',
      ]);
    }
  }
  return {
    header: ['parentId', 'parentName', 'channelId', 'channelName', 'amount', 'percentage', 'snapshotDate', 'channelPath', 'channelKind'],
    rows,
  };
}

/** 历史 CSV。 */
export function buildHistoryCsv(history: HistoryPoint[]): { header: string[]; rows: (string | number)[][] } {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    header: ['date', 'totalAmount', 'wealthLevel'],
    rows: sorted.map((h) => [h.date, h.totalAmount, h.wealthLevel ?? '']),
  };
}
