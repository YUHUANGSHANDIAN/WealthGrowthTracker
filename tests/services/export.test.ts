import { describe, it, expect } from 'vitest';
import type { BackupSource } from '../../src/services/export';
import { buildBackup, parseBackup, BACKUP_VERSION } from '../../src/services/export';
import { defaultChannels, defaultCoinRainConfig, defaultChartSettings } from '../../src/constants/defaults';

function makeSource(): BackupSource {
  return {
    channels: defaultChannels(),
    history: [
      { date: '2026-10-01', totalAmount: 100 },
      { date: '2026-10-02', totalAmount: 150.55 },
    ],
    reports: [],
    sortRules: [],
    countdown: { targetAmount: 1_000_000, targetDate: '2027-01-01', startDate: '2026-01-01' },
    goalAchieved: { hasAchievedGoal: false },
    countdownOpacity: 0.8,
    coinRainConfig: defaultCoinRainConfig(),
    chartSettings: defaultChartSettings(),
    sortHistory: { history: [] },
    timeRangeHistory: { records: [] },
    countdownProgressHistory: [],
    currentWealthLevel: { level: '' },
    wealthTrackerHistory: [],
  };
}

describe('导出 / 导入（数据兼容核心）', () => {
  it('buildBackup → parseBackup 往返一致', () => {
    const src = makeSource();
    const backup = buildBackup(src);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.appInfo.name).toBe('WealthGrowthTracker');

    const text = JSON.stringify(backup);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.channels.length).toBe(src.channels.length);
    expect(parsed.data.history.length).toBe(src.history.length);
    expect(parsed.data.countdown.targetAmount).toBe(1_000_000);
    expect(parsed.data.countdownOpacity).toBe(0.8);
  });

  it('解析旧版备份（仅含核心 6 键）', () => {
    // 模拟旧版灵光导出的 JSON 结构
    const legacy = {
      version: '1.0.0',
      exportDate: '2026-10-01T00:00:00.000Z',
      appInfo: { name: '财富成长记', version: '1.0.0' },
      data: {
        wealth_tracker_data: {
          channels: [
            {
              id: 'alipay', name: '支付宝', emoji: '💙', amount: 30, color: '#3B82F6',
              isParent: true, isExpanded: false,
              children: [
                { id: 'alipay_yue', name: '余额', emoji: '💰', amount: 30, color: '#10B981', parentId: 'alipay' },
              ],
            },
          ],
          history: [{ date: '2026-09-01', totalAmount: 30 }],
        },
        financial_reports: [],
        custom_sort_rules: { rules: [] },
        countdown_data: { targetAmount: 1_000_000, targetDate: '2027-01-01', startDate: '2026-01-01' },
        goal_achievement_status: { hasAchievedGoal: false },
        countdown_opacity: 1,
      },
      metadata: { totalRecords: { channels: 1, history: 1 } },
    };

    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.channels).toHaveLength(1);
    expect(parsed.data.channels[0]!.children).toHaveLength(1);
    expect(parsed.data.history[0]!.totalAmount).toBe(30);
  });

  it('preserves event notes, source and timestamps through a backup round trip', () => {
    const source = makeSource();
    source.history[0] = {
      ...source.history[0]!, source: 'manual', updatedAt: '2026-10-01T10:00:00Z',
      eventNote: '账户整理，不是现金流', eventNoteUpdatedAt: '2026-10-01T11:00:00Z',
    };
    const parsed = parseBackup(JSON.stringify(buildBackup(source)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.history[0]).toEqual(source.history[0]);
  });

  it('拒绝非法 JSON', () => {
    const r = parseBackup('not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
  });

  it('retains unknown nested entity fields, verification evidence and original ordering', () => {
    const backup = buildBackup(makeSource());
    const data = backup.data as unknown as Record<string, unknown>;
    const ledger = data.wealth_tracker_data as { channels: Record<string, unknown>[]; history: Record<string, unknown>[] };
    ledger.channels[0]!.futureLabel = { zh: '保留这个字段' };
    ledger.history[0]!.futureEvent = { source: 'user', value: 2 };
    data.financial_reports = [{ id: 'r1', reportType: 'monthly', title: '自定义🐱', startDate: '2026-09-01', endDate: '2026-09-30', totalAmount: 100,
      changeAmount: 0, changePercentage: 0, channelDetails: [], createdAt: '2026-10-01', isArchived: true,
      reportRendererVersion: 3, integrityStatus: 'needs-review', verificationEvidence: { kind: 'snapshot-reconciliation', facts: 'exact', checkedAt: '2026-10-01', endDate: '2026-09-30' },
      unknownReport: { retained: true } }];
    data.lottery_state = { pool: { id: 'pool', name: 'pool', openingBalance: 0, futurePool: true }, projects: [], transactions: [], settings: { showLotteryAppendix: false, futureSetting: 'yes' }, futureState: 4 };
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.channels[0]).toHaveProperty('futureLabel', { zh: '保留这个字段' });
    expect(parsed.data.history[0]).toHaveProperty('futureEvent', { source: 'user', value: 2 });
    expect(parsed.data.reports[0]).toMatchObject({ title: '自定义🐱', unknownReport: { retained: true }, verificationEvidence: { facts: 'exact' } });
    expect(parsed.data.lottery).toMatchObject({ futureState: 4, pool: { futurePool: true }, settings: { futureSetting: 'yes' } });
  });

  it('拒绝缺少 wealth_tracker_data 的文件', () => {
    const r = parseBackup(JSON.stringify({ version: '1.0.0', appInfo: {}, data: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('wealth_tracker_data');
  });

  it('非法金额拒绝导入，不能静默变成零', () => {
    const r = parseBackup(
      JSON.stringify({
        version: '1.0.0',
        appInfo: { name: 'x', version: '1.0.0' },
        data: { wealth_tracker_data: { channels: [{ id: 'x', amount: 'abc' }], history: [{ date: '2026-01-01', totalAmount: 10 }] } },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('金额');
  });

  it('备份 Schema 独立于应用版本，拒绝未来 Schema', () => {
    const backup = buildBackup(makeSource());
    expect(backup.backupSchemaVersion).toBe(2);
    expect(parseBackup(JSON.stringify({ ...backup, backupSchemaVersion: 3 })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...backup, backupSchemaVersion: undefined, version: '1.6.1' })).ok).toBe(true);
  });

  it('备份总金额使用子渠道汇总，保留空账本和零值', () => {
    const source = makeSource();
    source.channels = [{ id: 'p', name: '父渠道', emoji: '🏦', color: '#000', amount: 999, isParent: true, isExpanded: false,
      children: [{ id: 'c', parentId: 'p', name: '子渠道', emoji: '🌱', color: '#000', amount: 12.34 }] }];
    expect(buildBackup(source).metadata?.totalAmount).toBe(12.34);
    source.channels = [];
    source.history = [];
    const parsed = parseBackup(JSON.stringify(buildBackup(source)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.channels).toEqual([]);
      expect(parsed.data.history).toEqual([]);
    }
  });
});
