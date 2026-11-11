import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import { defaultChannels, defaultCountdownData } from '../../src/constants/defaults';
import { totalAssets } from '../../src/utils/channels';
import { todayString } from '../../src/utils/date';

describe('appStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    useAppStore.setState({
      hydrated: true,
      channels: defaultChannels(),
      history: [],
      reports: [],
      sortRules: [],
      countdown: defaultCountdownData(),
      goalAchieved: { hasAchievedGoal: false },
      dataRevision: 0,
      ledgerIdentity: { schemaVersion: 1, ledgerId: 'test-ledger', createdAt: '2026-01-01T00:00:00.000Z' },
      toasts: [],
      coinRainActive: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addParentChannel 新增父渠道', () => {
    const before = useAppStore.getState().channels.length;
    useAppStore.getState().addParentChannel('测试渠道', '💰', '#000000');
    expect(useAppStore.getState().channels.length).toBe(before + 1);
  });

  it('受保护数据变化推进持久化 revision', () => {
    const before = useAppStore.getState().dataRevision;
    useAppStore.getState().addParentChannel('revision 测试', '💰', '#111111');
    expect(useAppStore.getState().dataRevision).toBe(before + 1);
  });

  it('旧数据根的草稿不会写入当前账本', async () => {
    await expect(useAppStore.getState().saveWorkspaceDraft({
      draftId: 'finance-task:task-1',
      kind: 'finance-task',
      targetId: 'task-1',
      ledgerId: 'other-ledger',
      baseRevision: 1,
      baseEntityRevision: 2,
      baseFingerprint: 'a'.repeat(64),
      payloadVersion: 1,
      updatedAt: '2026-11-07T00:00:00.000Z',
      payload: { title: 'old' },
    })).rejects.toThrow('另一份账本');
  });

  it('setAmount 更新子渠道金额并同步今天的历史点', () => {
    useAppStore.getState().setAmount({ parentId: 'alipay', childId: 'alipay_yue' }, 123.45);
    const s = useAppStore.getState();
    const alipay = s.channels.find((c) => c.id === 'alipay')!;
    expect(alipay.children!.find((c) => c.id === 'alipay_yue')!.amount).toBe(123.45);
    expect(totalAssets(s.channels)).toBe(123.45);

    const today = todayString();
    const todayPoint = s.history.find((h) => h.date === today);
    expect(todayPoint?.totalAmount).toBe(123.45);
    // 新历史快照必须保存完整渠道快照 + 财富等级 + 时间戳
    expect(todayPoint?.channels).toBeDefined();
    expect(todayPoint?.channels![0]!.children![0]!.amount).toBe(123.45);
    expect(todayPoint?.wealthLevel).toBeDefined();
    expect(todayPoint?.timestamp).toBeGreaterThan(0);
  });

  it('addHistoryPoint 同日期返回冲突而非静默覆盖（一天一条）', () => {
    useAppStore.getState().addHistoryPoint('2026-01-01', 100);
    const res = useAppStore.getState().addHistoryPoint('2026-01-01', 200);
    expect(res.conflict).toBe(true);
    const pts = useAppStore.getState().history.filter((h) => h.date === '2026-01-01');
    expect(pts).toHaveLength(1);
    expect(pts[0]!.totalAmount).toBe(100); // 未覆盖
  });

  it('overwriteHistoryPoint 同日期覆盖', () => {
    useAppStore.getState().addHistoryPoint('2026-01-01', 100);
    useAppStore.getState().overwriteHistoryPoint('2026-01-01', 200);
    const pts = useAppStore.getState().history.filter((h) => h.date === '2026-01-01');
    expect(pts).toHaveLength(1);
    expect(pts[0]!.totalAmount).toBe(200);
  });

  it('deleteParentChannel 删除渠道', () => {
    useAppStore.getState().deleteParentChannel('alipay');
    expect(useAppStore.getState().channels.find((c) => c.id === 'alipay')).toBeUndefined();
  });

  it('importData 导入旧版备份并覆盖状态', async () => {
    const legacy = {
      version: '1.0.0',
      exportDate: '2026-10-01T00:00:00.000Z',
      appInfo: { name: '财富成长记', version: '1.0.0' },
      data: {
        wealth_tracker_data: {
          channels: [
            { id: 'custom', name: '自定义', emoji: '🏦', amount: 888, color: '#000', isParent: true, isExpanded: false, children: [] },
          ],
          history: [{ date: '2026-09-01', totalAmount: 888 }],
        },
        financial_reports: [],
        custom_sort_rules: { rules: [] },
        countdown_data: { targetAmount: 8888, targetDate: '2027-01-01', startDate: '2026-01-01' },
        goal_achievement_status: { hasAchievedGoal: false },
        countdown_opacity: 1,
      },
    };

    const res = await useAppStore.getState().importData(JSON.stringify(legacy));
    expect(res.ok).toBe(true);
    const s = useAppStore.getState();
    expect(s.channels).toHaveLength(1);
    expect(s.channels[0]!.name).toBe('自定义');
    expect(s.history[0]!.totalAmount).toBe(888);
    expect(s.countdown.targetAmount).toBe(8888);
  });

  it('importData 拒绝非法备份', async () => {
    const res = await useAppStore.getState().importData('{"foo":1}');
    expect(res.ok).toBe(false);
  });
});
