import type { Channel, HistoryPoint } from '../types';
import { round2 } from './money';

export interface DataIssue {
  severity: 'warning' | 'error';
  category: string;
  message: string;
  fixable: boolean;
  fix: 'sanitize-amounts' | 'remove-orphans' | 'dedupe-history' | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 数据健康检查：只报告，不自动删除数据。可安全修复的问题通过 fix 标识。 */
export function checkDataHealth(
  channels: Channel[],
  history: HistoryPoint[],
): { issues: DataIssue[]; ok: boolean } {
  const issues: DataIssue[] = [];
  const channelIds = new Set<string>();
  const subIds = new Set<string>();
  let badAmount = false;
  let orphan = false;
  let dupHistory = false;

  for (const c of channels) {
    if (channelIds.has(c.id)) {
      issues.push({ severity: 'error', category: '渠道', message: `重复的父渠道 ID：${c.id}`, fixable: false, fix: null });
    }
    channelIds.add(c.id);
    if (!Number.isFinite(c.amount) || c.amount < 0) badAmount = true;
    for (const s of c.children ?? []) {
      if (subIds.has(s.id)) {
        issues.push({ severity: 'error', category: '渠道', message: `重复的子渠道 ID：${s.id}`, fixable: false, fix: null });
      }
      subIds.add(s.id);
      if (!Number.isFinite(s.amount) || s.amount < 0) badAmount = true;
      if (s.parentId !== c.id) orphan = true;
    }
  }

  const dates = new Set<string>();
  for (const h of history) {
    if (!DATE_RE.test(h.date)) {
      issues.push({ severity: 'warning', category: '历史', message: `异常日期：${h.date}`, fixable: false, fix: null });
    }
    if (dates.has(h.date)) dupHistory = true;
    dates.add(h.date);
    if (!Number.isFinite(h.totalAmount)) badAmount = true;
    if (h.totalAmount < 0) {
      issues.push({ severity: 'warning', category: '历史', message: `历史总资产为负：${h.date}（${h.totalAmount}）`, fixable: false, fix: null });
    }
  }

  if (badAmount) issues.push({ severity: 'error', category: '金额', message: '存在非法金额（NaN/Infinity/负数）', fixable: true, fix: 'sanitize-amounts' });
  if (orphan) issues.push({ severity: 'warning', category: '渠道', message: '存在孤立子渠道（parentId 不匹配）', fixable: true, fix: 'remove-orphans' });
  if (dupHistory) issues.push({ severity: 'warning', category: '历史', message: '存在重复日期的历史记录', fixable: true, fix: 'dedupe-history' });

  return { issues, ok: issues.length === 0 };
}

/** 应用安全修复（修复前调用方应已备份）。返回修复后的数据与修复计数。 */
export function applyHealthFixes(
  channels: Channel[],
  history: HistoryPoint[],
  issues: DataIssue[],
): { channels: Channel[]; history: HistoryPoint[]; fixed: number } {
  let fixed = 0;
  let nextChannels = channels;
  let nextHistory = history;

  const sanitize = (n: number) => (Number.isFinite(n) && n >= 0 ? round2(n) : 0);

  if (issues.some((i) => i.fix === 'sanitize-amounts')) {
    nextChannels = nextChannels.map((c) => ({
      ...c,
      amount: sanitize(c.amount),
      children: c.children?.map((s) => ({ ...s, amount: sanitize(s.amount) })),
    }));
    nextHistory = nextHistory.map((h) => ({ ...h, totalAmount: sanitize(h.totalAmount) }));
    fixed++;
  }
  if (issues.some((i) => i.fix === 'remove-orphans')) {
    nextChannels = nextChannels.map((c) => ({
      ...c,
      children: c.children?.filter((s) => s.parentId === c.id),
    }));
    fixed++;
  }
  if (issues.some((i) => i.fix === 'dedupe-history')) {
    const byDate = new Map<string, HistoryPoint>();
    for (const h of [...nextHistory].sort((a, b) => (a.date < b.date ? -1 : 1))) byDate.set(h.date, h);
    nextHistory = [...byDate.values()];
    fixed++;
  }

  return { channels: nextChannels, history: nextHistory, fixed };
}
