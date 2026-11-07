/**
 * 集合竞价撮合核心算法（纯函数，无副作用）。
 *
 * 依据《上海证券交易所交易规则》3.5.2 条、《深圳证券交易所交易规则》集合竞价定价条款：
 *   集合竞价时，成交价格的确定原则为：
 *   （一）可实现最大成交量的价格；
 *   （二）高于该价格的买入申报与低于该价格的卖出申报全部成交的价格；
 *   （三）与该价格相同的买方或卖方至少有一方全部成交的价格。
 *
 *   两个以上价格符合上述条件的：
 *   - 上交所：使未成交量最小的申报价格为成交价格；仍有两个以上的，取其中间价。
 *   - 深交所：取买入申报累计数量与卖出申报累计数量之差最小的价格；仍相等的，
 *             取最接近前收盘价的价格（本模拟器只模拟开盘集合竞价）。
 *
 * 所有价格为“分”，所有数量为“手”。
 */
import type { AuctionResult, ExchangeRule, Order, PriceEval, PriceLevel, PricingBasis, Side } from './types';

export interface AuctionParams {
  rule: ExchangeRule;
  /** 深交所平局时比较的基准价（开盘集合竞价为前收盘价） */
  refPrice: number;
}

/** 由委托列表汇总价位（升序），忽略已撤单 */
export function buildLevels(orders: Iterable<Order>): PriceLevel[] {
  const map = new Map<number, PriceLevel>();
  for (const o of orders) {
    if (o.cancelled || o.qty <= 0) continue;
    let lv = map.get(o.price);
    if (!lv) {
      lv = { price: o.price, buy: 0, sell: 0, myBuy: 0, mySell: 0 };
      map.set(o.price, lv);
    }
    if (o.side === 'B') {
      lv.buy += o.qty;
      if (o.owner === 'me') lv.myBuy += o.qty;
    } else {
      lv.sell += o.qty;
      if (o.owner === 'me') lv.mySell += o.qty;
    }
  }
  return [...map.values()].filter((l) => l.buy > 0 || l.sell > 0).sort((a, b) => a.price - b.price);
}

/** 价位深度索引：O(log n) 计算任意价格下的累计买卖量 */
export class DepthIndex {
  readonly levels: PriceLevel[];
  readonly totalBuy: number;
  readonly totalSell: number;
  /** 最高买价（无买单时为 -Infinity） */
  readonly maxBid: number;
  /** 最低卖价（无卖单时为 +Infinity） */
  readonly minAsk: number;
  /** prefSell[i] = levels[0..i-1] 的卖量之和 */
  private readonly prefSell: number[];
  /** sufBuy[i] = levels[i..n-1] 的买量之和 */
  private readonly sufBuy: number[];

  constructor(levels: PriceLevel[]) {
    this.levels = levels;
    const n = levels.length;
    this.prefSell = new Array(n + 1).fill(0);
    this.sufBuy = new Array(n + 1).fill(0);
    let maxBid = -Infinity;
    let minAsk = Infinity;
    for (let i = 0; i < n; i++) {
      this.prefSell[i + 1] = this.prefSell[i] + levels[i].sell;
      if (levels[i].sell > 0 && levels[i].price < minAsk) minAsk = levels[i].price;
      if (levels[i].buy > 0 && levels[i].price > maxBid) maxBid = levels[i].price;
    }
    for (let i = n - 1; i >= 0; i--) this.sufBuy[i] = this.sufBuy[i + 1] + levels[i].buy;
    this.totalBuy = this.sufBuy[0];
    this.totalSell = this.prefSell[n];
    this.maxBid = maxBid;
    this.minAsk = minAsk;
  }

