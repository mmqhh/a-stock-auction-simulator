import type { KeyboardEvent } from 'react';
import type { PreviewResult, Simulation } from '../engine/simulation';
import type { Side } from '../engine/types';
import { dirClass, fmtAmount, fmtPrice, fmtVol, parsePrice, parseQty, signed } from './format';

export interface Draft {
  side: Side;
  price: string;
  qty: string;
}

interface Props {
  sim: Simulation;
  draft: Draft;
  setDraft: (d: Draft) => void;
  preview: PreviewResult | null;
  onSubmit: () => void;
}

const QTY_PRESETS = [10, 100, 500, 1000, 5000];

export function OrderForm({ sim, draft, setDraft, preview, onSubmit }: Props) {
  const prev = sim.prevClose;
  const price = parsePrice(draft.price);
  const qty = parseQty(draft.qty);
  const r = sim.result;
  const isBuy = draft.side === 'B';
  const error = price === null ? '请输入有效价格（最多两位小数）' : qty === null ? '请输入有效数量（整数手）' : sim.validate(draft.side, price, qty);

  const setPrice = (cents: number) => setDraft({ ...draft, price: fmtPrice(Math.min(sim.upper, Math.max(sim.lower, cents))) });
  const bumpPrice = (d: number) => setPrice((price ?? r.price ?? prev) + d);
  const setQty = (n: number) => setDraft({ ...draft, qty: String(Math.max(1, Math.min(sim.board.maxQty, n))) });

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSubmit();
    if (e.key === 'ArrowUp' && e.currentTarget.name === 'price') {
      e.preventDefault();
      bumpPrice(1);
    }
    if (e.key === 'ArrowDown' && e.currentTarget.name === 'price') {
      e.preventDefault();
      bumpPrice(-1);
    }
  };

  const after = preview?.result;
  const priceDelta = after && after.price !== null && r.price !== null ? after.price - r.price : null;

  return (
    <div className={`order-form ${isBuy ? 'buy' : 'sell'}`}>
      <div className="of-tabs">
        <button className={`of-tab buy ${isBuy ? 'active' : ''}`} onClick={() => setDraft({ ...draft, side: 'B' })}>
          买入
        </button>
        <button className={`of-tab sell ${!isBuy ? 'active' : ''}`} onClick={() => setDraft({ ...draft, side: 'S' })}>
          卖出
        </button>
      </div>

      <div className="of-field">
        <label>价格</label>
        <div className="stepper">
          <button onClick={() => bumpPrice(-1)}>−</button>
          <input name="price" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} onKeyDown={onKey} />
          <button onClick={() => bumpPrice(1)}>+</button>
        </div>
        <span className="unit">元</span>
      </div>
      <div className="of-quick">
        <button className="up" onClick={() => setPrice(sim.upper)}>
          涨停 {fmtPrice(sim.upper)}
        </button>
        <button className="down" onClick={() => setPrice(sim.lower)}>
          跌停 {fmtPrice(sim.lower)}
        </button>
        <button onClick={() => setPrice(prev)}>昨收</button>
        <button disabled={r.price === null} onClick={() => r.price !== null && setPrice(r.price)}>
          参考价
        </button>
      </div>

      <div className="of-field">
        <label>数量</label>
        <div className="stepper">
          <button onClick={() => setQty((qty ?? 1) - (qty && qty > 100 ? 100 : 1))}>−</button>
          <input name="qty" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} onKeyDown={onKey} />
          <button onClick={() => setQty((qty ?? 0) + (qty && qty >= 100 ? 100 : 1))}>+</button>
        </div>
        <span className="unit">手</span>
      </div>
      <div className="of-quick">
        {QTY_PRESETS.filter((n) => n <= sim.board.maxQty).map((n) => (
          <button key={n} onClick={() => setQty(n)}>
            {n >= 1000 ? `${n / 1000}千` : n}
          </button>
        ))}
        <button onClick={() => setQty(sim.board.maxQty)}>最大</button>
      </div>
      <div className="of-amount muted">
        {price !== null && qty !== null ? `≈ ${fmtAmount(price * qty)}元 · ${qty * 100}股` : ' '}
        <span className="right">单笔上限 {sim.board.maxQty} 手</span>
      </div>

      <div className="of-preview">
        <div className="of-preview-title">下单影响预演（基于当前委托簿）</div>
        {error ? (
          <div className="of-error">{error}</div>
        ) : after ? (
          <table>
            <tbody>
              <tr>
                <td>参考价</td>
                <td className={dirClass(r.price, prev)}>{fmtPrice(r.price)}</td>
                <td>→</td>
                <td className={dirClass(after.price, prev)}>{fmtPrice(after.price)}</td>
                <td className={priceDelta === null ? '' : priceDelta > 0 ? 'up' : priceDelta < 0 ? 'down' : 'flat'}>
                  {priceDelta === null ? '' : signed(priceDelta, (x) => (x / 100).toFixed(2))}
                </td>
              </tr>
              <tr>
                <td>匹配量</td>
                <td className="yellow">{fmtVol(r.matched)}</td>
                <td>→</td>
                <td className="yellow">{fmtVol(after.matched)}</td>
                <td>{signed(after.matched - r.matched, fmtVol)}</td>
              </tr>
              <tr>
                <td>未匹配</td>
                <td className={r.unmatchedSide === 'B' ? 'up' : r.unmatchedSide === 'S' ? 'down' : ''}>
                  {r.unmatchedSide === 'B' ? '买' : r.unmatchedSide === 'S' ? '卖' : ''}
                  {fmtVol(r.unmatched)}
                </td>
                <td>→</td>
                <td className={after.unmatchedSide === 'B' ? 'up' : after.unmatchedSide === 'S' ? 'down' : ''}>
                  {after.unmatchedSide === 'B' ? '买' : after.unmatchedSide === 'S' ? '卖' : ''}
                  {fmtVol(after.unmatched)}
                </td>
                <td />
              </tr>
              <tr>
                <td>本单</td>
                <td colSpan={4}>
                  若此刻结束，预计成交{' '}
                  <b className={preview!.fill > 0 ? 'yellow' : 'muted'}>
                    {fmtVol(preview!.fill)} / {fmtVol(qty!)}
                  </b>{' '}
                  手
                </td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </div>

      <button className={`of-submit ${isBuy ? 'buy' : 'sell'}`} disabled={!!error} onClick={onSubmit}>
        {sim.done ? '集合竞价已结束' : `${isBuy ? '买入' : '卖出'}下单（回车）`}
      </button>
    </div>
  );
}
