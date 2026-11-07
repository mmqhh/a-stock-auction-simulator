import { allocate, computeAuction, DepthIndex, type AuctionParams } from './auction';
import { Rng } from './rng';
import { BOARDS, limitPrices, TIMING, type Board, type BoardInfo, type SessionTiming } from './rules';
import { getScenario, type Scenario, type ScenarioContext } from './scenarios';
import type { AuctionResult, ExchangeRule, Order, OrderTag, Owner, PriceLevel, Side } from './types';

export interface StockConfig {
  code: string;
  name: string;
  /** 前收盘价（分） */
  prevClose: number;
  board: Board;
  rule: ExchangeRule;
}

/** 模拟配置（只模拟开盘集合竞价 9:15–9:25） */
export interface SimConfig {
  stock: StockConfig;
  scenarioId: string;
  seed: number;
  /** 行情快照间隔（秒），交易所 Level-1 快照一般为 3 秒 */
  snapshotSec: number;
}

/** 运行中可实时调节的背景市场参数 */
export interface LiveControls {
  /** 背景委托活跃度倍数，0 = 关闭背景委托 */
  activity: number;
  /** 额外多空倾向 [-1, 1] */
  sentiment: number;
}

export interface Snapshot {
  t: number;
  price: number | null;
  matched: number;
  unmatched: number;
  unmatchedSide: Side | null;
}

export interface TapeEvent {
  t: number;
  kind: 'new' | 'cancel';
  orderId: number;
  side: Side;
  price: number;
  qty: number;
  owner: Owner;
  tag: OrderTag;
}

/** 用户的一次操作，以及操作前后的竞价状态（用于分析影响） */
export interface MyAction {
  t: number;
  kind: 'new' | 'cancel';
  orderId: number;
  side: Side;
  price: number;
  qty: number;
  before: AuctionResult;
  after: AuctionResult;
}

export type Phase = 'cancelable' | 'locked' | 'done';

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; error: string };

export interface PreviewResult {
  result: AuctionResult;
  /** 若此刻竞价结束，这笔委托预计成交手数 */
  fill: number;
  /** 加入这笔委托后的深度 */
  depth: DepthIndex;
}

const STEP_MS = 100;

export const DEFAULT_CONTROLS: LiveControls = { activity: 1, sentiment: 0 };

export class Simulation {
  readonly config: SimConfig;
  readonly timing: SessionTiming;
  readonly board: BoardInfo;
  readonly upper: number;
  readonly lower: number;
  /** 场景锚定价：前收盘价 */
  readonly anchor: number;
  readonly scenario: Scenario;
  controls: LiveControls;

  /** 当前模拟时间（距竞价开始毫秒） */
  t = 0;
  done = false;
  /** 每次委托簿变化 +1，用于缓存 */
  version = 0;

  readonly orders: Order[] = [];
  readonly snapshots: Snapshot[] = [];
  readonly tape: TapeEvent[] = [];
  readonly myActions: MyAction[] = [];
  finalResult: AuctionResult | null = null;

  private readonly byId = new Map<number, Order>();
  private readonly levelMap = new Map<number, PriceLevel>();
  private scheduled: { t: number; fn: () => void }[] = [];
  private readonly rng: Rng;
  private rw = 0;
  private pendingMs = 0;
  private nextId = 1;
  private nextSeq = 1;
  private liveMkt = 0;
  private cache: { version: number; idx: DepthIndex; result: AuctionResult } | null = null;
  private fillCache: { version: number; fills: Map<number, number> } | null = null;

  constructor(config: SimConfig, controls: LiveControls = DEFAULT_CONTROLS) {
    this.config = config;
    this.controls = { ...controls };
    this.timing = TIMING;
    this.board = BOARDS[config.stock.board];
    const lim = limitPrices(config.stock.prevClose, this.board.limitPct);
    this.upper = lim.upper;
    this.lower = lim.lower;
    this.anchor = config.stock.prevClose;
    this.scenario = getScenario(config.scenarioId);
    this.rng = new Rng(config.seed);

    const ctx: ScenarioContext = {
      rng: this.rng,
      anchor: this.anchor,
      upper: this.upper,
      lower: this.lower,
      maxQty: this.board.maxQty,
      duration: this.timing.duration,
      cancelDeadline: this.timing.cancelDeadline,
      place: (side, price, qty, tag) => {
        const o = this.insert(side, this.clampPrice(price), Math.min(this.board.maxQty, Math.max(1, qty)), 'mkt', tag);
        return o.id;
      },
      schedule: (t, fn) => this.schedule(t, fn),
      cancel: (id) => {
        if (this.canCancel) this.remove(id);
      },
    };
    this.scenario.setup?.(ctx);
    for (let i = 0; i < this.scenario.burst; i++) this.genOrder(0);
    this.runScheduled(0);
    this.recordSnapshot();
  }

