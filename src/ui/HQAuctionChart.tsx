/**
 * 基于 HQChart（https://github.com/jones2000/HQChart，Apache-2.0）的开盘集合竞价走势图（9:15–9:25）。
 *
 * HQChart 的分时图内置 A 股盘前集合竞价区域（BeforeOpen），
 * 使用其 2.0 数据格式：[时间 HHMMSS, 价格, 匹配量, 未匹配量, 柱子颜色ID, 量柱最大值, 日期]
 *   - 匹配量：从底部向上的柱子
 *   - 未匹配量：从顶部向下倒挂的柱子
 *   - 颜色 ID：0 = 平盘，1 = 红（买方未匹配），2 = 绿（卖方未匹配）
 * 模拟器快照通过 NetworkFilter 喂给 HQChart，不发起任何网络请求。
 *
 * HQChart 没有的东西（竞价区时间轴、9:20 撤单截止线）
 * 用一层透明 canvas 叠加绘制，坐标直接取 HQChart 内部框架的映射函数，保证对齐。
 *
 * 只显示竞价时段：HQChart 的分时图一定带 9:30–15:00 连续竞价区，这里把它压到很窄（HIDDEN_MAIN），
 * 再把图表画布向右延伸 EXTRA 像素、由外层 overflow:hidden 裁掉；
 * 右侧留出 STRIP 宽的涨跌幅坐标条，由叠加层自己画。
 */
import { useEffect, useRef, useState } from 'react';
import HQChart from 'hqchart/lib/umychart.vue.js';
import { buildAuctionData } from './auctionChartData';
import type { Simulation } from '../engine/simulation';
import { clockString } from '../engine/rules';
import { COLORS, fmtPrice } from './format';

/* eslint-disable @typescript-eslint/no-explicit-any */
// CJS 的 default 包装在开发预构建和生产构建中可能不同。
const H = HQChart.default ?? HQChart;

const BORDER = { Left: 64, Right: 64, Top: 26, Bottom: 22 };
/** 连续竞价区（9:30–15:00）压缩后的宽度，CSS 像素，会被裁掉 */
const HIDDEN_MAIN = 60;
/** 右侧由叠加层绘制的涨跌幅坐标条宽度 */
const STRIP = 56;
/** 图表画布比可见区域向右多出的宽度 */
const EXTRA = HIDDEN_MAIN + BORDER.Right - STRIP;

/** 已应用样式时的设备像素比；HQChart 的字号、点大小按设备像素设置，像素比变化后要重新应用 */
let styleDpr = 0;
function applyStyle(dpr: number) {
  if (styleDpr === dpr) return;
  const style = H.HQChartStyle.GetStyleConfig(H.STYLE_TYPE_ID.BLACK_ID);
  // 贴近同花顺/通达信的配色：黑底、暗红网格、白色价格线
  style.UpBarColor = COLORS.up;
  style.DownBarColor = COLORS.down;
  style.UpTextColor = COLORS.up;
  style.DownTextColor = COLORS.down;
  style.FrameBorderPen = 'rgb(110,26,26)';
  style.FrameSplitPen = 'rgba(150,30,30,0.45)';
  style.FrameSplitTextColor = 'rgb(200,200,200)';
  style.FrameSplitTextFont = `${12 * dpr}px Arial`;
  style.Minute.PriceColor = 'rgb(255,255,255)';
  style.Minute.AreaPriceColor = 'rgba(0,0,0,0)';
  for (const key of ['Before', 'After'] as const) {
    style.Minute[key] = {
      ...style.Minute[key],
      BGColor: 'rgba(255,210,0,0.035)',
      LineColor: 'rgb(255,255,255)', // 竞价匹配价折线
      Point: { Color: 'rgb(255,255,255)', Radius: 1.6 * dpr },
    };
  }
  if (style.Frame?.PercentageText) style.Frame.PercentageText.Font = `${12 * dpr}px Arial`;
  style.DisableLogo = true; // HQChart 官方样式开关：不显示图框左下角的文字标识
  H.JSChart.SetStyle(style);
  styleDpr = dpr;
}

/** 当前设备像素比；拖到缩放比例不同的显示器或调整浏览器缩放时更新 */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [dpr]);
  return dpr;
}

interface Props {
  sim: Simulation;
  frame: number;
}

