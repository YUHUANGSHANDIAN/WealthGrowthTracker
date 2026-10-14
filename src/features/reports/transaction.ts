import type { Channel, FinancialReport, HistoryPoint, ReportType } from '../../types';
import { getLevelByAmount } from '../../constants/levels';
import { totalAssets } from '../../utils/channels';
import { todayString } from '../../utils/date';
import { buildManualEditAudit, diffReportFields, type FieldDiff } from '../../utils/reportEdit';
import { overwriteHistoryPoint } from '../../utils/history';
import { round2 } from '../../utils/money';
import { generateReport, periodRange } from './generate';
import { buildAssetComposition, buildChannelDetails, normalizeFinancialReport, periodKeyOf, topChannelsFrom } from './normalize';

export interface ReportTransactionState {
  baseRevision: number;
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
}
export interface ReportConflict { kind: 'snapshot' | 'period'; label: string; existing: HistoryPoint | FinancialReport }
export interface ReportProposal {
  kind: 'generate' | 'edit';
  baseRevision: number;
  baseFingerprint: string;
  history: HistoryPoint[];
  reports: FinancialReport[];
  report: FinancialReport;
  conflicts: ReportConflict[];
  diffs: FieldDiff[];
  changed: boolean;
}
export interface ReportApproval { overwriteSnapshot?: boolean; overwriteReport?: boolean }

const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const fingerprint = (s: ReportTransactionState) => JSON.stringify([s.channels, s.history, s.reports]);
const key = (r: FinancialReport) => normalizeFinancialReport(r).periodKey ?? periodKeyOf(r);
// Proposals are ephemeral capabilities issued by prepare, never accepted as an
// arbitrary deserialized state replacement (including from AI or imports).
const issuedProposals = new WeakMap<ReportProposal, string>();

function financialIdentity(r: FinancialReport): string {
  const facts: Partial<FinancialReport> = { ...r };
  for (const field of ['id', 'createdAt', 'generatedAt', 'updatedAt', 'revision', 'reportNormalizedAt'] as const) delete facts[field];
  const evidence = facts as typeof facts & { verificationEvidence?: { checkedAt: string } };
  if (evidence.verificationEvidence) evidence.verificationEvidence = { ...evidence.verificationEvidence, checkedAt: '' };
  return JSON.stringify(facts);
}

function finish(s: ReportTransactionState, kind: ReportProposal['kind'], report: FinancialReport, history: HistoryPoint[], previous: FinancialReport | undefined, conflicts: ReportConflict[], diffs: FieldDiff[], nowIso: string): ReportProposal {
  const same = previous && financialIdentity(previous) === financialIdentity(report);
  if (same) report = previous;
  else if (previous) report = { ...report, id: previous.id, createdAt: previous.createdAt, revision: (previous.revision ?? 1) + 1, updatedAt: nowIso };
  const reports = [report, ...s.reports.filter((r) => r.id !== previous?.id && key(r) !== key(report))];
  const changed = !same || JSON.stringify(history) !== JSON.stringify(s.history) || reports.length !== s.reports.length;
  const proposal = clone({ kind, baseRevision: s.baseRevision, baseFingerprint: fingerprint(s), history, reports: changed ? reports : s.reports, report, conflicts, diffs, changed });
  issuedProposals.set(proposal, JSON.stringify(proposal));
  return proposal;
}

/** Pure preparation: current periods may include a candidate daily snapshot; past periods never do. */
export function prepareReportGeneration(s: ReportTransactionState, reportType: ReportType, referenceDate = todayString(), now = todayString(), nowIso = new Date().toISOString()): ReportProposal {
  const range = periodRange(reportType, referenceDate);
  let history = clone(s.history);
  const conflicts: ReportConflict[] = [];
  if (range.startDate <= now && now <= range.endDate) {
    const snapshot: HistoryPoint = { date: now, totalAmount: totalAssets(s.channels), channels: clone(s.channels), source: 'weekly-report', wealthLevel: getLevelByAmount(totalAssets(s.channels)).name, updatedAt: nowIso, timestamp: Date.parse(nowIso) };
    const existing = history.find((h) => h.date === now);
    const same = existing && existing.totalAmount === snapshot.totalAmount && JSON.stringify(existing.channels ?? []) === JSON.stringify(snapshot.channels);
    if (!same) {
      if (existing) conflicts.push({ kind: 'snapshot', label: `更新 ${now} 的日快照`, existing });
      history = overwriteHistoryPoint(history, snapshot);
    }
  }
  let report = generateReport(history, reportType, referenceDate, s.channels, now);
  const previous = s.reports.find((r) => key(r) === key(report));
  if (previous) {
    report = { ...report, titleMode: previous.titleMode, customTitle: previous.customTitle, title: previous.titleMode === 'custom' && previous.customTitle ? previous.customTitle : report.title, tags: previous.tags, customSummary: previous.customSummary, archiveNote: previous.archiveNote, isArchived: previous.isArchived, archivedAt: previous.archivedAt, repairAudit: previous.repairAudit, fieldProvenance: previous.fieldProvenance };
    if (financialIdentity(previous) !== financialIdentity(report)) conflicts.push({ kind: 'period', label: `更新 ${key(report)} 的报告`, existing: previous });
  }
  return finish(s, 'generate', report, history, previous, conflicts, previous ? diffReportFields(previous, report) : [], nowIso);
}