  /** 第一个 price ≥ p 的下标 */
  lowerBound(p: number): number {
    let lo = 0;
    let hi = this.levels.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.levels[mid].price < p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 第一个 price > p 的下标 */
  upperBound(p: number): number {
    let lo = 0;
    let hi = this.levels.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.levels[mid].price <= p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  evaluate(p: number): PriceEval {
    const lb = this.lowerBound(p);
    const ub = this.upperBound(p);
    const buyGE = this.sufBuy[lb];
    const buyGT = this.sufBuy[ub];
    const sellLE = this.prefSell[ub];
    const sellLT = this.prefSell[lb];
    const volume = Math.min(buyGE, sellLE);
    return {
      price: p,
      buyGE,
      buyGT,
      sellLE,
      sellLT,
      volume,
      feasible: volume > 0 && buyGT <= volume && sellLT <= volume,
    };
  }

  /** 是否存在可成交的交叉（最高买价 ≥ 最低卖价） */
  get crossed(): boolean {
    return this.totalBuy > 0 && this.totalSell > 0 && this.maxBid >= this.minAsk;
  }

  bestBid(): { price: number; qty: number } | null {
    if (this.totalBuy === 0) return null;
    const lv = this.levels[this.lowerBound(this.maxBid)];
    return { price: lv.price, qty: lv.buy };
  }

  bestAsk(): { price: number; qty: number } | null {
    if (this.totalSell === 0) return null;
    const lv = this.levels[this.lowerBound(this.minAsk)];
    return { price: lv.price, qty: lv.sell };
  }
}

function emptyResult(idx: DepthIndex): AuctionResult {
  return {
    price: null,
    matched: 0,
    unmatched: 0,
    unmatchedSide: null,
    bestBid: idx.bestBid(),
    bestAsk: idx.bestAsk(),
    totalBuy: idx.totalBuy,
    totalSell: idx.totalSell,
    basis: null,
  };
}

/** 在给定价格下生成结果（匹配量、未匹配量及方向） */
export function resultAtPrice(idx: DepthIndex, price: number, basis: PricingBasis | null): AuctionResult {
  const ev = idx.evaluate(price);
  const matched = ev.volume;
  let unmatched = 0;
  let unmatchedSide: Side | null = null;
  if (ev.buyGE > matched) {
    unmatched = ev.buyGE - matched;
    unmatchedSide = 'B';
  } else if (ev.sellLE > matched) {
    unmatched = ev.sellLE - matched;
    unmatchedSide = 'S';
  }
  return {
    price,
    matched,
    unmatched,
    unmatchedSide,
    bestBid: idx.bestBid(),
    bestAsk: idx.bestAsk(),
    totalBuy: idx.totalBuy,
    totalSell: idx.totalSell,
    basis,
  };
}

/** 一段连续价格 [lo, hi]（分），段内累计买 / 累计卖相同，e 为段内任一价格的评估结果 */
interface Segment {
  lo: number;
  hi: number;
  e: PriceEval;
}

function tickCount(segs: Segment[]): number {
  let n = 0;
  for (const s of segs) n += s.hi - s.lo + 1;
  return n;
}

function expandTicks(segs: Segment[]): number[] {
  const out: number[] = [];
  for (const s of segs) for (let p = s.lo; p <= s.hi; p++) out.push(p);
  return out;
}

/** 计算集合竞价参考价 / 成交价 */
export function computeAuction(levels: PriceLevel[] | DepthIndex, params: AuctionParams): AuctionResult {
  const idx = levels instanceof DepthIndex ? levels : new DepthIndex(levels);
  if (!idx.crossed) return emptyResult(idx);

  // 候选价格按“价格段”评估，每段内所有价格的累计买 / 累计卖完全相同：
  //  - 上交所规则明确为“申报价格”：每个申报价位单独一段；
  //  - 深交所按全部最小价位（0.01 元）评估：除申报价位外，相邻两个申报价位之间的空档
  //    （没有任何申报）也是一段，段内累计量不变，只需评估一次，不必逐个 0.01 元计算。
  const segs: Segment[] = [];
  let prevPrice: number | null = null;
  for (const lv of idx.levels) {
    if (lv.price < idx.minAsk || lv.price > idx.maxBid) continue;
    if (params.rule === 'SZSE' && prevPrice !== null && lv.price - prevPrice > 1) {
      segs.push({ lo: prevPrice + 1, hi: lv.price - 1, e: idx.evaluate(prevPrice + 1) });
    }
    segs.push({ lo: lv.price, hi: lv.price, e: idx.evaluate(lv.price) });
    prevPrice = lv.price;
  }

  let maxVolume = 0;
  for (const s of segs) if (s.e.volume > maxVolume) maxVolume = s.e.volume;
  if (maxVolume === 0) return emptyResult(idx);

  // 原则一 + 原则二（原则三在最大成交量处自然满足：min(买, 卖) 必有一方全部成交）
  let cands = segs.filter((s) => s.e.volume === maxVolume && s.e.feasible);
  if (cands.length === 0) cands = segs.filter((s) => s.e.volume === maxVolume); // 理论上不会发生，兜底

  // 平局一：未成交量（累计买与累计卖之差）最小
  let minImb = Infinity;
  for (const s of cands) minImb = Math.min(minImb, Math.abs(s.e.buyGE - s.e.sellLE));
  const minImbCands = cands.filter((s) => Math.abs(s.e.buyGE - s.e.sellLE) === minImb);

  const candCount = tickCount(cands);
  const minImbCount = tickCount(minImbCands);
  const basis: PricingBasis = {
    maxVolume,
    candidates: expandTicks(cands),
    minImbalanceCandidates: expandTicks(minImbCands),
    step: candCount === 1 ? 'unique' : minImbCount === 1 ? 'minImbalance' : params.rule === 'SSE' ? 'midpoint' : 'nearestRef',
  };

  let price: number;
  if (minImbCount === 1) {
    price = minImbCands[0].lo;
  } else if (params.rule === 'SSE') {
    // 平局二（上交所）：取中间价，四舍五入到最小价位
    const lo = minImbCands[0].lo;
    const hi = minImbCands[minImbCands.length - 1].hi;
    price = Math.floor((lo + hi + 1) / 2);
  } else {
    // 平局二（深交所）：取最接近基准价的价格；距离相同时取较高者。
    // 每段内离基准价最近的点就是把基准价夹到段内
    price = minImbCands[0].lo;
    let best = Infinity;
    for (const s of minImbCands) {
      const p = Math.min(s.hi, Math.max(s.lo, params.refPrice));
      const d = Math.abs(p - params.refPrice);
      if (d < best || (d === best && p > price)) {
        best = d;
        price = p;
      }
    }
  }
  return resultAtPrice(idx, price, basis);
}

/**
 * 按“价格优先、时间优先”分配成交。
 * 返回 委托id → 成交手数（只包含成交量 > 0 的委托）。
 */
export function allocate(orders: Iterable<Order>, price: number | null, matched: number): Map<number, number> {
  const fills = new Map<number, number>();
  if (price === null || matched <= 0) return fills;
  const buys: Order[] = [];
  const sells: Order[] = [];
  for (const o of orders) {
    if (o.cancelled || o.qty <= 0) continue;
    if (o.side === 'B' && o.price >= price) buys.push(o);
    else if (o.side === 'S' && o.price <= price) sells.push(o);
  }
  buys.sort((a, b) => b.price - a.price || a.seq - b.seq);
  sells.sort((a, b) => a.price - b.price || a.seq - b.seq);
  for (const list of [buys, sells]) {
    let left = matched;
    for (const o of list) {
      if (left <= 0) break;
      const q = Math.min(o.qty, left);
      fills.set(o.id, q);
      left -= q;
    }
  }
  return fills;
}
