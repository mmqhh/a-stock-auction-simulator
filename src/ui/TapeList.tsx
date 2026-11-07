import { useState } from 'react';
import type { Simulation, TapeEvent } from '../engine/simulation';
import { clockString } from '../engine/rules';
import { dirClass, fmtPrice, fmtVol } from './format';

interface Props {
  sim: Simulation;
  frame: number;
}

const MAX_ROWS = 400;

export function TapeList({ sim }: Props) {
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyBig, setOnlyBig] = useState(false);
  const prev = sim.prevClose;
  const rows: TapeEvent[] = [];
  for (let i = sim.tape.length - 1; i >= 0 && rows.length < MAX_ROWS; i--) {
    const e = sim.tape[i];
    if (onlyMine && e.owner !== 'me') continue;
    if (onlyBig && e.tag !== 'big' && e.tag !== 'spoof') continue;
    rows.push(e);
  }
  const sourceText = (e: TapeEvent) => {
    if (e.owner === 'me') return <span className="my-tag me">我</span>;
    if (e.tag === 'spoof') return sim.done ? <span className="my-tag spoof">诱单</span> : <span className="my-tag big">大单</span>;
    if (e.tag === 'big') return <span className="my-tag big">大单</span>;
    return <span className="muted">市场</span>;
  };
  return (
    <div className="tape-wrap">
      <div className="depth-head">
        <span className="muted">逐笔委托 / 撤单流水（最新在上）· 共 {sim.tape.length} 条</span>
        <span className="ci-spacer" />
        <label className="ci-toggle">
          <input type="checkbox" checked={onlyMine} onChange={() => setOnlyMine(!onlyMine)} /> 只看我的
        </label>
        <label className="ci-toggle">
          <input type="checkbox" checked={onlyBig} onChange={() => setOnlyBig(!onlyBig)} /> 只看大单
        </label>
      </div>
      <div className="depth-table-box">
        <table className="grid-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>价格</th>
              <th>数量(手)</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              // 每笔委托最多一次“新增”、一次“撤单”，组合起来唯一且稳定
              <tr key={`${e.orderId}-${e.kind}`} className={e.owner === 'me' ? 'mine' : ''}>
                <td className="muted">{clockString(sim.timing.startClock, e.t, true)}</td>
                <td className={e.kind === 'cancel' ? 'muted' : e.side === 'B' ? 'up' : 'down'}>
                  {e.kind === 'cancel' ? (e.side === 'B' ? '撤买' : '撤卖') : e.side === 'B' ? '委买' : '委卖'}
                </td>
                <td className={e.kind === 'cancel' ? 'muted' : dirClass(e.price, prev)}>{fmtPrice(e.price)}</td>
                <td className={e.kind === 'cancel' ? 'muted strike' : 'yellow'}>{fmtVol(e.qty)}</td>
                <td>{sourceText(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">暂无记录</div>}
      </div>
    </div>
  );
}
