import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONTROLS, Simulation, type LiveControls, type SimConfig } from './engine/simulation';
import { HQAuctionChart } from './ui/HQAuctionChart';
import { DepthTable } from './ui/DepthTable';
import { fmtAmount, fmtPct, fmtPrice, fmtVol, dirClass, parsePrice, parseQty } from './ui/format';
import { MarketPanel } from './ui/MarketPanel';
import { MyOrders } from './ui/MyOrders';
import { OrderForm, type Draft } from './ui/OrderForm';
import { QuotePanel } from './ui/QuotePanel';
import { RulesHelp } from './ui/RulesHelp';
import { SettingsDialog } from './ui/SettingsDialog';
import { SupplyDemandChart } from './ui/SupplyDemandChart';
import { TapeList } from './ui/TapeList';
import { TopBar } from './ui/TopBar';
import { getScenario } from './engine/scenarios';

const DEFAULT_CONFIG: SimConfig = {
  scenarioId: 'balanced',
  seed: 20261107,
  snapshotSec: 3,
  stock: { code: 'SIM001', name: '模拟股份', prevClose: 1000, board: 'main', rule: 'SSE' },
};

type Tab = 'depth' | 'curve' | 'tape' | 'mine' | 'rules';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err';
}

let toastId = 0;

export function App() {
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const [controls, setControls] = useState<LiveControls>(DEFAULT_CONTROLS);
  const simRef = useRef<Simulation | null>(null);
  if (!simRef.current) simRef.current = new Simulation(DEFAULT_CONFIG, DEFAULT_CONTROLS);
  const sim = simRef.current;

  const [frame, setFrame] = useState(0);
  const bump = useCallback(() => setFrame((f) => f + 1), []);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [tab, setTab] = useState<Tab>('depth');
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<Draft>({ side: 'B', price: fmtPrice(DEFAULT_CONFIG.stock.prevClose), qty: '100' });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastId;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  // ── 主循环 ──
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  playingRef.current = playing;
  speedRef.current = speed;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastRender = 0;
    const loop = (now: number) => {
      const dt = Math.min(200, now - last);
      last = now;
      const s = simRef.current!;
      if (playingRef.current && !s.done) {
        s.advance(dt * speedRef.current);
        if (s.done) {
          setPlaying(false);
          bump();
        } else if (now - lastRender > 40) {
          lastRender = now;
          bump();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [bump]);

  // 竞价结束提示
  const doneRef = useRef(false);
  useEffect(() => {
    if (sim.done && !doneRef.current) {
      const r = sim.finalResult!;
      toast(
        r.price === null
          ? '集合竞价结束：买卖未交叉，没有产生成交'
          : `集合竞价结束：开盘价 ${fmtPrice(r.price)}，成交 ${fmtVol(r.matched)} 手`,
      );
      setTab('mine');
    }
    doneRef.current = sim.done;
  });

  const restart = useCallback(
    (cfg: SimConfig) => {
      simRef.current = new Simulation(cfg, controls);
      doneRef.current = false;
      setConfig(cfg);
      setPlaying(false);
      const anchor = simRef.current.anchor;
      setDraft((d) => ({ ...d, price: fmtPrice(anchor) }));
      bump();
    },
    [controls, bump],
  );

  const togglePlay = useCallback(() => {
    if (simRef.current!.done) return;
    setPlaying((p) => !p);
  }, []);

  // 空格：播放 / 暂停（设置窗口打开时不响应）
  const settingsOpenRef = useRef(showSettings);
  settingsOpenRef.current = showSettings;
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    };
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpenRef.current) return;
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault();
        if (!e.repeat) togglePlay();
      }
    };
    // 阻止空格在获得焦点的按钮上触发点击（避免误下单）
    const onKeyUp = (e: KeyboardEvent) => {
      if (settingsOpenRef.current) return;
      if (e.code === 'Space' && !isTyping(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [togglePlay]);

  const pickPrice = useCallback((cents: number) => setDraft((d) => ({ ...d, price: fmtPrice(cents) })), []);

  const price = parsePrice(draft.price);
  const qty = parseQty(draft.qty);
  // 预演只在委托簿或下单框变化时重算（播放时每秒重渲染约 25 次）
  const version = sim.version;
  const preview = useMemo(
    () => (price !== null && qty !== null && !sim.done ? sim.preview(draft.side, price, qty) : null),
    // version 变化代表委托簿 / 撮合状态变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim, version, draft.side, price, qty],
  );

  const submit = () => {
    if (price === null || qty === null) return toast('价格或数量无效', 'err');
    const res = sim.placeOrder(draft.side, price, qty);
    if (res.ok) {
      const a = sim.myActions[sim.myActions.length - 1];
      toast(
        `已报：${draft.side === 'B' ? '买入' : '卖出'} ${fmtPrice(price)} × ${qty} 手 → 参考价 ${fmtPrice(a.before.price)} → ${fmtPrice(a.after.price)}`,
      );
    } else toast(res.error, 'err');
    bump();
  };

  const cancel = (id: number) => {
    const res = sim.cancelOrder(id);
    if (res.ok) toast(`已撤单：${res.value.side === 'B' ? '买入' : '卖出'} ${fmtPrice(res.value.price)} × ${res.value.qty} 手`);
    else toast(res.error, 'err');
    bump();
  };

  const cancelAll = () => {
    const n = sim.cancelAllMine();
    toast(n > 0 ? `已撤销 ${n} 笔委托` : '没有可撤的委托', n > 0 ? 'ok' : 'err');
    bump();
  };

  const updateControls = (c: Partial<LiveControls>) => {
    const next = { ...controls, ...c };
    setControls(next);
    sim.setControls(next);
    bump();
  };

  const myCount = sim.myOrderCount;
  const fr = sim.finalResult;
  const prev = sim.prevClose;

  return (
    <div className="app">
      <TopBar
        sim={sim}
        playing={playing}
        speed={speed}
        onPlay={togglePlay}
        onSpeed={setSpeed}
        onJump={(t) => {
          sim.jumpTo(t);
          bump();
        }}
        onFinish={() => {
          sim.finish();
          setPlaying(false);
          bump();
        }}
        onReset={() => restart(config)}
        onSettings={() => setShowSettings(true)}
      />
      <div className="main">
        <div className="left">
          <div className="chart-area">
            <HQAuctionChart sim={sim} frame={frame} />
            {sim.done && fr && (
              <div className="done-banner">
                {fr.price === null ? (
                  <span>集合竞价结束：买卖未交叉，未产生开盘价</span>
                ) : (
                  <>
                    <span>开盘价</span>
                    <b className={dirClass(fr.price, prev)}>{fmtPrice(fr.price)}</b>
                    <b className={dirClass(fr.price, prev)}>{fmtPct(fr.price, prev)}</b>
                    <span>
                      成交 <b className="yellow">{fmtVol(fr.matched)}</b> 手
                    </span>
                    <span>
                      金额 <b className="yellow">{fmtAmount(fr.price * fr.matched)}</b>
                    </span>
                    <span className="muted">未成交部分进入 9:30 连续竞价</span>
                  </>
                )}
                <button className="btn primary" onClick={() => restart(config)}>
                  再来一次
                </button>
                <button
                  className="btn"
                  onClick={() => restart({ ...config, seed: Math.floor(Math.random() * 1e6) })}
                  title="换一个随机种子"
                >
                  换一批背景单
                </button>
              </div>
            )}
          </div>
          <div className="bottom">
            <div className="tabs">
              <button className={tab === 'depth' ? 'active' : ''} onClick={() => setTab('depth')}>
                委托簿深度
              </button>
              <button className={tab === 'curve' ? 'active' : ''} onClick={() => setTab('curve')}>
                供需曲线
              </button>
              <button className={tab === 'tape' ? 'active' : ''} onClick={() => setTab('tape')}>
                逐笔委托
              </button>
              <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
                我的委托{myCount > 0 ? ` (${myCount})` : ''}
              </button>
              <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>
                规则说明
              </button>
            </div>
            <div className="tab-body">
              {tab === 'depth' && <DepthTable sim={sim} frame={frame} onPickPrice={pickPrice} />}
              {tab === 'curve' && <SupplyDemandChart sim={sim} frame={frame} onPickPrice={pickPrice} />}
              {tab === 'tape' && <TapeList sim={sim} frame={frame} />}
              {tab === 'mine' && <MyOrders sim={sim} frame={frame} onCancel={cancel} onCancelAll={cancelAll} />}
              {tab === 'rules' && <RulesHelp />}
            </div>
          </div>
        </div>
        <div className="right">
          <QuotePanel sim={sim} onPickPrice={pickPrice} />
          <OrderForm sim={sim} draft={draft} setDraft={setDraft} preview={preview} onSubmit={submit} />
          <MarketPanel
            sim={sim}
            controls={controls}
            onControls={updateControls}
            onScenario={(id) => restart({ ...config, scenarioId: id })}
          />
        </div>
      </div>
      <div className="statusbar">
        <span>空格：播放/暂停</span>
        <span>点击图表/盘口/深度表：填入价格</span>
        <span>价格框 ↑↓：±0.01</span>
        <span className="ci-spacer" />
        <span className="muted">
          场景：{getScenario(config.scenarioId).name} · 种子 {config.seed} · 本模拟器仅用于学习集合竞价机制，不构成投资建议
        </span>
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>

      {showSettings && (
        <SettingsDialog
          config={config}
          onClose={() => setShowSettings(false)}
          onApply={(c) => {
            setShowSettings(false);
            restart(c);
          }}
        />
      )}
    </div>
  );
}
