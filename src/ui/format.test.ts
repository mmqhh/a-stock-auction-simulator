import { describe, expect, it } from 'vitest';
import { amountOf, fmtAmount } from './format';

describe('金额格式化', () => {
  it('不足 1 万显示元', () => {
    expect(fmtAmount(9876)).toBe('9876');
  });
  it('1 万 ~ 1 千万显示万', () => {
    expect(fmtAmount(719_730)).toBe('72.0万');
    expect(fmtAmount(9_999_000)).toBe('999.9万');
  });
  it('千万级起显示 0.xx亿', () => {
    expect(fmtAmount(17_459_000)).toBe('0.17亿');
    expect(fmtAmount(10_000_000)).toBe('0.10亿');
    expect(fmtAmount(149_000_000)).toBe('1.49亿');
  });
  it('价格（分）× 手数 = 元', () => {
    // 9.90 元 × 1.76 万手 × 100 股
    expect(fmtAmount(amountOf(990, 17_636))).toBe('0.17亿');
  });
});
