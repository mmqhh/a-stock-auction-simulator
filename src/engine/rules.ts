import type { ExchangeRule } from './types';

export type Board = 'main' | 'chinext' | 'star' | 'st5';

export interface BoardInfo {
  id: Board;
  name: string;
  /** 涨跌幅限制（百分比整数） */
  limitPct: number;
  /** 单笔限价申报数量（股）；模拟器不维护持仓，不模拟零股余额卖出 */
  minQty: number;
  qtyStep: number;
  maxQty: number;
  /** 该板块可用的交易所 */
  exchanges: ExchangeRule[];
}

export const BOARDS: Record<Board, BoardInfo> = {
  main: { id: 'main', name: '主板（±10%）', limitPct: 10, minQty: 100, qtyStep: 100, maxQty: 1000000, exchanges: ['SSE', 'SZSE'] },
  chinext: { id: 'chinext', name: '创业板（±20%）', limitPct: 20, minQty: 100, qtyStep: 100, maxQty: 300000, exchanges: ['SZSE'] },
  star: { id: 'star', name: '科创板（±20%）', limitPct: 20, minQty: 200, qtyStep: 1, maxQty: 100000, exchanges: ['SSE'] },
  st5: { id: 'st5', name: '±5% 涨跌幅（旧版主板ST规则）', limitPct: 5, minQty: 100, qtyStep: 100, maxQty: 1000000, exchanges: ['SSE', 'SZSE'] },
};

/** 模拟器可配置的昨收上限：10 万元（分）。 */
export const MAX_PREV_CLOSE = 10_000_000;
export const MAX_SEED = 0xffffffff;

/** 校验普通限价委托（不含持仓余额不足最低数量时的一次性卖出）。 */
export function validateQuantity(board: BoardInfo, shares: number): string | null {
  if (!Number.isSafeInteger(shares) || shares <= 0) return '数量须为正整数股（最小 0.01 手）';
  if (shares < board.minQty) return `单笔申报至少 ${board.minQty} 股（${board.minQty / 100} 手）`;
  if (shares > board.maxQty) return `单笔申报不得超过 ${board.maxQty} 股（${board.maxQty / 100} 手）`;
  if ((shares - board.minQty) % board.qtyStep !== 0) return `该板块申报数量须按 ${board.qtyStep} 股递增`;
  return null;
}

export function normalizeQuantity(board: BoardInfo, shares: number): number {
  return Math.min(board.maxQty, Math.max(board.minQty, Math.round(shares / board.qtyStep) * board.qtyStep));
}

export const RULE_NAMES: Record<ExchangeRule, string> = {
  SSE: '上交所',
  SZSE: '深交所',
};

/** 四舍五入到分：x 为“分 × 100”的整数 */
function roundHalfUpCents(scaled: number): number {
  return Math.floor((scaled + 50) / 100);
}

/** 计算涨跌停价（分）。涨跌停价 = 前收盘价 × (1 ± 涨跌幅)，四舍五入到 0.01 元 */
export function limitPrices(prevClose: number, limitPct: number): { upper: number; lower: number } {
  return {
    upper: roundHalfUpCents(prevClose * (100 + limitPct)),
    lower: Math.max(1, roundHalfUpCents(prevClose * (100 - limitPct))),
  };
}

export interface SessionTiming {
  /** 竞价开始时刻（当天第几秒） */
  startClock: number;
  /** 竞价时长（毫秒） */
  duration: number;
  /** 撤单截止（距开始毫秒）。在此时刻及之后不可撤单 */
  cancelDeadline: number;
}

/** 开盘集合竞价：9:15:00 - 9:25:00，9:20 起不接受撤单 */
export const TIMING: SessionTiming = {
  startClock: 9 * 3600 + 15 * 60,
  duration: 10 * 60 * 1000,
  cancelDeadline: 5 * 60 * 1000,
};

/** 格式化当天时刻 */
export function clockString(startClock: number, ms: number, withTenths = false): string {
  const totalMs = startClock * 1000 + ms;
  const s = Math.floor(totalMs / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  if (!withTenths) return base;
  return `${base}.${Math.floor((totalMs % 1000) / 100)}`;
}
