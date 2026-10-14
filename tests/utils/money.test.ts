import { describe, it, expect } from 'vitest';
import {
  round2,
  sumMoney,
  diffMoney,
  growthRate,
  percentage,
  formatAmount,
  formatCNY,
  parseMoney,
} from '../../src/utils/money';

describe('money 工具', () => {
  it('round2 舍入到两位小数（分）', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.345)).toBe(2.35);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(10.075)).toBe(10.08);
    expect(round2(-0.001)).toBe(0);
  });

  it('sumMoney 累加并避免浮点误差', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([1.1, 2.2, 3.3])).toBe(6.6);
    expect(sumMoney([])).toBe(0);
    expect(() => sumMoney([NaN, 1, 2])).toThrow('有限');
    expect(() => round2(Infinity)).toThrow('有限');
    expect(sumMoney([90_000_000_000, 0.01, -90_000_000_000])).toBe(0.01);
  });

  it('diffMoney 求差避免浮点尾巴', () => {
    expect(diffMoney(1.03, 1.0)).toBe(0.03);
    expect(diffMoney(10.075, 10)).toBe(0.08);
  });

  it('growthRate 处理分母为 0', () => {
    expect(growthRate(200, 100)).toBe(1);
    expect(growthRate(100, 0)).toBe(0);
    expect(growthRate(0, 0)).toBe(0);
  });

  it('percentage 返回百分数值', () => {
    expect(percentage(150, 100)).toBe(50);
    expect(percentage(100, 100)).toBe(0);
  });

  it('formatAmount / formatCNY 格式化', () => {
    expect(formatAmount(12345.678)).toBe('12,345.68');
    expect(formatCNY(12345.678)).toBe('¥12,345.68');
    expect(formatAmount(NaN)).toBe('—');
    expect(formatCNY(Infinity)).toBe('—');
  });

  it('parseMoney 解析并拒绝非法输入', () => {
    expect(parseMoney('1234.56')).toBe(1234.56);
    expect(parseMoney('¥1,234.56')).toBe(1234.56);
    expect(parseMoney('  ')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(parseMoney('0x10')).toBeNull();
    expect(parseMoney('1e3')).toBeNull();
    expect(parseMoney('1,2')).toBeNull();
    expect(parseMoney('1 2')).toBeNull();
    expect(parseMoney('￥1，234.56')).toBe(1234.56);
    expect(parseMoney('.50')).toBe(0.5);
  });
});
