import type { OrderTag, Side } from './types';
import type { Rng } from './rng';

/** 场景脚本可用的操作 */
export interface ScenarioContext {
  rng: Rng;
  /** 锚定价：前收盘价（分） */
  anchor: number;
  upper: number;
  lower: number;
  /** 单笔上限（股） */
  maxQty: number;
  duration: number;
  cancelDeadline: number;
  /** 立即下一笔市场委托，返回委托 id */
  place: (side: Side, price: number, qty: number, tag: OrderTag) => number | null;
  /** 在指定时间（距开始毫秒）执行 */
  schedule: (t: number, fn: () => void) => void;
  cancel: (id: number) => void;
}

export interface Scenario {
  id: string;
  name: string;
  desc: string;
  /** 每秒平均新增委托笔数 */
  rate: number;
  /** 价格分散度（相对锚定价） */
  sigma: number;
  /** 激进委托（远离中枢、主动吃单）比例 */
  aggr: number;
  /** 大单概率 */
  bigProb: number;
  /** 跟价委托（挂在当前参考价附近）比例 */
  followProb: number;
  /** 可撤单阶段，每笔市场委托每秒被撤的概率 */
  cancelRate: number;
  /** 竞价开始时刻集中涌入的委托笔数（隔夜委托等） */
  burst: number;
  /** 价格中枢随机游走强度 */
  rwVol: number;
  /** 价格中枢相对锚定价的偏离，u ∈ [0,1] 为竞价进度 */
  drift: (u: number) => number;
  /** 多空倾向 [-1, 1] */
  sentiment: (u: number) => number;
  setup?: (ctx: ScenarioContext) => void;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const base = {
  rate: 6,
  sigma: 0.012,
  aggr: 0.08,
  bigProb: 0.03,
  followProb: 0.22,
  cancelRate: 0.004,
  burst: 140,
  rwVol: 0.0012,
};

export const SCENARIOS: Scenario[] = [
  {
    ...base,
    id: 'balanced',
    name: '多空均衡',
    desc: '买卖力量大致相当，参考价围绕昨收小幅波动。适合观察单笔委托对价格的边际影响。',
    drift: (u) => 0.004 * Math.sin(u * 7),
    sentiment: () => 0,
  },
  {
    ...base,
    id: 'bull',
    name: '抢筹高开',
    desc: '买盘持续涌入，中枢逐步上移，临近 9:25 出现尾段抢筹，未匹配量以红柱（买方剩余）为主。',
    drift: (u) => 0.008 + 0.035 * u,
    sentiment: (u) => 0.15 + 0.25 * u,
  },
  {
    ...base,
    id: 'bear',
    name: '恐慌低开',
    desc: '卖盘占优，中枢逐步下移，未匹配量以绿柱（卖方剩余）为主。',
    drift: (u) => -0.008 - 0.035 * u,
    sentiment: (u) => -0.15 - 0.25 * u,
  },
  {
    ...base,
    id: 'spoof',
    name: '9:20 前诱多撤单',
    desc: '9:15 后有大额买单把参考价顶高，9:19 后集中撤单，9:20 后卖盘接管。演示“9:20 前可撤单，量价易作假”。',
    cancelRate: 0.006,
    drift: (u) => 0.035 * smoothstep(0, 0.12, u) * (1 - smoothstep(0.47, 0.56, u)) - 0.015 * smoothstep(0.47, 0.6, u),
    sentiment: (u) => 0.25 - 0.6 * smoothstep(0.47, 0.56, u),
    setup: (ctx) => {
      const spoofPrice = Math.min(ctx.upper, Math.round(ctx.anchor * 1.06));
      for (let i = 0; i < 6; i++) {
        const placeAt = ctx.rng.int(10_000, 70_000);
        const qty = Math.min(ctx.maxQty, ctx.rng.int(2000, 6000) * 100);
        const cancelAt = ctx.cancelDeadline - ctx.rng.int(1500, 30_000);
        ctx.schedule(placeAt, () => {
          const id = ctx.place('B', spoofPrice - ctx.rng.int(0, 3), qty, 'spoof');
          if (id !== null) ctx.schedule(cancelAt, () => ctx.cancel(id));
        });
      }
    },
  },
  {
    ...base,
    id: 'limitup',
    name: '一字涨停封单',
    desc: '开盘即有巨量买单挂在涨停价，卖盘稀少。参考价锁死涨停，上方是持续放大的红色未匹配量。',
    rate: 4,
    burst: 60,
    sigma: 0.008,
    aggr: 0.35,
    bigProb: 0.05,
    drift: () => 0.085,
    sentiment: () => 0.9,
    setup: (ctx) => {
      for (let i = 0; i < 30; i++) ctx.place('B', ctx.upper, Math.min(ctx.maxQty, ctx.rng.int(3000, 9000) * 100), 'big');
    },
  },
  {
    ...base,
    id: 'empty',
    name: '空白盘（只有我的单）',
    desc: '没有任何背景委托，所有买卖单都由你自己下，适合精确验证撮合规则。',
    rate: 0,
    burst: 0,
    cancelRate: 0,
    drift: () => 0,
    sentiment: () => 0,
  },
];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