  // ───────────────────────── 状态读取 ─────────────────────────

  get snapshotMs(): number {
    return Math.max(1, Math.round(this.config.snapshotSec * 1000));
  }

  get phase(): Phase {
    if (this.done) return 'done';
    return this.t < this.timing.cancelDeadline ? 'cancelable' : 'locked';
  }

  get canCancel(): boolean {
    return !this.done && this.t < this.timing.cancelDeadline;
  }

  get params(): AuctionParams {
    return {
      rule: this.config.stock.rule,
      refPrice: this.config.stock.prevClose,
    };
  }

  /** 开盘竞价涨跌以前收盘为基准 */
  get prevClose(): number {
    return this.config.stock.prevClose;
  }

  get depth(): DepthIndex {
    return this.ensureCache().idx;
  }

  /** 当前（虚拟）撮合结果；竞价结束后为最终结果 */
  get result(): AuctionResult {
    if (this.finalResult) return this.finalResult;
    return this.ensureCache().result;
  }

  get liveOrderCount(): number {
    let n = 0;
    for (const o of this.orders) if (!o.cancelled) n++;
    return n;
  }

  getOrder(id: number): Order | undefined {
    return this.byId.get(id);
  }

  /** 若此刻竞价结束，各委托的预计成交（结束后即为实际成交） */
  estimatedFills(): Map<number, number> {
    if (this.fillCache && this.fillCache.version === this.version) return this.fillCache.fills;
    const r = this.result;
    const fills = allocate(this.orders, r.price, r.matched);
    this.fillCache = { version: this.version, fills };
    return fills;
  }

  private ensureCache() {
    if (this.cache && this.cache.version === this.version) return this.cache;
    const levels = [...this.levelMap.values()].filter((l) => l.buy > 0 || l.sell > 0).sort((a, b) => a.price - b.price);
    const idx = new DepthIndex(levels);
    const result = computeAuction(idx, this.params);
    this.cache = { version: this.version, idx, result };
    return this.cache;
  }

  // ───────────────────────── 用户操作 ─────────────────────────

  validate(side: Side, price: number, qty: number): string | null {
    if (this.done) return '集合竞价已结束，不再接受申报';
    if (side !== 'B' && side !== 'S') return '买卖方向无效';
    if (!Number.isInteger(price) || price <= 0) return '价格无效（最小变动单位 0.01 元）';
    if (price > this.upper || price < this.lower)
      return `价格超出涨跌幅限制（${(this.lower / 100).toFixed(2)} ~ ${(this.upper / 100).toFixed(2)}），属无效申报`;
    if (!Number.isInteger(qty) || qty < 1) return '数量须为正整数手（1 手 = 100 股）';
    if (qty > this.board.maxQty) return `单笔申报不得超过 ${this.board.maxQty} 手（${this.board.maxQty * 100} 股）`;
    return null;
  }

  placeOrder(side: Side, price: number, qty: number): ActionResult<Order> {
    const err = this.validate(side, price, qty);
    if (err) return { ok: false, error: err };
    const before = this.result;
    const o = this.insert(side, price, qty, 'me', 'normal');
    this.myActions.push({ t: this.t, kind: 'new', orderId: o.id, side, price, qty, before, after: this.result });
    return { ok: true, value: o };
  }

  cancelOrder(id: number): ActionResult<Order> {
    const o = this.byId.get(id);
    if (!o || o.owner !== 'me') return { ok: false, error: '委托不存在' };
    if (o.cancelled) return { ok: false, error: '该委托已撤销' };
    if (this.done) return { ok: false, error: '集合竞价已结束' };
    if (!this.canCancel) return { ok: false, error: '9:20 之后不接受撤单申报' };
    const before = this.result;
    this.remove(id);
    this.myActions.push({ t: this.t, kind: 'cancel', orderId: id, side: o.side, price: o.price, qty: o.qty, before, after: this.result });
    return { ok: true, value: o };
  }

  /** 撤销全部可撤的本人委托，返回撤单笔数 */
  cancelAllMine(): number {
    if (!this.canCancel) return 0;
    let n = 0;
    for (const o of this.orders) if (o.owner === 'me' && !o.cancelled && this.cancelOrder(o.id).ok) n++;
    return n;
  }

