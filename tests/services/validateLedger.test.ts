import { describe, expect, it } from 'vitest';
import { validateLedgerShape, validateFinancialExtensions } from '../../src/services/storage/validateLedger';
import { REPORT_SCHEMA_VERSION } from '../../src/features/reports/normalize';

describe('ledger validation before normalization', () => {
  it('allows first run, empty ledger and explicit zero', () => {
    expect(() => validateLedgerShape(null, null)).not.toThrow();
    expect(() => validateLedgerShape({ channels: [], history: [] }, [])).not.toThrow();
    expect(() => validateLedgerShape({ channels: [{ id: 'a', amount: 0 }], history: [{ date: '2024-02-29', totalAmount: 0 }] }, [])).not.toThrow();
  });
  it.each([undefined, null, '100', Infinity, NaN])('rejects invalid amount %s before it can become zero', value => {
    expect(() => validateLedgerShape({ channels: [{ id: 'a', amount: value }], history: [] }, [])).toThrow('金额');
  });
  it('rejects impossible calendar dates and invalid historical child amounts', () => {
    expect(() => validateLedgerShape({ channels: [], history: [{ date: '2025-02-29', totalAmount: 1 }] }, [])).toThrow('日期');
    expect(() => validateLedgerShape({ channels: [], history: [{ date: '2024-02-29', totalAmount: 1, channels: [{ id: 'p', amount: 1, children: [{ id: 'c', amount: null }] }] }] }, [])).toThrow('金额');
  });
  it('rejects future report schema and inverted periods', () => {
    const report = { id: 'r', startDate: '2026-01-01', endDate: '2026-01-07', totalAmount: 100 };
    expect(() => validateLedgerShape(null, [{ ...report, reportSchemaVersion: REPORT_SCHEMA_VERSION + 1 }])).toThrow('Schema');
    expect(() => validateLedgerShape(null, [{ ...report, endDate: '2025-12-31' }])).toThrow('周期');
  });

  it.each(['weeklyMax', 'monthlyAvg', 'yearlyMin'])('refuses corrupt optional report statistic %s', field => {
    expect(() => validateLedgerShape(null, [{ id: 'r', startDate: '2026-01-01', endDate: '2026-01-07', totalAmount: 100, [field]: null }])).toThrow(field);
  });

  it('validates saved composition and report snapshot amounts before rebuilding them', () => {
    const report = { id: 'r', startDate: '2026-01-01', endDate: '2026-01-07', totalAmount: 100 };
    expect(() => validateLedgerShape(null, [{ ...report, assetComposition: { totalAmount: 100, parents: [{ amount: 'broken' }] } }])).toThrow('金额');
    expect(() => validateLedgerShape(null, [{ ...report, channels: [{ id: 'c', amount: null }] }])).toThrow('金额');
  });

  it('refuses corrupt targets, progress and lottery amounts instead of falling back to zero', () => {
    expect(() => validateFinancialExtensions({ goals: { goals: [{ targetAmount: 'bad' }] } })).toThrow('targetAmount');
    expect(() => validateFinancialExtensions({ countdown_data: { targetAmount: null } })).toThrow('targetAmount');
    expect(() => validateFinancialExtensions({ countdown_progress_history: [{ totalAmount: 100, progress: NaN }] })).toThrow('progress');
    expect(() => validateFinancialExtensions({ lottery_state: { pool: { openingBalance: 0 }, transactions: [{ amount: -100 }] } })).toThrow('方向');
  });
});
