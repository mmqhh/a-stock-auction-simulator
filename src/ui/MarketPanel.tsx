import type { LiveControls, Simulation } from '../engine/simulation';
import { SCENARIOS } from '../engine/scenarios';

interface Props {
  sim: Simulation;
  controls: LiveControls;
  onControls: (c: Partial<LiveControls>) => void;
  onScenario: (id: string) => void;
}

export function MarketPanel({ sim, controls, onControls, onScenario }: Props) {
  const sc = sim.scenario;
  const sentText =
    controls.sentiment > 0.05 ? `偏多 +${Math.round(controls.sentiment * 100)}` : controls.sentiment < -0.05 ? `偏空 ${Math.round(controls.sentiment * 100)}` : '中性';
  return (
    <div className="market-panel">
      <div className="panel-title">
        <span>背景市场</span>
        <span className="muted small">实时可调</span>
      </div>
      <div className="mp-row">
        <label>场景</label>
        <select value={sc.id} onChange={(e) => onScenario(e.target.value)} title="切换场景会重新开始">
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mp-desc muted small">{sc.desc}</div>
      <div className="mp-row">
        <label>活跃度</label>
        <input
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={controls.activity}
          disabled={sc.rate === 0}
          onChange={(e) => onControls({ activity: Number(e.target.value) })}
        />
        <span className="mp-val">{sc.rate === 0 ? '无' : controls.activity === 0 ? '暂停' : `×${controls.activity.toFixed(1)}`}</span>
      </div>
      <div className="mp-row">
        <label>多空倾向</label>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={controls.sentiment}
          disabled={sc.rate === 0}
          onChange={(e) => onControls({ sentiment: Number(e.target.value) })}
          onDoubleClick={() => onControls({ sentiment: 0 })}
        />
        <span className={`mp-val ${controls.sentiment > 0.05 ? 'up' : controls.sentiment < -0.05 ? 'down' : ''}`}>{sentText}</span>
      </div>
    </div>
  );
}
