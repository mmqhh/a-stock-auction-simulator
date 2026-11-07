import { describe, expect, it } from 'vitest';
import { allocate, buildLevels, computeAuction, DepthIndex } from './auction';
import { limitPrices } from './rules';
import type { Order, Side } from './types';

let seq = 0;
function ord(side: Side, yuan: number, qty: number, owner: 'me' | 'mkt' = 'mkt'): Order {
  seq++;
  return {
    id: seq,
    seq,
    side,
    price: Math.round(yuan * 100),
    qty,
    time: seq,
    owner,
    tag: 'normal',
    cancelled: false,
    filled: 0,
  };
}

const SSE = { rule: 'SSE' as const, refPrice: 1000 };
const SZSE = { rule: 'SZSE' as const, refPrice: 1000 };

describe('涨跌停价计算', () => {
  it('主板 10%', () => {
    expect(limitPrices(1000, 10)).toEqual({ upper: 1100, lower: 900 });
    // 12.34 × 1.1 = 13.574 → 13.57；12.34 × 0.9 = 11.106 → 11.11
    expect(limitPrices(1234, 10)).toEqual({ upper: 1357, lower: 1111 });
  });
  it('5% 四舍五入', () => {
    // 3.33 × 1.05 = 3.4965 → 3.50；3.33 × 0.95 = 3.1635 → 3.16
    expect(limitPrices(333, 5)).toEqual({ upper: 350, lower: 316 });
  });
  it('20%', () => {
    expect(limitPrices(1555, 20)).toEqual({ upper: 1866, lower: 1244 });
  });
});

describe('DepthIndex 累计量', () => {
  const idx = new DepthIndex(buildLevels([ord('B', 10.1, 50), ord('B', 10.0, 100), ord('S', 9.9, 80), ord('S', 10.05, 100)]));
  it('任意价位累计', () => {
    const e = idx.evaluate(1000);
    expect(e.buyGE).toBe(150);
    expect(e.buyGT).toBe(50);
    expect(e.sellLE).toBe(80);
    expect(e.sellLT).toBe(80);
    expect(e.volume).toBe(80);
    expect(e.feasible).toBe(true);
  });
  it('非申报价位', () => {
    const e = idx.evaluate(995);
    expect(e.buyGE).toBe(150);
    expect(e.buyGT).toBe(150);
    expect(e.feasible).toBe(false); // 高于 9.95 的买单 150 > 成交量 80
  });
});

