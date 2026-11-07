import { useState } from 'react';
import type { SimConfig } from '../engine/simulation';
import { BOARDS, limitPrices, RULE_NAMES, type Board } from '../engine/rules';
import { getScenario, SCENARIOS } from '../engine/scenarios';
import type { ExchangeRule } from '../engine/types';
import { fmtPrice, parsePrice } from './format';

interface Props {
  config: SimConfig;
  onApply: (c: SimConfig) => void;
  onClose: () => void;
}

export function SettingsDialog({ config, onApply, onClose }: Props) {
  const [name, setName] = useState(config.stock.name);
  const [code, setCode] = useState(config.stock.code);
  const [prevClose, setPrevClose] = useState(fmtPrice(config.stock.prevClose));
  const [board, setBoard] = useState<Board>(config.stock.board);
  const [rule, setRule] = useState<ExchangeRule>(config.stock.rule);
  const [scenarioId, setScenarioId] = useState(config.scenarioId);
  const [seed, setSeed] = useState(String(config.seed));
  const [snapshotSec, setSnapshotSec] = useState(config.snapshotSec);

  const pc = parsePrice(prevClose);
  const lim = pc ? limitPrices(pc, BOARDS[board].limitPct) : null;
  const validScenario = SCENARIOS.some((s) => s.id === scenarioId) ? scenarioId : SCENARIOS[0].id;

  let error: string | null = null;
  if (!pc) error = '昨收价无效';
  else if (!/^\d+$/.test(seed)) error = '随机种子须为非负整数';

  const changeBoard = (b: Board) => {
    setBoard(b);
    if (!BOARDS[b].exchanges.includes(rule)) setRule(BOARDS[b].exchanges[0]);
  };

  const apply = () => {
    if (error || !pc) return;
    onApply({
      scenarioId: validScenario,
      seed: parseInt(seed, 10),
      snapshotSec,
      stock: {
        name: name.trim() || '模拟股份',
        code: code.trim() || 'SIM001',
        prevClose: pc,
        board,
        rule,
      },
    });
  };

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          模拟设置
          <button className="modal-x" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="form-grid">
          <label>股票名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <label>股票代码</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} />

          <label>板块 / 涨跌幅</label>
          <select value={board} onChange={(e) => changeBoard(e.target.value as Board)}>
            {Object.values(BOARDS).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <label>撮合规则</label>
          <select value={rule} onChange={(e) => setRule(e.target.value as ExchangeRule)}>
            {BOARDS[board].exchanges.map((r) => (
              <option key={r} value={r}>
                {RULE_NAMES[r]}
              </option>
            ))}
          </select>

          <label>昨收价（元）</label>
          <input value={prevClose} onChange={(e) => setPrevClose(e.target.value)} />
          <label>涨停 / 跌停</label>
          <div className="form-static">
            {lim ? (
              <>
                <span className="up">{fmtPrice(lim.upper)}</span> / <span className="down">{fmtPrice(lim.lower)}</span>
              </>
            ) : (
              '--'
            )}
          </div>

          <label>背景场景</label>
          <select className="span3" value={validScenario} onChange={(e) => setScenarioId(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="span4 muted small scenario-desc">{getScenario(validScenario).desc}</div>

          <label>随机种子</label>
          <div className="seed-row">
            <input value={seed} onChange={(e) => setSeed(e.target.value)} />
            <button className="btn-small" onClick={() => setSeed(String(Math.floor(Math.random() * 1e6)))}>
              随机
            </button>
          </div>
          <label>快照间隔</label>
          <select value={snapshotSec} onChange={(e) => setSnapshotSec(Number(e.target.value))}>
            <option value={1}>1 秒</option>
            <option value={3}>3 秒（Level-1 行情）</option>
          </select>
        </div>
        {error && <div className="of-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!!error} onClick={apply}>
            应用并重新开始
          </button>
        </div>
      </div>
    </div>
  );
}