  /** 预演：如果现在下这笔单，竞价结果会变成什么（不修改状态） */
  preview(side: Side, price: number, qty: number): PreviewResult | null {
    if (this.validate(side, price, qty)) return null;
    const cur = this.depth;
    const levels: PriceLevel[] = [];
    let inserted = false;
    for (const lv of cur.levels) {
      if (!inserted && lv.price >= price) {
        if (lv.price === price) {
          levels.push({
            ...lv,
            buy: lv.buy + (side === 'B' ? qty : 0),
            sell: lv.sell + (side === 'S' ? qty : 0),
          });
          inserted = true;
          continue;
        }
        levels.push({ price, buy: side === 'B' ? qty : 0, sell: side === 'S' ? qty : 0, myBuy: 0, mySell: 0 });
        inserted = true;
      }
      levels.push(lv);
    }
    if (!inserted) levels.push({ price, buy: side === 'B' ? qty : 0, sell: side === 'S' ? qty : 0, myBuy: 0, mySell: 0 });
    const idx = new DepthIndex(levels);
    const result = computeAuction(idx, this.params);
    let fill = 0;
    if (result.price !== null) {
      // 新委托时间最晚：同价位所有已有委托都排在它前面
      if (side === 'B' && price >= result.price) {
        const ahead = cur.evaluate(price).buyGE;
        fill = Math.max(0, Math.min(qty, result.matched - ahead));
      } else if (side === 'S' && price <= result.price) {
        const ahead = cur.evaluate(price).sellLE;
        fill = Math.max(0, Math.min(qty, result.matched - ahead));
      }
    }
    return { result, fill, depth: idx };
  }

  setControls(c: Partial<LiveControls>) {
    this.controls = { ...this.controls, ...c };
  }

  // ───────────────────────── 时间推进 ─────────────────────────

  /** 推进模拟时间（毫秒，可为小数，内部按 100ms 步进） */
  advance(ms: number) {
    if (this.done) return;
    this.pendingMs += ms;
    while (this.pendingMs >= STEP_MS && !this.done) {
      this.pendingMs -= STEP_MS;
      this.step();
    }
  }

  /** 快进到指定时间（距开始毫秒） */
  jumpTo(target: number) {
    const end = Math.min(target, this.timing.duration);
    while (this.t < end && !this.done) this.step();
    this.pendingMs = 0;
  }

  /** 直接结束竞价 */
  finish() {
    this.jumpTo(this.timing.duration);
  }

  private step() {
    const u = this.t / this.timing.duration;
    this.generate(u);
    this.t += STEP_MS;
    this.runScheduled(this.t);
    if (this.t % this.snapshotMs === 0 || this.t >= this.timing.duration) this.recordSnapshot();
    if (this.t >= this.timing.duration) this.finalize();
  }

  private finalize() {
    const result = this.ensureCache().result;
    const fills = allocate(this.orders, result.price, result.matched);
    for (const o of this.orders) o.filled = fills.get(o.id) ?? 0;
    this.finalResult = result;
    this.done = true;
    this.version++;
  }

