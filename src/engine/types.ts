/** 买卖方向：B = 买入，S = 卖出 */
export type Side = 'B' | 'S';

/** 委托来源：me = 用户本人，mkt = 模拟的其他市场参与者 */
export type Owner = 'me' | 'mkt';

/** 委托标签（仅用于模拟器内部展示/分析） */
export type OrderTag = 'normal' | 'big' | 'spoof';

/** 撮合规则：上交所 / 深交所 */
export type ExchangeRule = 'SSE' | 'SZSE';

/**
 * 一笔委托。
 * 价格单位：分（整数），数量单位：股（整数）；界面按 100 股 = 1 手换算。
 */
export interface Order {
  id: number;
  /** 全局递增序号，用于“时间优先” */
  seq: number;
  side: Side;
  price: number;
  qty: number;
  /** 委托时间，距竞价开始的毫秒数 */
  time: number;
  owner: Owner;
  tag: OrderTag;
  cancelled: boolean;
  cancelTime?: number;
  /** 竞价结束后的实际成交数量（股） */
  filled: number;
}

/** 某一价位上的汇总挂单 */
export interface PriceLevel {
  price: number;
  buy: number;
  sell: number;
  myBuy: number;
  mySell: number;
}

/** 一次虚拟撮合（或最终撮合）的结果 */
export interface AuctionResult {
  /** 虚拟参考价（分）；买卖不交叉时为 null */
  price: number | null;
  /** 匹配量（股） */
  matched: number;
  /** 未匹配量（股）：在参考价上不能成交的剩余申报量 */
  unmatched: number;
  /** 未匹配量所在方向 */
  unmatchedSide: Side | null;
  /** 最高买价及该价位数量（不交叉时用于盘口显示） */
  bestBid: { price: number; qty: number } | null;
  /** 最低卖价及该价位数量 */
  bestAsk: { price: number; qty: number } | null;
  totalBuy: number;
  totalSell: number;
  /** 定价依据（便于解释参考价是怎么来的） */
  basis: PricingBasis | null;
}

/** 参考价确定过程 */
export interface PriceRange {
  lo: number;
  hi: number;
}

export interface PricingBasis {
  /** 最大可成交量 */
  maxVolume: number;
  /** 满足三原则的候选价格区间（分），不逐分展开 */
  candidates: PriceRange[];
  candidateCount: number;
  /** 使未成交量最小后剩余的候选价格区间 */
  minImbalanceCandidates: PriceRange[];
  minImbalanceCount: number;
  /** 最终决定价格的环节 */
  step: 'unique' | 'minImbalance' | 'midpoint' | 'nearestRef';
}

/** 某一价格下的供需评估 */
export interface PriceEval {
  price: number;
  /** 价格 ≥ p 的买单累计 */
  buyGE: number;
  /** 价格 > p 的买单累计 */
  buyGT: number;
  /** 价格 ≤ p 的卖单累计 */
  sellLE: number;
  /** 价格 < p 的卖单累计 */
  sellLT: number;
  /** 可成交量 = min(buyGE, sellLE) */
  volume: number;
  /** 是否满足“高于成交价的买单、低于成交价的卖单全部成交” */
  feasible: boolean;
}
