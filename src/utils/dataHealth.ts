import type { Channel, FinancialReport, Goal, HistoryPoint, LevelAchievement } from '../types';
import { round2 } from './money';
import { isValidTimezone } from './goals';

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

// ---------------------------------------------------------------------------
// v1.3 扩展健康检查：报告 / 目标 / 等级成就（仅报告，不自动修复）
// ---------------------------------------------------------------------------

/** 报告健康：periodKey 缺失 / 重复 / 周编号非法 / 标题缺失。 */
export function checkReportHealth(reports: FinancialReport[]): DataIssue[] {
  const issues: DataIssue[] = [];
  const byPeriod = new Map<string, number>();
  for (const r of reports) {
    if (!r.periodKey) issues.push({ severity: 'warning', category: '报告', message: `报告「${r.title || r.id}」缺少 periodKey`, fixable: false, fix: null });
    else byPeriod.set(r.periodKey, (byPeriod.get(r.periodKey) ?? 0) + 1);
    if (r.reportType === 'weekly' && r.weekNumber !== undefined && (r.weekNumber < 1 || r.weekNumber > 53)) {
      issues.push({ severity: 'warning', category: '报告', message: `报告「${r.title}」周编号非法（${r.weekNumber}）`, fixable: false, fix: null });
    }
    if (!r.title?.trim()) issues.push({ severity: 'warning', category: '报告', message: `报告 ${r.id} 缺少标题`, fixable: false, fix: null });
  }
  for (const [key, count] of byPeriod) {
    if (count > 1) issues.push({ severity: 'warning', category: '报告', message: `存在重复周期报告：${key}（${count} 份）`, fixable: false, fix: null });
  }
  return issues;
}

/** 目标健康：金额非法 / 时间顺序 / 时区 / 主目标缺失。 */
export function checkGoalHealth(goals: Goal[], primaryGoalId: string | null): DataIssue[] {
  const issues: DataIssue[] = [];
  for (const g of goals) {
    if (!Number.isFinite(g.targetAmount) || g.targetAmount <= 0) {
      issues.push({ severity: 'error', category: '目标', message: `目标「${g.name}」金额非法`, fixable: false, fix: null });
    }
    if (g.targetDateTime <= g.startDateTime) {
      issues.push({ severity: 'warning', category: '目标', message: `目标「${g.name}」目标时间早于起始时间`, fixable: false, fix: null });
    }
    if (!isValidTimezone(g.timezone)) {
      issues.push({ severity: 'warning', category: '目标', message: `目标「${g.name}」时区无效（${g.timezone}）`, fixable: false, fix: null });
    }
  }
  if (goals.length > 0 && !primaryGoalId) {
    issues.push({ severity: 'warning', category: '目标', message: '未设置主目标', fixable: false, fix: null });
  }
  return issues;
}

/** 等级成就健康：重复 / 未知等级。 */
export function checkAchievementHealth(achievements: LevelAchievement[]): DataIssue[] {
  const issues: DataIssue[] = [];
  const seen = new Set<string>();
  for (const a of achievements) {
    if (seen.has(a.levelId)) issues.push({ severity: 'warning', category: '等级', message: `重复的等级成就：${a.levelName}`, fixable: false, fix: null });
    seen.add(a.levelId);
    if (a.firstAmount < 0 || !Number.isFinite(a.firstAmount)) {
      issues.push({ severity: 'warning', category: '等级', message: `成就「${a.levelName}」金额非法`, fixable: false, fix: null });
    }
  }
  return issues;
}
