import type {
  Channel,
  ChartSettings,
  CoinRainConfig,
  CountdownData,
  CustomSortRule,
  HistoryPoint,
} from '../types';
import { CHANNEL_COLORS } from './levels';
import { todayString } from '../utils/date';

/** 默认父渠道（与旧版保持一致，但不做任何硬编码限制，用户可自由增删改）。 */
export function defaultChannels(): Channel[] {
  const now = new Date().toISOString();
  const child = (id: string, name: string, emoji: string, color: string, parentId: string) => ({
    id,
    name,
    emoji,
    amount: 0,
    color,
    parentId,
  });
  return [
    {
      id: 'alipay',
      name: '支付宝',
      emoji: '💙',
      amount: 0,
      color: CHANNEL_COLORS.blue,
      isParent: true,
      isExpanded: false,
      createdAt: now,
      updatedAt: now,
      children: [
        child('alipay_yue', '余额', '💰', '#10B981', 'alipay'),
        child('alipay_yuebao', '余额宝', '💎', '#F59E0B', 'alipay'),
        child('alipay_fund', '基金', '📊', '#3B82F6', 'alipay'),
        child('alipay_fixed', '定期', '🔒', '#8B5CF6', 'alipay'),
        child('alipay_gold', '银行黄金', '🏦', '#D97706', 'alipay'),
        child('alipay_securities', '券商理财', '📈', '#06B6D4', 'alipay'),
      ],
    },
    {
      id: 'wechat',
      name: '微信',
      emoji: '💚',
      amount: 0,
      color: CHANNEL_COLORS.green,
      isParent: true,
      isExpanded: false,
      createdAt: now,
      updatedAt: now,
      children: [
        child('wechat_change', '零钱通', '💰', '#10B981', 'wechat'),
        child('wechat_finance', '理财通', '🏦', '#8B5CF6', 'wechat'),
      ],
    },
    {
      id: 'huawei',
      name: '华为钱包',
      emoji: '🔶',
      amount: 0,
      color: CHANNEL_COLORS.orange,
      isParent: true,
      isExpanded: false,
      createdAt: now,
      updatedAt: now,
      children: [
        child('huawei_wallet', '钱包', '👛', '#06B6D4', 'huawei'),
        child('huawei_transport', '交通卡', '🎫', '#F59E0B', 'huawei'),
      ],
    },
    {
      id: 'campus_card',
      name: '校园卡',
      emoji: '🎓',
      amount: 0,
      color: CHANNEL_COLORS.cyan,
      isParent: true,
      isExpanded: false,
      createdAt: now,
      updatedAt: now,
      children: [
        child('campus_card_dlut', '大连理工大学', '🎓', '#06B6D4', 'campus_card'),
        child('campus_card_tju', '天津大学', '🏫', '#0EA5E9', 'campus_card'),
        child('campus_card_fudan', '复旦大学', '📚', '#6366F1', 'campus_card'),
      ],
    },
    {
      id: 'bank_cards',
      name: '银行卡',
      emoji: '🏛️',
      amount: 0,
      color: CHANNEL_COLORS.purple,
      isParent: true,
      isExpanded: false,
      createdAt: now,
      updatedAt: now,
      children: [
        child('bank_card_account', '银行账户', '🏦', '#7C3AED', 'bank_cards'),
      ],
    },
    {
      id: 'jd_finance',
      name: '京东金融',
      emoji: '💼',
      amount: 0,
      color: '#F43F5E',
      isParent: true,
      isExpanded: false,
      createdAt: now,
      updatedAt: now,
      children: [
        child('jd_jinku', '京东小金库', '🪙', '#F59E0B', 'jd_finance'),
        child('jd_fund', '基金', '📊', '#3B82F6', 'jd_finance'),
        child('jd_stock', '股票', '📈', '#06B6D4', 'jd_finance'),
        child('jd_gold', '黄金', '🥇', '#D97706', 'jd_finance'),
        child('jd_huoqian', '京东活钱+', '💵', '#10B981', 'jd_finance'),
      ],
    },
  ];
}

export function defaultHistory(): HistoryPoint[] {
  return [{ date: todayString(), totalAmount: 0 }];
}

export function defaultCountdownData(): CountdownData {
  const today = todayString();
  return { targetAmount: 1_000_000, targetDate: today, startDate: today };
}

export function defaultCoinRainConfig(): CoinRainConfig {
  return {
    intensity: 'medium',
    windStrength: 0.5,
    bounceFactor: 0.6,
    autoCollect: true,
    autoCollectDelay: 4000,
  };
}

export function defaultChartSettings(): ChartSettings {
  return {
    showHistoricalData: true,
    chartTimeRangeStart: undefined,
    enableCustomAxisColor: false,
    chartColors: { line: '#06b6d4', axis: '#94a3b8', fill: 'rgba(6,182,212,0.12)' },
  };
}

/** 默认/系统自定义排序规则（与旧版一致）。 */
export function defaultSortRules(): CustomSortRule[] {
  const now = new Date().toISOString();
  const defs: Omit<CustomSortRule, 'id' | 'isSystem' | 'createdAt'>[] = [
    {
      key: 'amount-desc',
      label: '金额从高到低',
      description: '从高到低按金额排序',
      field: 'amount',
      direction: 'desc',
      category: '金额',
      tags: ['金额', '高低'],
    },
    {
      key: 'amount-asc',
      label: '金额从低到高',
      description: '从低到高按金额排序',
      field: 'amount',
      direction: 'asc',
      category: '金额',
      tags: ['金额', '低高'],
    },
    {
      key: 'name-asc',
      label: '按名称升序',
      description: '按渠道名称字母顺序排序',
      field: 'name',
      direction: 'asc',
      category: '其他',
      tags: ['名称', '字母'],
    },
    {
      key: 'name-desc',
      label: '按名称降序',
      description: '按渠道名称逆序排序',
      field: 'name',
      direction: 'desc',
      category: '其他',
      tags: ['名称', '字母'],
    },
    {
      key: 'growth-desc',
      label: '增长率从高到低',
      description: '按增长率排序',
      field: 'growth',
      direction: 'desc',
      category: '增长',
      tags: ['增长', '比例'],
    },
    {
      key: 'percentage-desc',
      label: '占比从高到低',
      description: '按占比排序',
      field: 'percentage',
      direction: 'desc',
      category: '占比',
      tags: ['占比', '比例'],
    },
    {
      key: 'children-desc',
      label: '子渠道数量',
      description: '按子渠道数量排序',
      field: 'children',
      direction: 'desc',
      category: '结构',
      tags: ['子渠道', '数量'],
    },
    {
      key: 'updatedAt-desc',
      label: '最近更新',
      description: '按更新时间排序',
      field: 'updatedAt',
      direction: 'desc',
      category: '时间',
      tags: ['更新时间'],
    },
  ];
  return defs.map((d, i) => ({
    ...d,
    id: `system_${i + 1}`,
    isSystem: true,
    createdAt: now,
  }));
}