  private recordSnapshot() {
    const r = this.ensureCache().result;
    const snap: Snapshot = {
      t: this.t,
      price: r.price,
      matched: r.matched,
      unmatched: r.unmatched,
      unmatchedSide: r.unmatchedSide,
    };
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && last.t === this.t) this.snapshots[this.snapshots.length - 1] = snap;
    else this.snapshots.push(snap);
  }

  private schedule(t: number, fn: () => void) {
    this.scheduled.push({ t, fn });
    this.scheduled.sort((a, b) => a.t - b.t);
  }

  private runScheduled(now: number) {
    while (this.scheduled.length && this.scheduled[0].t <= now) {
      const item = this.scheduled.shift()!;
      item.fn();
    }
  }

  // ───────────────────────── 背景市场 ─────────────────────────

  private intensity(u: number): number {
    // 临近 9:25 委托明显增多
    return 1 + 2.5 * Math.max(0, (u - 0.8) / 0.2) ** 2;
  }

  private generate(u: number) {
    const sc = this.scenario;
    const act = this.controls.activity;
    const dt = STEP_MS / 1000;
    if (sc.rate > 0 && act > 0) {
      const n = this.rng.poisson(sc.rate * act * this.intensity(u) * dt);
      for (let i = 0; i < n; i++) this.genOrder(u);
    }
    // 可撤单阶段的随机撤单；临近 9:20 撤单显著增多
    if (this.canCancel && sc.cancelRate > 0 && this.liveMkt > 0 && act > 0) {
      let rate = sc.cancelRate;
      if (this.timing.cancelDeadline - this.t < 20_000) rate *= 4;
      const k = this.rng.poisson(this.liveMkt * rate * dt);
      for (let i = 0; i < k; i++) {
        for (let tries = 0; tries < 8; tries++) {
          const o = this.orders[this.rng.int(0, this.orders.length - 1)];
          if (!o.cancelled && o.owner === 'mkt' && o.tag !== 'spoof') {
            this.remove(o.id);
            break;
          }
        }
      }
    }
    this.rw += this.rng.gauss() * sc.rwVol * Math.sqrt(dt);
    this.rw *= 0.998;
  }

  private genOrder(u: number) {
    const sc = this.scenario;
    const rng = this.rng;
    const sent = Math.max(-1, Math.min(1, sc.sentiment(u) + this.controls.sentiment));
    const side: Side = rng.chance(0.5 + 0.4 * sent) ? 'B' : 'S';
    const center = this.anchor * (1 + sc.drift(u) + this.rw + this.controls.sentiment * 0.025);
    const sigma = sc.sigma;
    const lastPrice = this.lastSnapshotPrice();
    const sideBias = side === 'B' ? 1 + Math.max(0, sent) : 1 + Math.max(0, -sent);
    const r = rng.next();
    let px: number;
    if (lastPrice !== null && r < sc.followProb) {
      // 跟价单：挂在当前参考价附近（买单略高、卖单略低以求成交）
      px = side === 'B' ? lastPrice + rng.int(0, 2) : lastPrice - rng.int(0, 2);
    } else if (r < sc.followProb + sc.aggr * sideBias) {
      // 激进单：远离中枢报价，几乎必然成交
      const off = (2.5 + Math.abs(rng.gauss())) * sigma;
      px = side === 'B' ? center * (1 + off) : center * (1 - off);
    } else {
      px = center * (1 + sigma * rng.gauss() + (side === 'B' ? 0.25 : -0.25) * sigma);
      if (rng.chance(0.3)) px = Math.round(px / 5) * 5; // 整数价位偏好
    }
    const big = rng.chance(sc.bigProb);
    const qty = big ? rng.int(300, 3000) : Math.max(1, Math.round(Math.exp(Math.log(12) + rng.gauss())));
    this.insert(side, this.clampPrice(px), Math.min(this.board.maxQty, qty), 'mkt', big ? 'big' : 'normal');
  }

  private lastSnapshotPrice(): number | null {
    for (let i = this.snapshots.length - 1; i >= Math.max(0, this.snapshots.length - 3); i--) {
      if (this.snapshots[i].price !== null) return this.snapshots[i].price;
    }
    return null;
  }

  private clampPrice(px: number): number {
    return Math.min(this.upper, Math.max(this.lower, Math.round(px)));
  }

  // ───────────────────────── 委托簿维护 ─────────────────────────

  private insert(side: Side, price: number, qty: number, owner: Owner, tag: OrderTag): Order {
    const o: Order = {
      id: this.nextId++,
      seq: this.nextSeq++,
      side,
      price,
      qty,
      time: this.t,
      owner,
      tag,
      cancelled: false,
      filled: 0,
    };
    this.orders.push(o);
    this.byId.set(o.id, o);
    let lv = this.levelMap.get(price);
    if (!lv) {
      lv = { price, buy: 0, sell: 0, myBuy: 0, mySell: 0 };
      this.levelMap.set(price, lv);
    }
    if (side === 'B') {
      lv.buy += qty;
      if (owner === 'me') lv.myBuy += qty;
    } else {
      lv.sell += qty;
      if (owner === 'me') lv.mySell += qty;
    }
    if (owner === 'mkt') this.liveMkt++;
    this.tape.push({ t: this.t, kind: 'new', orderId: o.id, side, price, qty, owner, tag });
    this.version++;
    return o;
  }

  private remove(id: number) {
    const o = this.byId.get(id);
    if (!o || o.cancelled) return;
    o.cancelled = true;
    o.cancelTime = this.t;
    const lv = this.levelMap.get(o.price);
    if (lv) {
      if (o.side === 'B') {
        lv.buy -= o.qty;
        if (o.owner === 'me') lv.myBuy -= o.qty;
      } else {
        lv.sell -= o.qty;
        if (o.owner === 'me') lv.mySell -= o.qty;
      }
      if (lv.buy <= 0 && lv.sell <= 0) this.levelMap.delete(o.price);
    }
    if (o.owner === 'mkt') this.liveMkt--;
    this.tape.push({ t: this.t, kind: 'cancel', orderId: o.id, side: o.side, price: o.price, qty: o.qty, owner: o.owner, tag: o.tag });
    this.version++;
  }
}