/** Recompute dependent fields once for editors, import proposals and AI drafts. */
export function refreshReportDerived(edited: FinancialReport): FinancialReport {
  if (!Number.isFinite(edited.totalAmount) || (edited.previousTotalAmount !== undefined && !Number.isFinite(edited.previousTotalAmount))) throw new Error('报告金额必须是有效数字');
  const level = getLevelByAmount(edited.totalAmount);
  const previous = edited.previousTotalAmount;
  const changeAmount = previous === undefined ? 0 : round2(edited.totalAmount - previous);
  const changePercentage = previous && previous > 0 ? round2(changeAmount / previous * 100) : 0;
  const channelDetails = edited.channels ? buildChannelDetails(edited.channels, edited.totalAmount) : edited.channelDetails;
  return normalizeFinancialReport({ ...edited, changeAmount, changePercentage,
    ...(edited.reportType === 'weekly' ? { weeklyChange: changeAmount, weeklyChangePercentage: changePercentage } : edited.reportType === 'monthly' ? { monthlyChange: changeAmount, monthlyChangePercentage: changePercentage } : { yearlyChange: changeAmount, yearlyChangePercentage: changePercentage }),
    channelDetails, assetComposition: edited.channels ? buildAssetComposition(edited.channels, edited.totalAmount) : edited.assetComposition, topChannels: topChannelsFrom(channelDetails), summary: undefined,
    wealthLevel: level.name, wealthLevelName: level.name, wealthLevelTheme: level.theme, wealthLevelColor: level.color,
  });
}

export function prepareReportEdit(s: ReportTransactionState, id: string, edited: FinancialReport, opts: { syncHistory?: boolean; reason?: string } = {}, nowIso = new Date().toISOString()): ReportProposal {
  const original = s.reports.find((r) => r.id === id);
  if (!original) throw new Error('报告已被删除，请重新打开');
  const report = refreshReportDerived({ ...edited, id });
  const diffs = diffReportFields(original, report);
  report.repairAudit = [...(original.repairAudit ?? []), ...buildManualEditAudit(original, report, opts.reason ?? '手动编辑报告')];
  const conflicts: ReportConflict[] = [];
  const occupied = s.reports.find((r) => r.id !== id && key(r) === key(report));
  if (occupied) conflicts.push({ kind: 'period', label: `目标周期 ${key(report)} 已有报告，确认替换`, existing: occupied });
  let history = clone(s.history);
  if (opts.syncHistory) {
    if (!report.dataAsOf || report.dataAsOf < report.startDate || report.dataAsOf > report.endDate) throw new Error('同步日期必须在报告周期内');
    const existing = history.find((p) => p.date === report.dataAsOf);
    const snapshot: HistoryPoint = { ...existing, date: report.dataAsOf, totalAmount: report.totalAmount, channels: clone(report.channels), wealthLevel: report.wealthLevelName, source: 'manual', updatedAt: nowIso, timestamp: Date.parse(nowIso) };
    if (existing && (existing.totalAmount !== snapshot.totalAmount || JSON.stringify(existing.channels) !== JSON.stringify(snapshot.channels))) conflicts.push({ kind: 'snapshot', label: `同步修改 ${report.dataAsOf} 日快照`, existing });
    history = overwriteHistoryPoint(history, snapshot);
  }
  return finish(s, 'edit', report, history, original, conflicts, diffs, nowIso);
}

/** Returns the exact canonical values for one Store set. It never writes or persists. */
export function confirmReportProposal(s: ReportTransactionState, proposal: ReportProposal, approval: ReportApproval = {}): Pick<ReportProposal, 'history' | 'reports' | 'report' | 'changed'> {
  if (issuedProposals.get(proposal) !== JSON.stringify(proposal)) throw new Error('报告预览已变化或不是本次准备的提案，请重新准备');
  if (s.baseRevision !== proposal.baseRevision || fingerprint(s) !== proposal.baseFingerprint) throw new Error('数据已变化，请重新准备并确认');
  if (proposal.conflicts.some((c) => c.kind === 'snapshot') && !approval.overwriteSnapshot) throw new Error('需要确认日快照更新');
  if (proposal.conflicts.some((c) => c.kind === 'period') && !approval.overwriteReport) throw new Error('需要确认报告周期更新');
  const dates = new Set(proposal.history.map((p) => p.date));
  const periods = new Set(proposal.reports.map(key));
  if (dates.size !== proposal.history.length || periods.size !== proposal.reports.length) throw new Error('存在重复日期或报告周期，请先修复数据');
  return clone({ history: proposal.history, reports: proposal.reports, report: proposal.report, changed: proposal.changed });
}
