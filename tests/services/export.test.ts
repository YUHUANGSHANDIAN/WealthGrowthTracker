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
    expect(backup.appInfo.name).toBe('财富成长记');

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

  it('拒绝非法 JSON', () => {
    const r = parseBackup('not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
  });

  it('拒绝缺少 wealth_tracker_data 的文件', () => {
    const r = parseBackup(JSON.stringify({ version: '1.0.0', appInfo: {}, data: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('wealth_tracker_data');
  });

  it('字段缺失时回退到安全默认值', () => {
    const r = parseBackup(
      JSON.stringify({
        version: '1.0.0',
        appInfo: { name: 'x', version: '1.0.0' },
        data: { wealth_tracker_data: { channels: [{ id: 'x', amount: 'abc' }], history: [{ date: '2026-01-01', totalAmount: 10 }] } },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // amount 非法 → 0；缺失字段被补齐
    expect(r.data.channels[0]!.amount).toBe(0);
    expect(r.data.channels[0]!.name).toBe('未命名渠道');
  });
});
