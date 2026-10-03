import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssetsPanel } from '../../src/features/assets/AssetsPanel';
import { useAppStore } from '../../src/store/appStore';
import { defaultChannels } from '../../src/constants/defaults';

describe('AssetsPanel 冒烟测试', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({
      hydrated: true,
      channels: defaultChannels(),
      history: [{ date: '2026-10-03', totalAmount: 0 }],
      sortRules: [],
      toasts: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('渲染默认渠道与关键操作按钮', () => {
    render(<AssetsPanel />);
    // 默认父渠道应出现
    expect(screen.getByText('支付宝')).toBeInTheDocument();
    expect(screen.getByText('微信')).toBeInTheDocument();
    expect(screen.getByText('华为钱包')).toBeInTheDocument();
    // 添加渠道按钮
    expect(screen.getByText('＋ 添加渠道')).toBeInTheDocument();
  });

  it('展开渠道显示子渠道', () => {
    useAppStore.setState({
      channels: defaultChannels().map((c) => (c.id === 'alipay' ? { ...c, isExpanded: true } : c)),
    });
    render(<AssetsPanel />);
    // 支付宝展开后应显示其子渠道「余额」「余额宝」
    expect(screen.getByText('余额')).toBeInTheDocument();
    expect(screen.getByText('余额宝')).toBeInTheDocument();
  });
});
