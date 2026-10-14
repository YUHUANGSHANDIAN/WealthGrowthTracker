import { describe, expect, it } from 'vitest';
import { inspectRecoveryCandidate } from '../../src/services/storage/recoveryCandidate';
import { REPORT_SCHEMA_VERSION } from '../../src/features/reports/normalize';

const payload = () => ({
  wealth_tracker_data: JSON.stringify({ channels: [{ id: 'asset', amount: 123.45, title: '合成渠道' }], history: [] }),
  financial_reports: JSON.stringify([{ id: 'report', startDate: '2026-01-01', endDate: '2026-01-31', totalAmount: 123.45, reportSchemaVersion: REPORT_SCHEMA_VERSION }]),
  unknown_key: 'preserve this exactly',
});

describe('recovery candidate inspection', () => {
  it('accepts legacy state and preserves unknown fields and raw text', () => {
    const raw = JSON.stringify(payload(), null, 2);
    const before = raw;
    expect(inspectRecoveryCandidate(raw)).toEqual({ channels: 1, snapshots: 0, reports: 1, storageSchemaVersion: 0 });
    expect(raw).toBe(before);
    expect(JSON.parse(raw).unknown_key).toBe('preserve this exactly');
  });

  it('accepts current envelopes and intentionally empty ledgers', () => {
    expect(inspectRecoveryCandidate(JSON.stringify({ storageSchemaVersion: 1, revision: 7, payload: {
      wealth_tracker_data: '{"channels":[],"history":[]}',
    }, unknownMetadata: { retained: true } }))).toEqual({ channels: 0, snapshots: 0, reports: 0, storageSchemaVersion: 1 });
  });

  it.each(['{', 'null', '[]', '{}', '{"wealth_tracker_data":"null"}'])('rejects unreadable or missing ledger: %s', raw => {
    expect(() => inspectRecoveryCandidate(raw)).toThrow();
  });

  it('rejects future storage and report schemas', () => {
    expect(() => inspectRecoveryCandidate(JSON.stringify({ storageSchemaVersion: 2, revision: 1, payload: payload() }))).toThrow('更新版本');
    const candidate = payload();
    candidate.financial_reports = JSON.stringify([{ id: 'report', startDate: '2026-01-01', endDate: '2026-01-31', totalAmount: 123, reportSchemaVersion: REPORT_SCHEMA_VERSION + 1 }]);
    expect(() => inspectRecoveryCandidate(JSON.stringify(candidate))).toThrow('更新版本');
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects invalid revisions: %s', revision => {
    expect(() => inspectRecoveryCandidate(JSON.stringify({ storageSchemaVersion: 1, revision, payload: payload() }))).toThrow('Envelope');
  });

  it('rejects corrupt money, real calendar dates and inconsistent known baselines', () => {
    const candidate = payload();
    candidate.wealth_tracker_data = '{"channels":[{"id":"asset","amount":"invalid"}],"history":[]}';
    expect(() => inspectRecoveryCandidate(JSON.stringify(candidate))).toThrow('金额');
    candidate.wealth_tracker_data = '{"channels":[],"history":[{"date":"2026-02-30","totalAmount":0}]}';
    expect(() => inspectRecoveryCandidate(JSON.stringify(candidate))).toThrow('日期');
    candidate.wealth_tracker_data = '{"channels":[],"history":[]}';
    candidate.financial_reports = '[{"id":"r","startDate":"2026-01-01","endDate":"2026-01-02","totalAmount":0,"baselineStatus":"known"}]';
    expect(() => inspectRecoveryCandidate(JSON.stringify(candidate))).toThrow('期初');
  });
});
