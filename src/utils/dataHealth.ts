import type { Channel, FinancialReport, Goal, HistoryPoint, LevelAchievement, LotteryState } from '../types';
import { round2 } from './money';
import { isValidTimezone } from './goals';
import { canonicalWeeklyPeriod, parseWeeklyPeriodKey } from './isoWeek';

export type HealthDomain = 'assets' | 'history' | 'reports' | 'goals' | 'levels' | 'lottery' | 'storage' | 'settings';

export interface FixStrategy {
  id: string;
  label: string;
  description: string;
  /** 修复动作标识（对应 applyHealthFixes 的 fix 值）。 */
  action?: 'sanitize-amounts' | 'remove-orphans' | 'dedupe-history';
}

export interface DataIssue {
  id: string;
  domain: HealthDomain;
  entityId?: string;
  severity: 'warning' | 'error';
  title: string;
  description: string;
  message: string;
  evidence?: string[];
  fixStrategies: FixStrategy[];
  safeAutoFix: boolean;
  possiblyDestructive: boolean;
  fixable: boolean;
  fix: 'sanitize-amounts' | 'remove-orphans' | 'dedupe-history' | null;
  category: string;
}

let issueSeq = 0;
function makeIssue(
  domain: HealthDomain,
  severity: 'warning' | 'error',
  title: string,
  description: string,
  fix: DataIssue['fix'],
  opts: Partial<Pick<DataIssue, 'entityId' | 'evidence' | 'fixStrategies' | 'safeAutoFix' | 'possiblyDestructive'>> = {},
): DataIssue {
  issueSeq += 1;
  return {
    id: `${domain}-${issueSeq}`,
    domain,
    entityId: opts.entityId,
    severity,
    title,
    description,
    message: `${title}${description ? '：' + description : ''}`,
    evidence: opts.evidence,
    fixStrategies: opts.fixStrategies ?? (fix ? [{ id: fix, label: '安全修复', description: '应用安全修复（修复前自动备份）' }] : []),
    safeAutoFix: opts.safeAutoFix ?? (fix !== null),
    possiblyDestructive: opts.possiblyDestructive ?? false,
    fixable: fix !== null || (opts.fixStrategies?.length ?? 0) > 0,
    fix,
    category: domainLabel(domain),
  };
}

export function domainLabel(d: HealthDomain): string {
  switch (d) {
    case 'assets': return '资产渠道';
    case 'history': return '历史记录';
    case 'reports': return '财务报告';
    case 'goals': return '财富目标';
    case 'levels': return '财富等级';
    case 'lottery': return '彩票';
    case 'storage': return '存储与备份';
    case 'settings': return '设置';
  }
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
      issues.push(makeIssue('assets', 'error', `重复的父渠道 ID`, `渠道「${c.id}」出现多次`, null, { entityId: c.id, evidence: [c.name] }));
    }
    channelIds.add(c.id);
    if (!Number.isFinite(c.amount) || c.amount < 0) badAmount = true;
    for (const s of c.children ?? []) {
      if (subIds.has(s.id)) {
        issues.push(makeIssue('assets', 'error', `重复的子渠道 ID`, `子渠道「${s.id}」出现多次`, null, { entityId: s.id, evidence: [s.name] }));
      }
      subIds.add(s.id);
      if (!Number.isFinite(s.amount) || s.amount < 0) badAmount = true;
      if (s.parentId !== c.id) orphan = true;
    }
  }

  const dates = new Set<string>();
  for (const h of history) {
    if (!DATE_RE.test(h.date)) {
      issues.push(makeIssue('history', 'warning', `异常日期`, `历史记录日期「${h.date}」不符合 YYYY-MM-DD 格式`, null, { entityId: h.date, evidence: [h.date] }));
    }
    if (dates.has(h.date)) dupHistory = true;
    dates.add(h.date);
    if (!Number.isFinite(h.totalAmount)) badAmount = true;
    if (h.totalAmount < 0) {
      issues.push(makeIssue('history', 'warning', `历史总资产为负`, `日期 ${h.date} 的总资产为 ${h.totalAmount}`, null, { entityId: h.date, evidence: [String(h.totalAmount)] }));
    }
  }

  if (badAmount) issues.push(makeIssue('assets', 'error', '存在非法金额', 'NaN / Infinity / 负数会被安全处理（负值按 0 处理，请确认）', 'sanitize-amounts'));
  if (orphan) issues.push(makeIssue('assets', 'warning', '存在孤立子渠道', '子渠道 parentId 与其父渠道不匹配，可移除孤立项', 'remove-orphans'));
  if (dupHistory) issues.push(makeIssue('history', 'warning', '存在重复日期的历史记录', '同一天出现多条记录，可保留最新一条', 'dedupe-history', { fixStrategies: [{ id: 'dedupe-history', label: '保留最新记录', description: '合并同日期，保留最后一条', action: 'dedupe-history' }] }));

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

/** 某日期是星期几（1=Mon .. 7=Sun）。 */
function dayOfWeek(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDay() || 7;
}

