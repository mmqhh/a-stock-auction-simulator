import type { Simulation } from '../engine/simulation';
import { clockString } from '../engine/rules';
import { amountOf, dirClass, fmtAmount, fmtPrice, fmtVol, signed } from './format';

interface Props {
  sim: Simulation;
  frame: number;
  onCancel: (id: number) => void;
  onCancelAll: () => void;
}

export function MyOrders({ sim, onCancel, onCancelAll }: Props) {
  const prev = sim.prevClose;
  const mine = sim.orders.filter((o) => o.owner === 'me');
  const fills = sim.estimatedFills();
  const actionOf = new Map(sim.myActions.filter((a) => a.kind === 'new').map((a) => [a.orderId, a]));

  let buyFilled = 0;
  let sellFilled = 0;
  for (const o of mine) {
    const f = sim.done ? o.filled : (fills.get(o.id) ?? 0);
    if (o.side === 'B') buyFilled += f;
    else sellFilled += f;
  }
  const px = sim.result.price;
  const liveMine = mine.filter((o) => !o.cancelled).length;

  return (
    <div className="tape-wrap">
      <div className="depth-head">
        <span>
          我的委托 <b>{mine.length}</b> 笔（有效 {liveMine}）
        </span>
        <span>
          {sim.done ? '买入成交' : '预计买入成交'} <b className="up">{fmtVol(buyFilled)}</b> 手
          {px !== null && buyFilled > 0 && <span className="muted">（{fmtAmount(amountOf(px, buyFilled))}元）</span>}
        </span>
        <span>
          {sim.done ? '卖出成交' : '预计卖出成交'} <b className="down">{fmtVol(sellFilled)}</b> 手
          {px !== null && sellFilled > 0 && <span className="muted">（{fmtAmount(amountOf(px, sellFilled))}元）</span>}
        </span>
        <span className="ci-spacer" />
        <button className="btn-small" disabled={!sim.canCancel || liveMine === 0} onClick={onCancelAll}>
          全部撤单
        </button>
      </div>
      <div className="depth-table-box">
        <table className="grid-table">
          <thead>
            <tr>
              <th>委托时间</th>
              <th>方向</th>
              <th>价格</th>
              <th>数量</th>
              <th>{sim.done ? '成交' : '预计成交'}</th>
              <th>状态</th>
              <th title="下单瞬间对参考价、匹配量、未匹配量的影响">下单影响</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {[...mine].reverse().map((o) => {
              const f = sim.done ? o.filled : (fills.get(o.id) ?? 0);
              let status: string;
              if (o.cancelled) status = '已撤';
              else if (!sim.done) status = '已报';
              else status = f === o.qty ? '全部成交' : f > 0 ? '部分成交' : '未成交';
              const a = actionOf.get(o.id);
              let impact = '';
              if (a) {
                const bp = a.before.price;
                const ap = a.after.price;
                const pd = bp !== null && ap !== null ? signed(ap - bp, (x) => (x / 100).toFixed(2)) : `${fmtPrice(bp)}→${fmtPrice(ap)}`;
                impact = `价 ${pd} · 匹配 ${signed(a.after.matched - a.before.matched, fmtVol)}`;
              }
              return (
                <tr key={o.id} className={o.cancelled ? 'cancelled' : ''}>
                  <td className="muted">{clockString(sim.timing.startClock, o.time, true)}</td>
                  <td className={o.side === 'B' ? 'up' : 'down'}>{o.side === 'B' ? '买入' : '卖出'}</td>
                  <td className={dirClass(o.price, prev)}>{fmtPrice(o.price)}</td>
                  <td>{fmtVol(o.qty)}</td>
                  <td className={f > 0 ? 'yellow' : 'muted'}>{o.cancelled ? '-' : fmtVol(f)}</td>
                  <td className={o.cancelled ? 'muted' : status === '全部成交' ? 'yellow' : ''}>{status}</td>
                  <td className="muted">{impact}</td>
                  <td>
                    {!o.cancelled && !sim.done && (
                      <button
                        className="btn-small"
                        disabled={!sim.canCancel}
                        title={sim.canCancel ? '撤销该委托' : '9:20 后不可撤单'}
                        onClick={() => onCancel(o.id)}
                      >
                        撤单
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {mine.length === 0 && <div className="empty">还没有委托。在右侧下单面板输入价格和数量后下单，观察竞价图的变化。</div>}
      </div>
    </div>
  );
}
