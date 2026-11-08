import { describe, expect, it } from 'vitest';
import { Simulation } from '../engine/simulation';
import { buildAuctionData } from './auctionChartData';

function simulation(snapshotSec = 3) {
  return new Simulation({ scenarioId: 'empty', seed: 1, snapshotSec, stock: {
    code: 'SIM001', name: '模拟股份', prevClose: 1000, board: 'star', rule: 'SSE',
  } });
}

describe('竞价图数据与盘口同步', () => {
  for (const snapshotSec of [1, 3]) {
    for (const time of [0, snapshotSec * 1000]) {
      it(`${snapshotSec} 秒快照，暂停在 ${time}ms 下单及撤单均即时反映`, () => {
        const sim = simulation(snapshotSec);
        sim.jumpTo(time);
        const history = JSON.stringify(sim.snapshots);
        sim.placeOrder('B', 1010, 201);
        const sell = sim.placeOrder('S', 1000, 201);
        if (!sell.ok) throw new Error('申报失败');
        const stock = buildAuctionData(sim, 20261108).stock[0];
        expect(stock.before.at(-1)?.slice(1, 5)).toEqual([10.05, 201, 0, 0]);
        expect(stock.price).toBe(10.05);
        expect(JSON.stringify(sim.snapshots)).toBe(history);
        sim.cancelOrder(sell.value.id);
        expect(buildAuctionData(sim).stock[0].before.at(-1)?.slice(1, 5)).toEqual([null, 0, 0, 0]);
      });
    }
  }

  it('快照之间的实时点不会堆积，最后一笔成交以正确股数输出', () => {
    const sim = simulation();
    sim.advance(100);
    sim.placeOrder('B', 1000, 202);
    sim.placeOrder('S', 1000, 201);
    const first = buildAuctionData(sim).stock[0].before;
    expect(first).toHaveLength(2);
    expect(first[1].slice(0, 5)).toEqual([91503, 10, 201, 1, 1]);
    expect(first[1][5]).toBeGreaterThanOrEqual(202);
    sim.jumpTo(3000);
    expect(buildAuctionData(sim).stock[0].before).toHaveLength(2);
    sim.jumpTo(599900);
    expect(buildAuctionData(sim).stock[0].before.at(-1)?.[0]).toBe(92500);
    sim.finish();
    const final = buildAuctionData(sim).stock[0].before;
    expect(final).toHaveLength(201);
    expect(final.at(-1)?.slice(0, 5)).toEqual([92500, 10, 201, 1, 1]);
  });
});