/** 报告周期完整性检查（v1.6）：periodKey 缺失 / 重复 / ISO 周规范 / 月年边界。 */
export function checkReportHealth(reports: FinancialReport[]): DataIssue[] {
  const issues: DataIssue[] = [];
  const byPeriod = new Map<string, number>();
  for (const r of reports) {
    if (!r.periodKey) issues.push(makeIssue('reports', 'warning', '报告缺少 periodKey', `报告「${r.title || r.id}」缺少周期标识`, null, { entityId: r.id }));
    else byPeriod.set(r.periodKey, (byPeriod.get(r.periodKey) ?? 0) + 1);
    if (!r.title?.trim()) issues.push(makeIssue('reports', 'warning', '报告缺少标题', `报告 ${r.id} 标题为空`, null, { entityId: r.id }));

    if (r.reportType === 'weekly') {
      const identity = parseWeeklyPeriodKey(r.periodKey);
      if (identity) {
        const canonical = canonicalWeeklyPeriod(identity);
        if (r.startDate !== canonical.startDate || r.endDate !== canonical.endDate) {
          issues.push(makeIssue('reports', 'warning', '周报周期非法（非 Monday→Sunday）', `报告「${r.title}」周期 ${r.startDate}~${r.endDate} 应为 ${canonical.startDate}~${canonical.endDate}`, null, { entityId: r.id }));
        }
        if (r.isoWeek !== undefined && r.isoWeek !== identity.isoWeek) {
          issues.push(makeIssue('reports', 'warning', '周报 isoWeek 与 periodKey 冲突', `报告「${r.title}」isoWeek=${r.isoWeek} 但 periodKey=${r.periodKey}`, null, { entityId: r.id }));
        }
        if (r.weekNumber !== undefined && r.weekNumber !== identity.isoWeek) {
          issues.push(makeIssue('reports', 'warning', '周报 weekNumber 与 periodKey 冲突', `报告「${r.title}」weekNumber=${r.weekNumber} 但 periodKey=${r.periodKey}`, null, { entityId: r.id }));
        }
        if (r.isoWeekYear !== undefined && r.isoWeekYear !== identity.isoWeekYear) {
          issues.push(makeIssue('reports', 'warning', '周报 isoWeekYear 冲突', `报告「${r.title}」isoWeekYear=${r.isoWeekYear} 应为 ${identity.isoWeekYear}`, null, { entityId: r.id }));
        }
        if (r.standardTitle && r.standardTitle !== canonical.standardTitle) {
          issues.push(makeIssue('reports', 'warning', '周报标准标题与周期不符', `报告「${r.title}」standardTitle="${r.standardTitle}" 应为 "${canonical.standardTitle}"`, null, { entityId: r.id }));
        }
      } else if (r.startDate && r.endDate) {
        const sd = dayOfWeek(r.startDate);
        const ed = dayOfWeek(r.endDate);
        if (sd !== 1 || ed !== 7) {
          issues.push(makeIssue('reports', 'warning', '周报周期非法（非 Monday→Sunday）', `报告「${r.title}」周期 ${r.startDate}~${r.endDate} 不是周一到周日`, null, { entityId: r.id }));
        }
      }
    } else if (r.reportType === 'monthly' && r.startDate && r.endDate) {
      const startOk = /-01$/.test(r.startDate);
      const endOk = /-31$|-30$|-29$|-28$/.test(r.endDate);
      if (!startOk || !endOk) {
        issues.push(makeIssue('reports', 'warning', '月报日期边界非法', `报告「${r.title}」周期 ${r.startDate}~${r.endDate} 不是月初~月末`, null, { entityId: r.id }));
      }
    } else if (r.reportType === 'yearly' && r.startDate && r.endDate) {
      if (!/^(\d{4})-01-01$/.test(r.startDate) || !/^(\d{4})-12-31$/.test(r.endDate)) {
        issues.push(makeIssue('reports', 'warning', '年报日期边界非法', `报告「${r.title}」周期 ${r.startDate}~${r.endDate} 不是 01-01~12-31`, null, { entityId: r.id }));
      }
    }
  }
  for (const [key, count] of byPeriod) {
    if (count > 1) issues.push(makeIssue('reports', 'warning', '存在重复周期报告', `periodKey ${key} 有 ${count} 份报告`, null, { entityId: key }));
  }
  return issues;
}

/** 目标健康：金额非法 / 时间顺序 / 时区 / 主目标缺失。 */
export function checkGoalHealth(goals: Goal[], primaryGoalId: string | null): DataIssue[] {
  const issues: DataIssue[] = [];
  for (const g of goals) {
    if (!Number.isFinite(g.targetAmount) || g.targetAmount <= 0) {
      issues.push(makeIssue('goals', 'error', '目标金额非法', `目标「${g.name}」金额为 ${g.targetAmount}`, null, { entityId: g.id }));
    }
    if (g.targetDateTime <= g.startDateTime) {
      issues.push(makeIssue('goals', 'warning', '目标时间顺序错误', `目标「${g.name}」目标时间早于起始时间`, null, { entityId: g.id }));
    }
    if (!isValidTimezone(g.timezone)) {
      issues.push(makeIssue('goals', 'warning', '时区无效', `目标「${g.name}」时区 ${g.timezone} 无效`, null, { entityId: g.id }));
    }
  }
  if (goals.length > 0 && !primaryGoalId) {
    issues.push(makeIssue('goals', 'warning', '未设置主目标', '存在目标但未指定主目标', null));
  }
  return issues;
}

