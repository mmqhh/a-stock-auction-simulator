import type { ExchangeRule } from './types';

export type Board = 'main' | 'chinext' | 'star' | 'st5';

export interface BoardInfo {
  id: Board;
  name: string;
  /** 涨跌幅限制（百分比整数） */
  limitPct: number;
  /** 单笔限价申报最大数量（手） */
  maxQty: number;
  /** 该板块可用的交易所 */
  exchanges: ExchangeRule[];
}

export const BOARDS: Record<Board, BoardInfo> = {
  main: { id: 'main', name: '主板（±10%）', limitPct: 10, maxQty: 10000, exchanges: ['SSE', 'SZSE'] },
  chinext: { id: 'chinext', name: '创业板（±20%）', limitPct: 20, maxQty: 3000, exchanges: ['SZSE'] },
  star: { id: 'star', name: '科创板（±20%）', limitPct: 20, maxQty: 1000, exchanges: ['SSE'] },
  st5: { id: 'st5', name: '±5% 涨跌幅（旧版主板ST规则）', limitPct: 5, maxQty: 10000, exchanges: ['SSE', 'SZSE'] },
};

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
