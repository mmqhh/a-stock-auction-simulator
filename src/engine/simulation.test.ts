import { describe, expect, it } from 'vitest';
import { Simulation, type SimConfig } from './simulation';
import { SCENARIOS } from './scenarios';

function cfg(over: Partial<SimConfig> = {}, stock: Partial<SimConfig['stock']> = {}): SimConfig {
  return {
    scenarioId: 'empty',
    seed: 42,
    snapshotSec: 3,
    ...over,
    stock: { code: 'SIM001', name: '模拟股份', prevClose: 1000, board: 'main', rule: 'SSE', ...stock },
  };
}

describe('Simulation 基本行为', () => {
  it('空白盘：自己下单形成参考价', () => {
    const sim = new Simulation(cfg());
    expect(sim.result.price).toBeNull();
    expect(sim.placeOrder('B', 1010, 100).ok).toBe(true);
    expect(sim.placeOrder('S', 1000, 60).ok).toBe(true);
    const r = sim.result;
    expect(r.matched).toBe(60);
    expect(r.unmatchedSide).toBe('B');
    expect(r.unmatched).toBe(40);
    expect(r.price).toBe(1010);
  });

  it('价格超出涨跌停、数量越界为无效申报', () => {
    const sim = new Simulation(cfg());
    expect(sim.placeOrder('B', 1101, 1).ok).toBe(false);
    expect(sim.placeOrder('S', 899, 1).ok).toBe(false);
    expect(sim.placeOrder('B', 1100, 0).ok).toBe(false);
    expect(sim.placeOrder('B', 1100, 10001).ok).toBe(false);
    expect(sim.placeOrder('B', 1100, 10000).ok).toBe(true);
  });

  it('科创板单笔上限 1000 手', () => {
    const sim = new Simulation(cfg({}, { board: 'star' }));
    expect(sim.placeOrder('B', 1000, 1001).ok).toBe(false);
    expect(sim.placeOrder('B', 1200, 1000).ok).toBe(true); // 20% 涨停 12.00
  });

  it('9:20 前可撤单，9:20 起不可撤单', () => {
    const sim = new Simulation(cfg());
    const a = sim.placeOrder('B', 1000, 10);
    const b = sim.placeOrder('B', 1000, 10);
    if (!a.ok || !b.ok) throw new Error('下单失败');
    sim.jumpTo(4 * 60 * 1000 + 59_900); // 9:19:59.9
    expect(sim.phase).toBe('cancelable');
    expect(sim.cancelOrder(a.value.id).ok).toBe(true);
    sim.jumpTo(5 * 60 * 1000); // 9:20:00
    expect(sim.phase).toBe('locked');
    const res = sim.cancelOrder(b.value.id);
    expect(res.ok).toBe(false);
    // 9:20 后仍可下单
    expect(sim.placeOrder('S', 1000, 5).ok).toBe(true);
  });

  it('深交所平局时取最接近昨收的价格', () => {
    const sim = new Simulation(cfg({}, { rule: 'SZSE' }));
    sim.placeOrder('B', 1060, 10);
    sim.placeOrder('S', 990, 10);
    expect(sim.result.price).toBe(1000);
  });

  it('竞价结束后按价格时间优先成交，且不再接受申报', () => {
    const sim = new Simulation(cfg());
    const a = sim.placeOrder('B', 1000, 50);
    const b = sim.placeOrder('B', 1000, 50);
    sim.placeOrder('S', 990, 70);
    sim.finish();
    expect(sim.done).toBe(true);
    expect(sim.phase).toBe('done');
    if (!a.ok || !b.ok) throw new Error();
    expect(sim.getOrder(a.value.id)!.filled).toBe(50);
    expect(sim.getOrder(b.value.id)!.filled).toBe(20);
    expect(sim.placeOrder('B', 1000, 1).ok).toBe(false);
    expect(sim.finalResult?.price).toBe(1000);
  });

  it('预演结果与真实下单一致', () => {
    const sim = new Simulation(cfg({ scenarioId: 'balanced' }));
    sim.jumpTo(60_000);
    const pv = sim.preview('B', 1030, 800)!;
    const before = sim.result;
    const res = sim.placeOrder('B', 1030, 800);
    expect(res.ok).toBe(true);
    expect(sim.result.price).toBe(pv.result.price);
    expect(sim.result.matched).toBe(pv.result.matched);
    expect(sim.result.unmatched).toBe(pv.result.unmatched);
    if (res.ok) expect(sim.estimatedFills().get(res.value.id) ?? 0).toBe(pv.fill);
    const act = sim.myActions[sim.myActions.length - 1];
    expect(act.before).toEqual(before);
    expect(act.after.matched).toBe(pv.result.matched);
  });

  it('快照按间隔记录，最后一个快照在 9:25:00', () => {
    const sim = new Simulation(cfg({ scenarioId: 'balanced' }));
    sim.finish();
    expect(sim.snapshots[0].t).toBe(0);
    expect(sim.snapshots[1].t).toBe(3000);
    expect(sim.snapshots[sim.snapshots.length - 1].t).toBe(600_000);
    expect(sim.snapshots.length).toBe(201);
  });

  it('相同种子结果可复现', () => {
    const a = new Simulation(cfg({ scenarioId: 'bull', seed: 7 }));
    const b = new Simulation(cfg({ scenarioId: 'bull', seed: 7 }));
    a.finish();
    b.finish();
    expect(a.finalResult).toEqual(b.finalResult);
  });
});

describe('场景', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name} 可完整运行且结果自洽`, () => {
      const sim = new Simulation(cfg({ scenarioId: sc.id }));
      sim.finish();
      const r = sim.finalResult!;
      let fb = 0;
      let fs = 0;
      for (const o of sim.orders) {
        expect(o.price).toBeGreaterThanOrEqual(sim.lower);
        expect(o.price).toBeLessThanOrEqual(sim.upper);
        if (o.side === 'B') fb += o.filled;
        else fs += o.filled;
      }
      expect(fb).toBe(r.matched);
      expect(fs).toBe(r.matched);
    });
  }

  it('一字涨停场景：参考价锁定涨停，买方大量未匹配', () => {
    const sim = new Simulation(cfg({ scenarioId: 'limitup' }));
    sim.finish();
    expect(sim.finalResult!.price).toBe(sim.upper);
    expect(sim.finalResult!.unmatchedSide).toBe('B');
    expect(sim.finalResult!.unmatched).toBeGreaterThan(sim.finalResult!.matched);
  });

  it('诱多场景：诱单在 9:20 前全部撤销', () => {
    const sim = new Simulation(cfg({ scenarioId: 'spoof' }));
    sim.finish();
    const spoofs = sim.orders.filter((o) => o.tag === 'spoof');
    expect(spoofs.length).toBe(6);
    for (const o of spoofs) {
      expect(o.cancelled).toBe(true);
      expect(o.cancelTime!).toBeLessThan(5 * 60 * 1000);
    }
  });

  it('背景活跃度为 0 时不产生新委托', () => {
    const sim = new Simulation(cfg({ scenarioId: 'balanced' }), { activity: 0, sentiment: 0 });
    const n = sim.orders.length;
    sim.jumpTo(120_000);
    expect(sim.orders.length).toBe(n);
  });
});
