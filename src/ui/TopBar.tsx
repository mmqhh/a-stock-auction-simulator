import type { Simulation } from '../engine/simulation';
import { clockString, RULE_NAMES } from '../engine/rules';
import { dirClass, fmtChange, fmtPct, fmtPrice } from './format';

interface Props {
  sim: Simulation;
  playing: boolean;
  speed: number;
  onPlay: () => void;
  onSpeed: (s: number) => void;
  onJump: (t: number) => void;
  onFinish: () => void;
  onReset: () => void;
  onSettings: () => void;
}

export const SPEEDS = [1, 2, 5, 10, 30, 60];

export function TopBar({ sim, playing, speed, onPlay, onSpeed, onJump, onFinish, onReset, onSettings }: Props) {
  const { stock } = sim.config;
  const r = sim.result;
  const prev = sim.prevClose;
  const dc = dirClass(r.price, prev);
  const dur = sim.timing.duration;
  const deadline = sim.timing.cancelDeadline;
  const phase = sim.phase;
  const suffix = stock.rule === 'SSE' ? 'SH' : 'SZ';
  const phaseText =
    phase === 'done' ? '竞价结束 · 已开盘' : phase === 'cancelable' ? '可申报 · 可撤单' : '可申报 · 不可撤单';

  return (
    <div className="topbar">
      <div className="tb-stock">
        <span className="tb-name">{stock.name}</span>
        <span className="tb-code">
          {stock.code}.{suffix}
        </span>
        <span className="tb-tag">{RULE_NAMES[stock.rule]}</span>
        <span className="tb-tag">{sim.board.name}</span>
      </div>
      <div className="tb-price">
        <span className={`tb-last ${dc}`}>{fmtPrice(r.price)}</span>
        <span className={dc}>{fmtChange(r.price, prev)}</span>
        <span className={dc}>{fmtPct(r.price, prev)}</span>
        <span className="tb-small muted">{sim.done ? '开盘价' : '虚拟参考价'}</span>
      </div>
      <div className="tb-clock">
        <span className={`tb-phase ${phase}`}>{phaseText}</span>
        <span className="tb-time">{clockString(sim.timing.startClock, sim.t)}</span>
        <div className="tb-progress" title="竞价进度">
          <div className="tb-progress-fill" style={{ width: `${(sim.t / dur) * 100}%` }} />
          <div className="tb-progress-mark" style={{ left: `${(deadline / dur) * 100}%` }} title="9:20 撤单截止" />
        </div>
      </div>
      <div className="tb-controls">
        <button className={`btn ${playing ? '' : 'primary'}`} disabled={sim.done} onClick={onPlay} title="空格键">
          {playing ? '❚❚ 暂停' : sim.t === 0 ? '▶ 开始' : '▶ 继续'}
        </button>
        <div className="seg">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? 'active' : ''} onClick={() => onSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
        <button className="btn" disabled={sim.done || sim.t >= deadline - 10_000} onClick={() => onJump(deadline - 10_000)} title="快进到 9:19:50">
          ⏩ 9:19:50
        </button>
        <button className="btn" disabled={sim.done || sim.t >= deadline} onClick={() => onJump(deadline)} title="快进到 9:20:00">
          ⏩ 9:20
        </button>
        <button className="btn" disabled={sim.done || sim.t >= dur - 10_000} onClick={() => onJump(dur - 10_000)} title="快进到结束前 10 秒">
          ⏩ 末10秒
        </button>
        <button className="btn" disabled={sim.done} onClick={onFinish} title="立即撮合">
          ⏭ 撮合
        </button>
        <button className="btn" onClick={onReset} title="使用相同设置重新开始">
          ↺ 重来
        </button>
        <button className="btn" onClick={onSettings}>
          ⚙ 设置
        </button>
      </div>
    </div>
  );
}
