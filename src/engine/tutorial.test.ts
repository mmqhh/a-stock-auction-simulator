import { expect, it } from 'vitest';
import { Simulation } from './simulation';

/** 讲解集合竞价原理用的 4 步示例（空白盘、上交所、昨收 10.00） */
it('教程示例', () => {
  const sim = new Simulation({
    scenarioId: 'empty',
    seed: 1,
    snapshotSec: 3,
    stock: { code: 'SIM001', name: '模拟股份', prevClose: 1000, board: 'main', rule: 'SSE' },
  });
  const show = (label: string) => {
    const r = sim.result;
    const fills = sim.estimatedFills();
    const f = sim.orders.map((o) => `${o.side}${o.price / 100}x${o.qty}→${fills.get(o.id) ?? 0}`).join(' ');
    console.log(label, '价', r.price, '匹配', r.matched, '未匹配', r.unmatchedSide, r.unmatched, '买一', JSON.stringify(r.bestBid), '|', f);
  };
  sim.placeOrder('B', 1010, 30000);
  show('1');
  expect(sim.result.price).toBeNull();
  sim.placeOrder('S', 990, 10000);
  show('2');
  expect(sim.result.price).toBe(1010);
  expect(sim.result.unmatched).toBe(20000);
  sim.placeOrder('S', 1000, 30000);
  show('3');
  expect(sim.result.price).toBe(1000);
  expect(sim.result.unmatchedSide).toBe('S');
  sim.placeOrder('B', 1000, 10000);
  show('4');
  expect(sim.result.matched).toBe(40000);
  expect(sim.result.unmatched).toBe(0);
});
