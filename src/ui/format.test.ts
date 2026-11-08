import { describe, expect, it } from 'vitest';
import { amountOf, fmtAmount, fmtVol, parsePrice, parseQty } from './format';

describe('数值输入与股数换算', () => {
  it('价格与手数精确转换到整数分、整数股', () => {
    expect(parsePrice('10.10')).toBe(1010);
    expect(parseQty('2.01')).toBe(201);
    expect(parseQty('100')).toBe(10000);
    expect(parseQty('2.')).toBe(200);
    expect(parseQty(' 2.01 ')).toBe(201);
    expect(fmtVol(201)).toBe('2.01');
    expect(fmtVol(1)).toBe('0.01');
    expect(fmtVol(-201)).toBe('-2.01');
    expect(amountOf(1005, 201)).toBe(2020.05);
  });
  it('拒绝非有限数、超出安全整数的数字和多余小数位', () => {
    for (const input of ['', '-1', '0', '1e3', 'Infinity', 'NaN', '1.001', '9'.repeat(310), '9007199254740992']) {
      expect(parsePrice(input)).toBeNull();
      expect(parseQty(input)).toBeNull();
    }
  });
});

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
  it('价格（分）× 股数 ÷ 100 = 元', () => {
    // 9.90 元 × 1.76 万手 × 100 股
    expect(fmtAmount(amountOf(990, 1_763_600))).toBe('0.17亿');
  });
});