export function HQAuctionChart({ sim, frame }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<any>(null);
  const simRef = useRef(sim);
  simRef.current = sim;
  const dpr = useDevicePixelRatio();

  const symbol = sim.config.stock.rule === 'SSE' ? '600000.sh' : '000001.sz';

  const extWidthPx = (div: HTMLDivElement) => {
    const dpr = window.devicePixelRatio || 1;
    // 绘图区宽度减去被压缩的连续竞价区，剩下全部给竞价区
    const plot = div.offsetWidth - BORDER.Left - BORDER.Right;
    return Math.round(Math.max(100, plot - HIDDEN_MAIN) * dpr);
  };

  /** 叠加层：竞价区时间轴、9:20 线、最终开盘价 */
  const drawOverlay = () => {
    const c = chartRef.current?.JSChartContainer;
    const canvas = overlayRef.current;
    const wrap = wrapRef.current;
    if (!c || !canvas || !wrap) return;
    const s = simRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.offsetWidth;
    const h = wrap.offsetHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f0 = c.Frame?.SubFrame?.[0]?.Frame;
    const f1 = c.Frame?.SubFrame?.[1]?.Frame;
    if (!f0 || !f1) return;
    const b0 = f0.ChartBorder.GetBorder();
    const b1 = f1.ChartBorder.GetBorder();
    // 竞价区横向范围（设备像素）
    const x0: number = b0.Left;
    const x1: number = b0.LeftEx;
    if (!(x1 > x0)) return;
    const dur = s.timing.duration;
    const xOf = (t: number) => x0 + ((x1 - x0) * t) / dur;
    const top = b0.TopEx ?? b0.Top;
    const bottom = b1.BottomEx ?? b1.Bottom;
    const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px * dpr}px Arial, "Microsoft YaHei", sans-serif`;

    // 右侧坐标条：盖住残留的连续竞价区，画涨跌幅刻度
    const prevYuan = s.prevClose / 100;
    ctx.fillStyle = '#000';
    ctx.fillRect(x1 + dpr, 0, canvas.width - x1 - dpr, canvas.height);
    // 时间轴上 HQChart 自带的 09:30 文字会伸进竞价区，一并盖住
    ctx.fillRect(x1 - 26 * dpr, bottom + dpr, 26 * dpr + dpr, canvas.height - bottom);
    ctx.font = font(11);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const item of (f0.HorizontalInfo ?? []) as { Value: number }[]) {
      if (typeof item?.Value !== 'number') continue;
      const y = f0.GetYFromData(item.Value);
      if (!(y >= top - 1 && y <= b0.Bottom + 1)) continue;
      const v = Math.round(item.Value * 100);
      ctx.fillStyle = v > s.prevClose ? COLORS.up : v < s.prevClose ? COLORS.down : '#ddd';
      ctx.fillText(`${(((item.Value - prevYuan) / prevYuan) * 100).toFixed(2)}%`, x1 + 4 * dpr, y);
    }

    // 时间刻度（竞价区底部，每分钟一格）
    const tick = 60_000;
    ctx.font = font(11);
    ctx.textBaseline = 'top';
    const labels: { t: number; text: string; left: number; w: number; pri: number; deadline: boolean }[] = [];
    for (let t = 0; t <= dur; t += tick) {
      const x = Math.round(xOf(t)) + 0.5;
      const isDeadline = t === s.timing.cancelDeadline;
      ctx.strokeStyle = isDeadline ? 'rgba(247,208,0,0.7)' : 'rgba(150,30,30,0.35)';
      ctx.lineWidth = dpr;
      ctx.setLineDash(isDeadline ? [5 * dpr, 3 * dpr] : [2 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      const text = clockString(s.timing.startClock, t).slice(0, 5);
      const tw = ctx.measureText(text).width;
      // 标签可以伸进坐标条，但不能超出可见区域
      const left = Math.min(Math.max(x - tw / 2, x0), canvas.width - tw - 2 * dpr);
      // 优先级：起点 / 终点 / 9:20 > 其他
      const pri = t === 0 || t === dur || isDeadline ? 0 : 1;
      labels.push({ t, text, left, w: tw, pri, deadline: isDeadline });
    }
    // 竞价区较窄时按优先级放置标签，放不下的跳过，避免文字重叠
    const placed: { l: number; r: number }[] = [];
    const gap = 6 * dpr;
    ctx.textAlign = 'left';
    for (const lb of [...labels].sort((a, b) => a.pri - b.pri || a.t - b.t)) {
      const l = lb.left;
      const r = lb.left + lb.w;
      if (placed.some((p) => l < p.r + gap && r > p.l - gap)) continue;
      placed.push({ l, r });
      ctx.fillStyle = lb.deadline ? COLORS.yellow : 'rgb(200,200,200)';
      ctx.fillText(lb.text, l, bottom + 4 * dpr);
    }
    ctx.setLineDash([]);
    ctx.textBaseline = 'middle';
    ctx.font = font(11);
    ctx.fillStyle = 'rgba(247,208,0,0.8)';
    // 区域较窄时换用短文字
    const fitText = (options: string[], from: number, to: number) => {
      const room = to - from - 10 * dpr;
      const text = options.find((o) => ctx.measureText(o).width <= room);
      if (text) ctx.fillText(text, from + 6 * dpr, top + 10 * dpr);
    };
    const xd = xOf(s.timing.cancelDeadline);
    fitText(['可撤单'], x0, xd);
    fitText(['9:20 起不可撤单', '不可撤单'], xd, x1);

    const r = s.result;
    // 9:15 仅有一个实时点时，HQChart 把点和量柱画在左边框上。
    // 在起点内侧补画，让暂停下单的变化可见；不增加虚构的未来快照。
    if (s.t === 0 && !s.done && r.price !== null) {
      const x = x0 + 3 * dpr;
      const y = Math.max(top + 3 * dpr, Math.min(f0.GetYFromData(r.price / 100), b0.BottomEx - 3 * dpr));
      ctx.fillStyle = COLORS.priceLine;
      ctx.beginPath();
      ctx.arc(x, y, 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      const volTop = buildAuctionData(s).stock[0].before[0][5];
      const volHeight = b1.BottomEx - b1.TopEx;
      ctx.fillStyle = r.unmatchedSide === 'B' ? COLORS.up : r.unmatchedSide === 'S' ? COLORS.down : COLORS.flat;
      const matchedHeight = volHeight * r.matched / volTop;
      ctx.fillRect(x, b1.BottomEx - matchedHeight, 2 * dpr, matchedHeight);
      if (r.unmatched > 0) ctx.fillRect(x, b1.TopEx, 2 * dpr, volHeight * r.unmatched / volTop);
    }
    // 竞价结束后标出开盘价
    if (s.done && r.price !== null) {
      const y = f0.GetYFromData(r.price / 100);
      const text = `开盘 ${fmtPrice(r.price)}`;
      ctx.font = font(12, true);
      const tw = ctx.measureText(text).width + 12 * dpr;
      const bx = x1 - tw - 10 * dpr;
      const by = Math.min(Math.max(y - 10 * dpr, top + 2 * dpr), b0.BottomEx - 22 * dpr);
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(bx, by, tw, 20 * dpr);
      ctx.strokeStyle = COLORS.yellow;
      ctx.strokeRect(bx, by, tw, 20 * dpr);
      ctx.fillStyle = r.price > s.prevClose ? COLORS.up : r.price < s.prevClose ? COLORS.down : COLORS.flat;
      ctx.textAlign = 'left';
      ctx.fillText(text, bx + 6 * dpr, by + 10.5 * dpr);
    }
  };

  // 创建图表（模拟会话变化或设备像素比变化时重建，保证字号、边框与叠加层一致）
  useEffect(() => {
    const div = divRef.current;
    if (!div) return;
    applyStyle(dpr);
    div.innerHTML = '';
    const chart = H.JSChart.Init(div);
    chart.SetOption({
      Type: '分钟走势图',
      Symbol: symbol,
      IsAutoUpdate: false,
      DayCount: 1,
      IsShowRightMenu: false,
      EnableBorderDrag: false,
      DragSelectRect: { Enable: false },
      BeforeOpen: { IsShow: true, Width: extWidthPx(div) },
      AfterClose: { IsShow: false, Width: 0 },
      // 边框用 CSS 像素：HQChart 内部（AdjustChartBorder）会再乘以设备像素比；
      // 而 BeforeOpen.Width 不会被换算，所以 extWidthPx 返回的是设备像素
      Border: { Left: BORDER.Left, Right: BORDER.Right, Top: BORDER.Top, Bottom: BORDER.Bottom },
      MinuteLine: { IsShowAveragePrice: false, IsDrawAreaPrice: false },
      NetworkFilter: (data: { Name: string; PreventDefault: boolean }, callback: (d: unknown) => void) => {
        data.PreventDefault = true; // 不走 HQChart 默认的网络请求
        if (data.Name === 'MinuteChartContainer::RequestMinuteData') {
          callback(buildAuctionData(simRef.current));
          requestAnimationFrame(drawOverlay);
        }
      },
    });
    chartRef.current = chart;

    // 量柱窗口固定分成上下两半：刻度线在 底 / 中 / 顶，对应竞价量 0 / 一半 / 最大值（与主流看盘软件一致）。
    // HQChart 的竞价区量柱刻度是按这个窗口的分割线位置换算的，不固定的话中线会落在 35% 等位置
    const volSplit = chart.JSChartContainer?.Frame?.SubFrame?.[1]?.Frame?.YSplitOperator;
    if (volSplit) {
      volSplit.SplitType = 1;
      volSplit.SplitCount = 3;
      volSplit.FixedYMaxMin = { Max: 2, Min: 0 };
      chart.JSChartContainer.RequestMinuteData();
    }

    const ro = new ResizeObserver(() => {
      chart.OnSize();
      chart.JSChartContainer?.ShowCallAuctionData({ Left: true, Right: false }, { BeforeOpen: { Left: extWidthPx(div) } });
      requestAnimationFrame(drawOverlay);
    });
    ro.observe(div);
    return () => {
      ro.disconnect();
      chart.StopAutoUpdate?.();
      chart.ChartDestroy?.();
      chartRef.current = null;
      div.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, dpr]);

  // 模拟器状态变化 → 重新喂数据
  useEffect(() => {
    const c = chartRef.current?.JSChartContainer;
    if (c && typeof c.RequestMinuteData === 'function') c.RequestMinuteData();
  }, [frame, sim]);

  return (
    <div className="hq-wrap" ref={wrapRef}>
      <div className="hq-chart" ref={divRef} style={{ left: 0, right: -EXTRA }} />
      <canvas className="hq-overlay" ref={overlayRef} />
    </div>
  );
}
