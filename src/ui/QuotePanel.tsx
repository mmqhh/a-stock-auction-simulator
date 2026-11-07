import type { Simulation } from '../engine/simulation';
import { amountOf, dirClass, fmtAmount, fmtPct, fmtPrice, fmtVol } from './format';

interface Props {
  sim: Simulation;
  onPickPrice: (cents: number) => void;
}

interface Row {
  label: string;
  price: number | null;
  /** 价格栏显示“—”（未匹配量只揭示数量，不揭示价格） */
  dash?: boolean;
  qty: number | null;
}

/**
 * 集合竞价期间的五档行情揭示方式（深交所/上交所行情规范）：
 *  - 买一、卖一价格 = 虚拟参考价，买一量、卖一量 = 虚拟匹配量；
 *  - 未匹配量按买方/卖方剩余揭示在“买二量”或“卖二量”，价格栏为空；
 *  - 买卖不交叉时，揭示最高买价与最低卖价。
 */
function buildRows(sim: Simulation): { sells: Row[]; buys: Row[] } {
  const r = sim.result;
  const sells: Row[] = [1, 2, 3, 4, 5].map((i) => ({ label: `卖${'一二三四五'[i - 1]}`, price: null, qty: null }));
  const buys: Row[] = [1, 2, 3, 4, 5].map((i) => ({ label: `买${'一二三四五'[i - 1]}`, price: null, qty: null }));
  if (r.price !== null) {
    sells[0].price = r.price;
    sells[0].qty = r.matched;
    buys[0].price = r.price;
    buys[0].qty = r.matched;
    if (r.unmatchedSide === 'S') {
      sells[1].dash = true;
      sells[1].qty = r.unmatched;
    } else if (r.unmatchedSide === 'B') {
      buys[1].dash = true;
      buys[1].qty = r.unmatched;
    }
  } else {
    if (r.bestAsk) {
      sells[0].price = r.bestAsk.price;
      sells[0].qty = r.bestAsk.qty;
    }
    if (r.bestBid) {
      buys[0].price = r.bestBid.price;
      buys[0].qty = r.bestBid.qty;
    }
  }
  return { sells: sells.reverse(), buys };
}

export function QuotePanel({ sim, onPickPrice }: Props) {
  const prev = sim.prevClose;
  const r = sim.result;
  const { sells, buys } = buildRows(sim);

  const renderRow = (row: Row, isBuy: boolean) => (
    <div
      key={row.label}
      className={`q-row ${row.price !== null ? 'clickable' : ''}`}
      onClick={() => row.price !== null && onPickPrice(row.price)}
    >
      <span className="q-label">{row.label}</span>
      <span className={`q-price ${row.dash ? 'flat' : dirClass(row.price, prev)}`}>{row.dash ? '—' : row.price !== null ? fmtPrice(row.price) : ''}</span>
      <span className={`q-qty ${row.dash ? (isBuy ? 'up' : 'down') : 'yellow'}`}>{row.qty !== null ? fmtVol(row.qty) : ''}</span>
    </div>
  );

  let hint: string;
  if (r.price === null) {
    hint = r.totalBuy === 0 || r.totalSell === 0 ? '只有单边委托，无法撮合' : '买卖价格尚未交叉，暂无参考价';
  } else if (r.unmatchedSide === 'B') {
    hint = `买方剩余 ${fmtVol(r.unmatched)} 手未匹配（红柱），买盘占优`;
  } else if (r.unmatchedSide === 'S') {
    hint = `卖方剩余 ${fmtVol(r.unmatched)} 手未匹配（绿柱），卖盘占优`;
  } else {
    hint = '参考价上买卖恰好全部匹配';
  }

  const phase = sim.phase;
  return (
    <div className="quote-panel">
      <div className="panel-title">
        <span>{sim.done ? '竞价结果' : '竞价盘口'}</span>
        <span className="muted small">{sim.done ? '已撮合' : phase === 'cancelable' ? '虚拟撮合 · 可撤单' : '虚拟撮合 · 不可撤单'}</span>
      </div>
      <div className="q-book">
        {sells.map((row) => renderRow(row, false))}
        <div className="q-sep" />
        {buys.map((row) => renderRow(row, true))}
      </div>
      <div className="q-hint">{hint}</div>
      <div className="q-stats">
        <div>
          <span>{sim.done ? '开盘价' : '参考价'}</span>
          <b className={dirClass(r.price, prev)}>{fmtPrice(r.price)}</b>
        </div>
        <div>
          <span>涨幅</span>
          <b className={dirClass(r.price, prev)}>{fmtPct(r.price, prev)}</b>
        </div>
        <div>
          <span>匹配量</span>
          <b className="yellow">{fmtVol(r.matched)}</b>
        </div>
        <div>
          <span>匹配额</span>
          <b className="yellow">{fmtAmount(amountOf(r.price, r.matched))}</b>
        </div>
        <div>
          <span>未匹配</span>
          <b className={r.unmatchedSide === 'B' ? 'up' : r.unmatchedSide === 'S' ? 'down' : 'flat'}>
            {r.unmatchedSide === 'B' ? '买' : r.unmatchedSide === 'S' ? '卖' : ''}
            {fmtVol(r.unmatched)}
          </b>
        </div>
        <div>
          <span>昨收</span>
          <b className="flat">{fmtPrice(prev)}</b>
        </div>
        <div>
          <span>涨停</span>
          <b className="up">{fmtPrice(sim.upper)}</b>
        </div>
        <div>
          <span>跌停</span>
          <b className="down">{fmtPrice(sim.lower)}</b>
        </div>
      </div>
      <div className="q-god" title="真实行情软件看不到这些数据，仅模拟器提供">
        <span className="tag">上帝视角</span>
        <span>
          总委买 <b className="up">{fmtVol(r.totalBuy)}</b>
        </span>
        <span>
          总委卖 <b className="down">{fmtVol(r.totalSell)}</b>
        </span>
        <span>
          有效委托 <b>{sim.liveOrderCount}</b> 笔
        </span>
      </div>
    </div>
  );
}
