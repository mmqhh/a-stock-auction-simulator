import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../engine/simulation';
import { RULE_NAMES } from '../engine/rules';
import { isCandidate } from '../engine/auction';
import { dirClass, fmtPrice, fmtVol } from './format';

interface Props {
  sim: Simulation;
  frame: number;
  onPickPrice: (cents: number) => void;
}

const STEP_TEXT: Record<string, string> = {
  unique: '唯一满足三原则的价格',
  minImbalance: '多个价格满足三原则 → 取未成交量最小',
  midpoint: '未成交量仍相同 → 上交所取中间价',
  nearestRef: '未成交量仍相同 → 深交所取最接近昨收的价格',
};

/** 参考价不在任何申报价位上时，虚拟行的说明（与定价依据一致） */
const GAP_TEXT: Record<string, string> = {
  midpoint: '（无申报，上交所中间价）',
  nearestRef: '（无申报，最接近昨收）',
};

export function DepthTable({ sim, onPickPrice }: Props) {
  const idx = sim.depth;
  const r = sim.result;
  const prev = sim.prevClose;
  const boxRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const rows = [...idx.levels].reverse();

  // 参考价行自动滚动到中间
  useEffect(() => {
    if (!follow || !boxRef.current || r.price === null) return;
    const box = boxRef.current;
    const el = box.querySelector<HTMLTableRowElement>('tr.clearing, tr.clearing-gap');
    if (el) box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  }, [r.price, follow, rows.length]);

  const basis = r.basis;
  // 参考价不在任何申报价位上（如中间价）时，插入一行虚拟行
  const clearingOnLevel = r.price !== null && idx.levels.some((l) => l.price === r.price);

  return (
    <div className="depth-wrap">
      <div className="depth-head">
        <span>
          规则：<b>{RULE_NAMES[sim.config.stock.rule]}</b>
        </span>
        {basis ? (
          <>
            <span>
              最大可成交量 <b className="yellow">{fmtVol(basis.maxVolume)}</b> 手
            </span>
            <span>
              满足三原则的候选价 <b>{basis.candidateCount}</b> 个
              {basis.candidateCount > 1 && (
                <span className="muted">
                  （{fmtPrice(basis.candidates[0].lo)}~{fmtPrice(basis.candidates[basis.candidates.length - 1].hi)}）
                </span>
              )}
            </span>
            <span>
              定价：<b className="cyan">{STEP_TEXT[basis.step]}</b> → <b className={dirClass(r.price, prev)}>{fmtPrice(r.price)}</b>
            </span>
          </>
        ) : (
          <span className="muted">买卖未交叉，没有可成交价格</span>
        )}
        <span className="ci-spacer" />
        <label className="ci-toggle">
          <input type="checkbox" checked={follow} onChange={() => setFollow(!follow)} /> 跟随参考价
        </label>
      </div>
      <div className="depth-table-box" ref={boxRef}>
        <table className="grid-table depth-table">
          <thead>
            <tr>
              <th>价格</th>
              <th>买单量</th>
              <th>卖单量</th>
              <th title="价格 ≥ 该价的全部买单">累计买(≥价)</th>
              <th title="价格 ≤ 该价的全部卖单">累计卖(≤价)</th>
              <th title="min(累计买, 累计卖)">可成交量</th>
              <th title="累计买 − 累计卖">买卖差</th>
              <th>我的委托</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lv, i) => {
              const e = idx.evaluate(lv.price);
              const diff = e.buyGE - e.sellLE;
              const isClearing = r.price === lv.price;
              const gapRow =
                !clearingOnLevel && r.price !== null && lv.price > r.price && (rows[i + 1] === undefined || rows[i + 1].price < r.price);
              const cls = [isClearing ? 'clearing' : '', isCandidate(basis?.candidates ?? [], lv.price) ? 'cand' : '', 'clickable'].join(' ');
              const out = [
                <tr key={lv.price} className={cls} onClick={() => onPickPrice(lv.price)}>
                  <td className={dirClass(lv.price, prev)}>{fmtPrice(lv.price)}</td>
                  <td className="up">{lv.buy ? fmtVol(lv.buy) : ''}</td>
                  <td className="down">{lv.sell ? fmtVol(lv.sell) : ''}</td>
                  <td>{fmtVol(e.buyGE)}</td>
                  <td>{fmtVol(e.sellLE)}</td>
                  <td className="yellow">{e.volume ? fmtVol(e.volume) : ''}</td>
                  <td className={diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}>{diff > 0 ? `+${fmtVol(diff)}` : fmtVol(diff)}</td>
                  <td>
                    {lv.myBuy > 0 && <span className="my-tag buy">买{fmtVol(lv.myBuy)}</span>}
                    {lv.mySell > 0 && <span className="my-tag sell">卖{fmtVol(lv.mySell)}</span>}
                  </td>
                </tr>,
              ];
              if (gapRow && r.price !== null) {
                const g = idx.evaluate(r.price);
                out.push(
                  <tr key="gap" className="clearing-gap">
                    <td className={dirClass(r.price, prev)}>{fmtPrice(r.price)}</td>
                    <td colSpan={2} className="muted">
                      {(basis && GAP_TEXT[basis.step]) ?? '（无申报价位）'}
                    </td>
                    <td>{fmtVol(g.buyGE)}</td>
                    <td>{fmtVol(g.sellLE)}</td>
                    <td className="yellow">{fmtVol(g.volume)}</td>
                    <td>{fmtVol(g.buyGE - g.sellLE)}</td>
                    <td />
                  </tr>,
                );
              }
              return out;
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">暂无委托</div>}
      </div>
    </div>
  );
}