describe('集合竞价定价', () => {
  it('不交叉时无参考价，显示最优买卖', () => {
    const r = computeAuction(buildLevels([ord('B', 9.9, 10), ord('B', 9.8, 5), ord('S', 10.1, 20)]), SSE);
    expect(r.price).toBeNull();
    expect(r.matched).toBe(0);
    expect(r.bestBid).toEqual({ price: 990, qty: 10 });
    expect(r.bestAsk).toEqual({ price: 1010, qty: 20 });
  });

  it('单边委托无参考价', () => {
    const r = computeAuction(buildLevels([ord('B', 10, 10)]), SZSE);
    expect(r.price).toBeNull();
    expect(r.bestAsk).toBeNull();
  });

  it('最大成交量 + 高于成交价买单/低于成交价卖单全部成交', () => {
    // 9.90~10.00 成交量都是 80，但只有 10.00 满足原则二
    const r = computeAuction(buildLevels([ord('B', 10.1, 50), ord('B', 10.0, 100), ord('S', 9.9, 80), ord('S', 10.05, 100)]), SSE);
    expect(r.price).toBe(1000);
    expect(r.matched).toBe(80);
    expect(r.unmatched).toBe(70);
    expect(r.unmatchedSide).toBe('B');
    expect(r.basis?.step).toBe('unique');
  });

  it('多个价格满足时取未成交量最小', () => {
    const levels = buildLevels([ord('B', 10.02, 100), ord('B', 10.0, 50), ord('S', 9.98, 100), ord('S', 10.01, 60)]);
    for (const params of [SSE, SZSE]) {
      const r = computeAuction(levels, params);
      expect(r.price).toBe(1000);
      expect(r.matched).toBe(100);
      expect(r.unmatched).toBe(50);
      expect(r.unmatchedSide).toBe('B');
    }
  });

  it('未成交量仍相同：上交所取中间价（四舍五入到分）', () => {
    const levels = buildLevels([ord('B', 10.05, 100), ord('S', 10.0, 100)]);
    const r = computeAuction(levels, SSE);
    expect(r.price).toBe(1003); // (10.00 + 10.05) / 2 = 10.025 → 10.03
    expect(r.matched).toBe(100);
    expect(r.unmatched).toBe(0);
    expect(r.basis?.step).toBe('midpoint');
  });

  it('未成交量仍相同：深交所取最接近前收盘价', () => {
    const levels = buildLevels([ord('B', 10.05, 100), ord('S', 10.0, 100)]);
    expect(computeAuction(levels, { rule: 'SZSE', refPrice: 1002 }).price).toBe(1002);
    expect(computeAuction(levels, { rule: 'SZSE', refPrice: 950 }).price).toBe(1000);
    expect(computeAuction(levels, { rule: 'SZSE', refPrice: 1100 }).price).toBe(1005);
    const r = computeAuction(levels, { rule: 'SZSE', refPrice: 1002 });
    expect(r.basis?.step).toBe('nearestRef');
  });

  it('一方全部成交：卖方剩余', () => {
    const r = computeAuction(buildLevels([ord('B', 10.0, 30), ord('S', 10.0, 100), ord('S', 9.95, 20)]), SSE);
    expect(r.price).toBe(1000);
    expect(r.matched).toBe(30);
    // ≤10.00 的卖单共 120 手，成交 30 手（9.95 的 20 手价格优先先成交），剩余 90 手都在 10.00
    expect(r.unmatched).toBe(90);
    expect(r.unmatchedSide).toBe('S');
  });

  it('涨停封单：大量买单挂涨停价', () => {
    const r = computeAuction(buildLevels([ord('B', 11.0, 5000), ord('S', 10.8, 300), ord('S', 11.0, 200)]), SSE);
    expect(r.price).toBe(1100);
    expect(r.matched).toBe(500);
    expect(r.unmatched).toBe(4500);
    expect(r.unmatchedSide).toBe('B');
  });

  it('已撤单不参与撮合', () => {
    const o = ord('B', 10.5, 1000);
    o.cancelled = true;
    const r = computeAuction(buildLevels([o, ord('B', 10.0, 10), ord('S', 10.0, 10)]), SSE);
    expect(r.price).toBe(1000);
    expect(r.matched).toBe(10);
  });

  it('随机委托簿：结果始终满足三原则且成交量最大', () => {
    let s = 12345;
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 300; round++) {
      const orders: Order[] = [];
      const n = 2 + Math.floor(rand() * 40);
      for (let i = 0; i < n; i++) orders.push(ord(rand() < 0.5 ? 'B' : 'S', 9.8 + Math.floor(rand() * 41) / 100, 1 + Math.floor(rand() * 50)));
      const levels = buildLevels(orders);
      const idx = new DepthIndex(levels);
      for (const params of [SSE, SZSE]) {
        const r = computeAuction(idx, params);
        // 暴力求最大成交量
        let best = 0;
        for (let p = 900; p <= 1100; p++) best = Math.max(best, idx.evaluate(p).volume);
        if (best === 0) {
          expect(r.price).toBeNull();
          continue;
        }
        expect(r.price).not.toBeNull();
        expect(r.matched).toBe(best);
        const e = idx.evaluate(r.price!);
        if (params.rule === 'SZSE' || r.basis?.step !== 'midpoint') {
          expect(e.buyGT).toBeLessThanOrEqual(r.matched);
          expect(e.sellLT).toBeLessThanOrEqual(r.matched);
          expect(e.buyGE === r.matched || e.sellLE === r.matched).toBe(true);
        }
        // 未匹配量 = 参考价上一侧的剩余
        expect(r.unmatched).toBe(Math.max(e.buyGE, e.sellLE) - r.matched);
        // 成交分配总量双边一致
        const fills = allocate(orders, r.price, r.matched);
        let fb = 0;
        let fs = 0;
        for (const o of orders) {
          const f = fills.get(o.id) ?? 0;
          if (o.side === 'B') fb += f;
          else fs += f;
        }
        expect(fb).toBe(r.matched);
        expect(fs).toBe(r.matched);
      }
    }
  });
});

describe('成交分配：价格优先、时间优先', () => {
  it('同价位按时间先后成交', () => {
    const a = ord('B', 10.0, 50);
    const b = ord('B', 10.0, 50);
    const c = ord('B', 10.1, 20);
    const s = ord('S', 9.9, 90);
    const orders = [a, b, c, s];
    const r = computeAuction(buildLevels(orders), SSE);
    expect(r.price).toBe(1000);
    expect(r.matched).toBe(90);
    const fills = allocate(orders, r.price, r.matched);
    expect(fills.get(c.id)).toBe(20); // 价格优先
    expect(fills.get(a.id)).toBe(50); // 时间优先
    expect(fills.get(b.id)).toBe(20); // 部分成交
    expect(fills.get(s.id)).toBe(90);
  });

  it('价格不满足的委托不成交', () => {
    const lowBid = ord('B', 9.5, 100);
    const orders = [ord('B', 10.0, 10), lowBid, ord('S', 10.0, 10)];
    const fills = allocate(orders, 1000, 10);
    expect(fills.has(lowBid.id)).toBe(false);
  });
});
