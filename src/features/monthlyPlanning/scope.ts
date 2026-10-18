import { moneyDiff, roundMoney } from '../../domain/portfolio/decimal';
import type { HoldingObservation, MonthlyReview } from '../../domain/portfolio/types';

/**
 * 两种口径必须分开看：
 * - **本期证据口径**：本会话观察到的金额合计，值日来自文档（净值日）或会话快照；
 * - **主应用渠道资产**：资产页维护的当前渠道金额，是"今天"的数字。
 * 平台导出的资产证明是某日冻结的，申购确认、净值更新与在途资金都有延迟，
 * 所以两者不等是正常的——会话内的一切计算只用证据口径，渠道资产仅作参照。
 */
export interface ScopeSummary {
  evidence: {
    total: number;
    count: number;
    unknownCount: number;
    /** 观察值里的值日范围（含会话快照兜底）；没有观察值时两端都是 null。 */
    from: string | null;
    to: string | null;
  };
  channels: { total: number; asOf: string };
  /** 证据合计 − 渠道资产；证据为空时无法比较，返回 null。 */
  difference: number | null;
}

/** 一条观察的值日：优先净值日期，否则按会话快照日对待（明确写在界面上）。 */
export function valueDateOf(observation: HoldingObservation, fallback: string): string {
  return observation.navDate ?? fallback;
}

export function scopeSummary(session: MonthlyReview, channelTotal: number, today: string): ScopeSummary {
  const valued = session.observations.filter((observation) => observation.marketValue !== null);
  const total = roundMoney(valued.reduce((sum, observation) => sum + (observation.marketValue as number), 0));
  const dates = session.observations.map((observation) => valueDateOf(observation, session.snapshotAsOf)).sort();
  const evidenceCount = session.observations.length;
  return {
    evidence: {
      total,
      count: evidenceCount,
      unknownCount: evidenceCount - valued.length,
      from: dates.length ? dates[0] as string : null,
      to: dates.length ? dates[dates.length - 1] as string : null,
    },
    channels: { total: channelTotal, asOf: today },
    difference: evidenceCount === 0 ? null : moneyDiff(total, channelTotal),
  };
}