/** 等级成就健康：重复 / 金额非法。 */
export function checkAchievementHealth(achievements: LevelAchievement[]): DataIssue[] {
  const issues: DataIssue[] = [];
  const seen = new Set<string>();
  for (const a of achievements) {
    if (seen.has(a.levelId)) issues.push(makeIssue('levels', 'warning', '重复的等级成就', `等级「${a.levelName}」的成就记录重复`, null, { entityId: a.levelId }));
    seen.add(a.levelId);
    if (a.firstAmount < 0 || !Number.isFinite(a.firstAmount)) {
      issues.push(makeIssue('levels', 'warning', '成就金额非法', `成就「${a.levelName}」金额为 ${a.firstAmount}`, null, { entityId: a.levelId }));
    }
  }
  return issues;
}

/** 彩票健康：重复交易 ID / 非法日期 / 金额<=0 / 缺失项目 / 未知类型 / 项目一致性。Pool 为负不是错误。 */
export function checkLotteryHealth(lottery: LotteryState): DataIssue[] {
  const issues: DataIssue[] = [];
  const ids = new Set<string>();
  const projectIds = new Set(lottery.projects.map((p) => p.id));
  const validTypes = ['capital-injection', 'capital-withdrawal', 'stake', 'prize', 'adjustment'];
  for (const t of lottery.transactions) {
    if (ids.has(t.id)) issues.push(makeIssue('lottery', 'warning', '重复交易 ID', `彩票交易 ID ${t.id} 重复`, null, { entityId: t.id }));
    ids.add(t.id);
    if (!t.occurredAt || Number.isNaN(Date.parse(t.occurredAt))) {
      issues.push(makeIssue('lottery', 'warning', '非法日期', `交易 ${t.id} 日期「${t.occurredAt}」非法`, null, { entityId: t.id }));
    }
    if (!Number.isFinite(t.amount) || t.amount <= 0) {
      issues.push(makeIssue('lottery', 'error', '交易金额非法', `交易 ${t.id} 金额必须大于 0（当前 ${t.amount}）`, null, { entityId: t.id }));
    }
    if (t.projectId && !projectIds.has(t.projectId)) {
      issues.push(makeIssue('lottery', 'warning', '交易缺少项目', `交易 ${t.id} 关联了不存在的项目`, null, { entityId: t.id }));
    }
    if (!validTypes.includes(t.type)) {
      issues.push(makeIssue('lottery', 'warning', '未知交易类型', `交易 ${t.id} 类型「${t.type}」未知`, null, { entityId: t.id }));
    }
    if (t.type === 'adjustment' && t.direction !== undefined && t.direction !== 1 && t.direction !== -1) {
      issues.push(makeIssue('lottery', 'warning', '调整方向非法', `交易 ${t.id} 的 adjustment 方向「${String(t.direction)}」非法（应为 1 或 -1）`, null, { entityId: t.id }));
    }
  }

  // 项目级一致性检查
  const seenProjectIds = new Set<string>();
  const seenProjectNames = new Set<string>();
  const txCountByProject = new Map<string, number>();
  for (const t of lottery.transactions) {
    if (t.projectId) txCountByProject.set(t.projectId, (txCountByProject.get(t.projectId) ?? 0) + 1);
  }
  for (const p of lottery.projects) {
    if (seenProjectIds.has(p.id)) issues.push(makeIssue('lottery', 'warning', '重复项目', `项目 ID ${p.id} 重复`, null, { entityId: p.id }));
    seenProjectIds.add(p.id);
    const nameKey = p.name.trim();
    if (nameKey && seenProjectNames.has(nameKey)) issues.push(makeIssue('lottery', 'warning', '重复项目名称', `项目名称「${p.name}」重复`, null, { entityId: p.id }));
    seenProjectNames.add(nameKey);
    if (p.startDate && p.endDate && p.endDate < p.startDate) {
      issues.push(makeIssue('lottery', 'warning', '项目日期范围非法', `项目「${p.name}」结束日期早于开始日期`, null, { entityId: p.id }));
    }
    if (p.dataCompleteness === 'detailed' && (txCountByProject.get(p.id) ?? 0) === 0) {
      issues.push(makeIssue('lottery', 'warning', '详细项目缺少交易', `项目「${p.name}」标记为详细但没有任何交易`, null, { entityId: p.id }));
    }
    if (p.dataCompleteness === 'summary-only' && (txCountByProject.get(p.id) ?? 0) > 0) {
      issues.push(makeIssue('lottery', 'warning', '汇总项目却有交易', `项目「${p.name}」标记为 summary-only 却存在 ${txCountByProject.get(p.id)} 笔交易（可能导致双计数）`, null, { entityId: p.id }));
    }
  }

  // Pool Balance 为负：合法，不是 Health Error。
  return issues;
}
