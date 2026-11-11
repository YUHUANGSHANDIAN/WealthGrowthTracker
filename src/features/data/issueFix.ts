import type { Channel, HistoryPoint } from '../../types';
import { applyHealthFixes, type DataIssue } from '../../utils/dataHealth';
import { scanAllHealth, type HealthScanInput } from '../../utils/healthScan';

export interface HealthFixProposal {
  operationId: string;
  issueId: string;
  issueFingerprint: string;
  fix: NonNullable<DataIssue['fix']>;
  baseRevision: number;
  before: Pick<HealthScanInput, 'channels' | 'history'>;
  after: Pick<HealthScanInput, 'channels' | 'history'>;
  changedChannels: string[];
  changedHistoryDates: string[];
  summary: string;
  warnings: string[];
}

const issued = new WeakMap<HealthFixProposal, string>();

function serialized(proposal: HealthFixProposal): string {
  return JSON.stringify({
    operationId: proposal.operationId,
    issueId: proposal.issueId,
    issueFingerprint: proposal.issueFingerprint,
    fix: proposal.fix,
    baseRevision: proposal.baseRevision,
    changedChannels: proposal.changedChannels,
    changedHistoryDates: proposal.changedHistoryDates,
    summary: proposal.summary,
    warnings: proposal.warnings,
    after: proposal.after,
  });
}

function changedChannelIds(before: Channel[], after: Channel[]): string[] {
  const previous = new Map(before.map((channel) => [channel.id, JSON.stringify(channel)]));
  const current = new Map(after.map((channel) => [channel.id, JSON.stringify(channel)]));
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((id) => previous.get(id) !== current.get(id))
    .sort();
}

function changedHistoryDates(before: HistoryPoint[], after: HistoryPoint[]): string[] {
  const group = (points: HistoryPoint[]) => {
    const result = new Map<string, string[]>();
    for (const point of points) result.set(point.date, [...(result.get(point.date) ?? []), JSON.stringify(point)]);
    for (const values of result.values()) values.sort();
    return result;
  };
  const previous = group(before);
  const current = group(after);
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((date) => JSON.stringify(previous.get(date) ?? []) !== JSON.stringify(current.get(date) ?? []))
    .sort();
}

/**
 * Rebuilds the deterministic scan and prepares exactly one identified issue.
 * The proposal is informational until the store revalidates and commits it.
 */
export function prepareHealthFix(
  input: HealthScanInput,
  baseRevision: number,
  issueId: string,
  issueFingerprint: string,
): HealthFixProposal {
  const issue = scanAllHealth(input).find((candidate) => candidate.id === issueId);
  if (!issue) throw new Error('该问题已变化或已解决，请重新扫描');
  if (issue.fingerprint !== issueFingerprint) throw new Error('问题证据指纹已变化，请重新查看修复预览');
  if (!issue.fix || !issue.fixable) throw new Error('此问题没有可用的安全自动修复');
  const result = applyHealthFixes(input.channels, input.history, [issue]);
  if (result.fixed !== 1) throw new Error('该问题没有可确认的安全修复差异');
  const channelsChanged = changedChannelIds(input.channels, result.channels);
  const historyChanged = changedHistoryDates(input.history, result.history);
  if (!channelsChanged.length && !historyChanged.length) throw new Error('修复预览没有任何数据差异');
  const proposal: HealthFixProposal = {
    operationId: crypto.randomUUID(),
    issueId: issue.id,
    issueFingerprint: issue.fingerprint,
    fix: issue.fix,
    baseRevision,
    before: { channels: input.channels, history: input.history },
    after: { channels: result.channels, history: result.history },
    changedChannels: channelsChanged,
    changedHistoryDates: historyChanged,
    summary: `${issue.title}：将精确修改 ${channelsChanged.length} 个渠道项和 ${historyChanged.length} 个历史日期`,
    warnings: [
      '只提交当前问题指纹对应的修复，不重新做全局规范化。',
      ...(issue.possiblyDestructive ? ['此操作可能改变财务数据；应用会先创建恢复点。'] : []),
    ],
  };
  issued.set(proposal, serialized(proposal));
  return proposal;
}

/** Fail closed if the proposal object changed, or the exact issue is no longer current. */
export function assertHealthFixProposal(current: HealthScanInput, baseRevision: number, proposal: HealthFixProposal): void {
  if (issued.get(proposal) !== serialized(proposal)) throw new Error('修复预览未经本地校验或已被修改');
  if (baseRevision !== proposal.baseRevision) throw new Error('数据已变化，请重新预览修复');
  const issue = scanAllHealth(current).find((candidate) => candidate.id === proposal.issueId);
  if (!issue || issue.fingerprint !== proposal.issueFingerprint) throw new Error('问题已变化或已解决，请重新扫描');
  if (issue.fix !== proposal.fix) throw new Error('修复动作与当前问题不再一致');
  const rebuilt = prepareHealthFix(current, baseRevision, issue.id, issue.fingerprint);
  if (rebuilt.fix !== proposal.fix
    || JSON.stringify(rebuilt.after) !== JSON.stringify(proposal.after)) {
    throw new Error('修复结果已变化，请重新查看预览');
  }
}

export function consumeHealthFixProposal(proposal: HealthFixProposal): void {
  issued.delete(proposal);
}
