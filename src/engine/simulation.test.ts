import { describe, expect, it } from 'vitest';
import { Simulation, type SimConfig } from './simulation';
import { SCENARIOS } from './scenarios';
import { BOARDS, MAX_PREV_CLOSE, MAX_SEED } from './rules';

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
  it('科创板按整数股申报，201 股预演、部分成交和撤单保持准确', () => {
    const sim = new Simulation(cfg({}, { board: 'star' }));
    expect(sim.placeOrder('B', 1000, 100).ok).toBe(false);
    expect(sim.placeOrder('B', 1000, 199).ok).toBe(false);
    expect(sim.placeOrder('B', 1000, 200.5).ok).toBe(false);
    const seller = sim.placeOrder('S', 1000, 202);
    const first = sim.placeOrder('B', 1000, 201);
    if (!seller.ok || !first.ok) throw new Error('下单失败');
    const preview = sim.preview('B', 1000, 201)!;
    expect(preview.fill).toBe(1);
    const second = sim.placeOrder('B', 1000, 201);
    if (!second.ok) throw new Error('下单失败');
    expect(sim.estimatedFills().get(second.value.id)).toBe(1);
    expect(sim.cancelOrder(first.value.id).ok).toBe(true);
    expect(sim.depth.evaluate(1000).buyGE).toBe(201);
    sim.finish();
    expect(second.value.filled).toBe(201);
    expect(seller.value.filled).toBe(201);
    expect(first.value.filled).toBe(0);
  });

  it('主板拒绝非整手和非有限数量，保留合法单笔边界', () => {
    const sim = new Simulation(cfg());
    for (const qty of [1, 99, 101, 201, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(sim.placeOrder('B', 1000, qty).ok).toBe(false);
    for (const qty of [100, 1000000]) expect(sim.placeOrder('B', 1000, qty).ok).toBe(true);
    for (const price of [Infinity, NaN, 1000.1, Number.MAX_SAFE_INTEGER + 1])
      expect(sim.placeOrder('B', price, 100).ok).toBe(false);
  });

  it('引擎构造前拒绝无效价格、种子、快照和板块组合', () => {
    for (const prevClose of [Infinity, NaN, 0, 1.1, MAX_PREV_CLOSE + 1])
      expect(() => new Simulation(cfg({}, { prevClose }))).toThrow(RangeError);
    for (const seed of [Infinity, NaN, -1, 0.1, MAX_SEED + 1])
      expect(() => new Simulation(cfg({ seed }))).toThrow(RangeError);
    for (const snapshotSec of [0, -1, Infinity, NaN, 0.15, 2])
      expect(() => new Simulation(cfg({ snapshotSec }))).toThrow(RangeError);
    expect(() => new Simulation(cfg({ scenarioId: 'missing' }))).toThrow(RangeError);
    expect(() => new Simulation(cfg({}, { board: 'star', rule: 'SZSE' }))).toThrow(RangeError);
    expect(() => new Simulation(cfg({ seed: MAX_SEED }, { prevClose: MAX_PREV_CLOSE }))).not.toThrow();
  });

  it('外部配置变更不破坏已有模拟，控制参数和时间输入也受校验', () => {
    const config = cfg();
    const sim = new Simulation(config);
    config.stock.prevClose = Infinity;
    config.snapshotSec = 0;
    expect(sim.prevClose).toBe(1000);
    expect(sim.snapshotMs).toBe(3000);
    expect(() => sim.setControls({ activity: Infinity })).toThrow(RangeError);
    expect(() => sim.setControls({ sentiment: NaN })).toThrow(RangeError);
    expect(sim.controls.activity).toBe(1);
    expect(() => sim.advance(NaN)).toThrow(RangeError);
    expect(() => sim.jumpTo(Infinity)).toThrow(RangeError);
  });
  it('空白盘：自己下单形成参考价', () => {
    const sim = new Simulation(cfg());
    expect(sim.result.price).toBeNull();
    expect(sim.placeOrder('B', 1010, 10000).ok).toBe(true);
    expect(sim.placeOrder('S', 1000, 6000).ok).toBe(true);
    const r = sim.result;
    expect(r.matched).toBe(6000);
    expect(r.unmatchedSide).toBe('B');
    expect(r.unmatched).toBe(4000);
    expect(r.price).toBe(1010);
  });

  it('价格超出涨跌停、数量越界为无效申报', () => {
    const sim = new Simulation(cfg());
    expect(sim.placeOrder('B', 1101, 100).ok).toBe(false);
    expect(sim.placeOrder('S', 899, 100).ok).toBe(false);
    expect(sim.placeOrder('B', 1100, 0).ok).toBe(false);
    expect(sim.placeOrder('B', 1100, 1000100).ok).toBe(false);
    expect(sim.placeOrder('B', 1100, 1000000).ok).toBe(true);
  });

  it('科创板单笔上限 1000 手', () => {
    const sim = new Simulation(cfg({}, { board: 'star' }));
    expect(sim.placeOrder('B', 1000, 100100).ok).toBe(false);
    expect(sim.placeOrder('B', 1200, 100000).ok).toBe(true); // 20% 涨停 12.00
  });

  it('9:20 前可撤单，9:20 起不可撤单', () => {
    const sim = new Simulation(cfg());
    const a = sim.placeOrder('B', 1000, 1000);
    const b = sim.placeOrder('B', 1000, 1000);
    if (!a.ok || !b.ok) throw new Error('下单失败');
    sim.jumpTo(4 * 60 * 1000 + 59_900); // 9:19:59.9
    expect(sim.phase).toBe('cancelable');
    expect(sim.cancelOrder(a.value.id).ok).toBe(true);
    sim.jumpTo(5 * 60 * 1000); // 9:20:00
    expect(sim.phase).toBe('locked');
    const res = sim.cancelOrder(b.value.id);
    expect(res.ok).toBe(false);
    // 9:20 后仍可下单
    expect(sim.placeOrder('S', 1000, 500).ok).toBe(true);
  });

  it('深交所平局时取最接近昨收的价格', () => {
    const sim = new Simulation(cfg({}, { rule: 'SZSE' }));
    sim.placeOrder('B', 1060, 1000);
    sim.placeOrder('S', 990, 1000);
    expect(sim.result.price).toBe(1000);
  });

  it('竞价结束后按价格时间优先成交，且不再接受申报', () => {
    const sim = new Simulation(cfg());
    const a = sim.placeOrder('B', 1000, 5000);
    const b = sim.placeOrder('B', 1000, 5000);
    sim.placeOrder('S', 990, 7000);
    sim.finish();
    expect(sim.done).toBe(true);
    expect(sim.phase).toBe('done');
    if (!a.ok || !b.ok) throw new Error();
    expect(sim.getOrder(a.value.id)!.filled).toBe(5000);
    expect(sim.getOrder(b.value.id)!.filled).toBe(2000);
    expect(sim.placeOrder('B', 1000, 100).ok).toBe(false);
    expect(sim.finalResult?.price).toBe(1000);
  });

  it('预演结果与真实下单一致', () => {
    const sim = new Simulation(cfg({ scenarioId: 'balanced' }));
    sim.jumpTo(60_000);
    const pv = sim.preview('B', 1030, 80000)!;
    const before = sim.result;
    const res = sim.placeOrder('B', 1030, 80000);
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
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}：活跃度为零时没有初始单或后续脚本单`, () => {
      const sim = new Simulation(cfg({ scenarioId: scenario.id }), { activity: 0, sentiment: 0 });
      sim.finish();
      expect(sim.orders).toHaveLength(0);
      expect(sim.tape).toHaveLength(0);
    });
  }

  it('运行中关闭背景会停止新增和撤单，恢复后不补发过期脚本', () => {
    const sim = new Simulation(cfg({ scenarioId: 'spoof' }));
    sim.setControls({ activity: 0 });
    const before = JSON.stringify(sim.orders);
    const tapeLength = sim.tape.length;
    sim.jumpTo(75000);
    expect(JSON.stringify(sim.orders)).toBe(before);
    expect(sim.tape).toHaveLength(tapeLength);
    sim.setControls({ activity: 1 });
    sim.jumpTo(120000);
    expect(sim.tape.length).toBeGreaterThan(tapeLength);
    expect(sim.orders.some((o) => o.tag === 'spoof')).toBe(false);
  });

  for (const board of Object.values(BOARDS)) {
    it(`${board.name}：所有场景背景申报符合板块数量约束`, () => {
      for (const scenario of SCENARIOS) {
        const sim = new Simulation(cfg({ scenarioId: scenario.id }, { board: board.id, rule: board.exchanges[0] }));
        sim.finish();
        for (const order of sim.orders) {
          expect(Number.isSafeInteger(order.qty)).toBe(true);
          expect(order.qty).toBeGreaterThanOrEqual(board.minQty);
          expect(order.qty).toBeLessThanOrEqual(board.maxQty);
          expect((order.qty - board.minQty) % board.qtyStep).toBe(0);
        }
      }
    });
  }
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

  it('下一笔不影响参考价的单，背景行情（含随机撤单）完全不变', () => {
    const bg = (sim: Simulation) =>
      sim.orders.filter((o) => o.owner === 'mkt').map((o) => `${o.side}${o.price}x${o.qty}${o.cancelled ? `c${o.cancelTime}` : ''}`);
    const a = new Simulation(cfg({ scenarioId: 'spoof', seed: 99 }));
    const b = new Simulation(cfg({ scenarioId: 'spoof', seed: 99 }));
    // 跌停价挂 1 手买单：远低于参考价，不改变撮合结果
    expect(b.placeOrder('B', b.lower, 100).ok).toBe(true);
    a.finish();
    b.finish();
    expect(bg(b)).toEqual(bg(a));
    expect(b.finalResult!.price).toBe(a.finalResult!.price);
  });

  it('有效委托数、我的委托数计数准确', () => {
    const sim = new Simulation(cfg({ scenarioId: 'balanced', seed: 5 }));
    const a = sim.placeOrder('B', 1000, 1000);
    sim.placeOrder('S', 1001, 1000);
    if (!a.ok) throw new Error();
    sim.jumpTo(120_000);
    sim.cancelOrder(a.value.id);
    const live = sim.orders.filter((o) => !o.cancelled).length;
    expect(sim.liveOrderCount).toBe(live);
    expect(sim.myOrderCount).toBe(2);
  });

  it('深度快照不随之后的委托变化', () => {
    const sim = new Simulation(cfg());
    sim.placeOrder('B', 1000, 1000);
    const d = sim.depth;
    const before = JSON.stringify(d.levels);
    sim.placeOrder('B', 1000, 5000);
    expect(JSON.stringify(d.levels)).toBe(before);
    expect(d.evaluate(1000).buyGE).toBe(1000);
    expect(sim.depth.evaluate(1000).buyGE).toBe(6000);
  });

  it('背景活跃度为 0 时不产生新委托', () => {
    const sim = new Simulation(cfg({ scenarioId: 'balanced' }), { activity: 0, sentiment: 0 });
    const n = sim.orders.length;
    sim.jumpTo(120_000);
    expect(sim.orders.length).toBe(n);
  });
});
