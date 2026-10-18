import { describe, expect, it } from 'vitest';
import { scopeSummary, valueDateOf } from '../../src/features/monthlyPlanning/scope';
import { declaredDateFromName } from '../../src/services/monthlyPlanning/importDocuments';
import { createDraftSession } from '../../src/domain/portfolio/session';
import type { HoldingObservation, MonthlyReview } from '../../src/domain/portfolio/types';

const observation = (overrides: Partial<HoldingObservation> = {}): HoldingObservation => ({
  id: 'obs:1', holdingId: 'h1', sessionKey: 'monthly-planning:2026-07', shares: '100.00', marketValue: 1000,
  nav: '1.0000', navDate: '2026-07-17', evidence: [], quality: { source: 'evidence', attribution: 'conditional', valuation: 'observed', time: 'observed', review: 'pending' },
  ...overrides,
});

const session = (overrides: Partial<MonthlyReview> = {}): MonthlyReview => ({
  ...createDraftSession({ planningMonth: '2026-07', timezone: 'Asia/Shanghai', today: '2026-07-20', now: 'now' }),
  ...overrides,
});

describe('口径对照', () => {
  it('没有观察值时合计为 0、差额不可判定，也不会把渠道资产当成证据', () => {
    const summary = scopeSummary(session(), 123_456, '2026-10-18');
    expect(summary.evidence).toMatchObject({ total: 0, count: 0, unknownCount: 0, from: null, to: null });
    expect(summary.channels).toEqual({ total: 123_456, asOf: '2026-10-18' });
    expect(summary.difference).toBeNull();
  });

  it('值日取净值日、缺失时回退会话快照，并统计未知金额条数', () => {
    const summary = scopeSummary(session({
      snapshotAsOf: '2026-07-20',
      observations: [
        observation({ id: 'obs:1', marketValue: 1000, navDate: '2026-07-17' }),
        observation({ id: 'obs:2', marketValue: 500, navDate: '2026-07-18' }),
        observation({ id: 'obs:3', marketValue: null, navDate: undefined }),
      ],
    }), 2000, '2026-10-18');
    expect(summary.evidence).toMatchObject({ total: 1500, count: 3, unknownCount: 1, from: '2026-07-17', to: '2026-07-20' });
    expect(summary.difference).toBe(-500);
    expect(valueDateOf(observation({ navDate: undefined }), '2026-07-20')).toBe('2026-07-20');
  });

  it('从文件名解析导出日，非法日期不写', () => {
    expect(declaredDateFromName('20260720支付宝渠道.docx')).toBe('2026-07-20');
    expect(declaredDateFromName('20260720微信渠道.jpg')).toBe('2026-07-20');
    expect(declaredDateFromName('支付宝渠道.docx')).toBeUndefined();
    expect(declaredDateFromName('20260230渠道.docx')).toBeUndefined();
  });
});
