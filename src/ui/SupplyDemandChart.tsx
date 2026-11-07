import { useEffect, useState, type MouseEvent } from 'react';
import type { DepthIndex } from '../engine/auction';
import type { PreviewResult, Simulation } from '../engine/simulation';
import { COLORS, fmtPrice, fmtVol } from './format';
import { crisp, dashedLine, useCanvas } from './useCanvas';

interface Props {
  sim: Simulation;
  frame: number;
  preview: PreviewResult | null;
  onPickPrice: (cents: number) => void;
}

const PAD = { l: 64, r: 20, t: 26, b: 26 };

/**
 * 供需曲线：
 *  需求曲线 D(p) = 价格 ≥ p 的累计买单（随价格升高而减少）
 *  供给曲线 S(p) = 价格 ≤ p 的累计卖单（随价格升高而增加）
 *  可成交量 V(p) = min(D, S)，集合竞价价格就是使 V 最大的那个价格
 */
export function SupplyDemandChart({ sim, frame, preview, onPickPrice }: Props) {
  const { wrapRef, canvasRef, size, getCtx } = useCanvas();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const idx = sim.depth;
  const r = sim.result;
  const prev = sim.prevClose;

  // 价格范围
  const prices: number[] = [];
  if (idx.levels.length) prices.push(idx.levels[0].price, idx.levels[idx.levels.length - 1].price);
  if (preview) {
    const pl = preview.depth.levels;
    if (pl.length) prices.push(pl[0].price, pl[pl.length - 1].price);
  }
  prices.push(prev);
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  const padTicks = Math.max(3, Math.round((hi - lo) * 0.05));
  lo = Math.max(sim.lower, lo - padTicks);
  hi = Math.min(sim.upper, hi + padTicks);
  if (hi <= lo) hi = lo + 1;

  let maxQ = Math.max(1, idx.totalBuy, idx.totalSell);
  if (preview) maxQ = Math.max(maxQ, preview.depth.totalBuy, preview.depth.totalSell);

  const plotW = Math.max(10, size.w - PAD.l - PAD.r);
  const plotH = Math.max(10, size.h - PAD.t - PAD.b);
  const xOf = (p: number) => PAD.l + ((p - lo) / (hi - lo)) * plotW;
  const pOf = (x: number) => Math.round(lo + ((x - PAD.l) / plotW) * (hi - lo));
  const yOf = (q: number) => PAD.t + (1 - q / maxQ) * plotH;

  useEffect(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const { w, h } = size;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '11px Arial, "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';

    // 网格
    ctx.strokeStyle = COLORS.grid;
    for (let k = 0; k <= 4; k++) {
      const y = crisp(PAD.t + (plotH * k) / 4);
      dashedLine(ctx, PAD.l, y, PAD.l + plotW, y, [2, 3]);
      ctx.fillStyle = COLORS.axisText;
      ctx.textAlign = 'right';
      ctx.fillText(fmtVol(maxQ * (1 - k / 4)), PAD.l - 5, y);
    }
    const nTicks = Math.min(8, hi - lo);
    ctx.textAlign = 'center';
    for (let k = 0; k <= nTicks; k++) {
      const p = Math.round(lo + ((hi - lo) * k) / nTicks);
      const x = crisp(xOf(p));
      ctx.strokeStyle = COLORS.grid;
      dashedLine(ctx, x, PAD.t, x, PAD.t + plotH, [2, 3]);
      ctx.fillStyle = p > prev ? COLORS.up : p < prev ? COLORS.down : COLORS.flat;
      ctx.fillText(fmtPrice(p), x, PAD.t + plotH + 13);
    }
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.strokeRect(crisp(PAD.l), crisp(PAD.t), Math.round(plotW), Math.round(plotH));

    const drawCurves = (d: DepthIndex, dashed: boolean) => {
      const step = Math.max(1, Math.floor((hi - lo) / (plotW * 1.5)));
      const ptsB: [number, number][] = [];
      const ptsS: [number, number][] = [];
      const ptsV: [number, number][] = [];
      for (let p = lo; p <= hi; p += step) {
        const e = d.evaluate(p);
        ptsB.push([xOf(p), yOf(e.buyGE)]);
        ptsS.push([xOf(p), yOf(e.sellLE)]);
        ptsV.push([xOf(p), yOf(e.volume)]);
      }
      if (!dashed) {
        ctx.fillStyle = 'rgba(247, 208, 0, 0.16)';
        ctx.beginPath();
        ctx.moveTo(xOf(lo), yOf(0));
        for (const [x, y] of ptsV) ctx.lineTo(x, y);
        ctx.lineTo(xOf(hi), yOf(0));
        ctx.closePath();
        ctx.fill();
      }
      const stroke = (pts: [number, number][], color: string) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = dashed ? 1.2 : 1.6;
        if (dashed) ctx.setLineDash([5, 3]);
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x, y);
          else {
            ctx.lineTo(x, pts[i - 1][1]);
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();
        ctx.restore();
      };
      stroke(ptsB, dashed ? '#ff9a9a' : COLORS.up);
      stroke(ptsS, dashed ? '#9affb8' : COLORS.down);
    };
    drawCurves(idx, false);
    if (preview) drawCurves(preview.depth, true);

    // 昨收、参考价竖线
    const vline = (p: number, color: string, label: string, dash: number[], row: number) => {
      const x = crisp(xOf(p));
      ctx.strokeStyle = color;
      dashedLine(ctx, x, PAD.t, x, PAD.t + plotH, dash);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, row === 0 ? PAD.t - 8 : PAD.t + plotH - 10);
    };
    vline(prev, '#888', '昨收', [2, 2], 0);
    if (r.price !== null) vline(r.price, '#ffffff', `参考价 ${fmtPrice(r.price)}`, [5, 3], 0);
    if (preview && preview.result.price !== null && preview.result.price !== r.price) {
      vline(preview.result.price, COLORS.cyan, `下单后 ${fmtPrice(preview.result.price)}`, [5, 3], 1);
    }

    // 图例
    ctx.textAlign = 'left';
    const legend: [string, string][] = [
      [COLORS.up, '红线：累计买量（出价不低于该价的买单）'],
      [COLORS.down, '绿线：累计卖量（要价不高于该价的卖单）'],
      [COLORS.yellow, '黄色区域：该价能成交的量'],
    ];
    if (preview) legend.push([COLORS.cyan, '虚线：下单后的样子']);
    let lx = PAD.l + 8;
    for (const [c, t] of legend) {
      ctx.fillStyle = c;
      ctx.fillRect(lx, PAD.t + 8, 10, 3);
      ctx.fillStyle = '#bbb';
      ctx.fillText(t, lx + 14, PAD.t + 10);
      lx += ctx.measureText(t).width + 30;
    }

    // 悬停
    if (hoverX !== null && hoverX >= PAD.l && hoverX <= PAD.l + plotW) {
      const p = Math.min(hi, Math.max(lo, pOf(hoverX)));
      const x = crisp(xOf(p));
      ctx.strokeStyle = COLORS.crosshair;
      dashedLine(ctx, x, PAD.t, x, PAD.t + plotH, [3, 3]);
      const e = idx.evaluate(p);
      const lines = [
        `价格 ${fmtPrice(p)}`,
        `累计买 ${fmtVol(e.buyGE)}  累计卖 ${fmtVol(e.sellLE)}`,
        `能成交 ${fmtVol(e.volume)}  ${e.feasible ? '可作为成交价' : e.volume > 0 ? '不能作为成交价' : ''}`,
      ];
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
      const bx = x + 8 + bw > PAD.l + plotW ? x - 8 - bw : x + 8;
      const by = PAD.t + 26;
      ctx.fillStyle = 'rgba(20,28,45,0.92)';
      ctx.fillRect(bx, by, bw, lines.length * 16 + 8);
      ctx.strokeStyle = '#4a6aa0';
      ctx.strokeRect(crisp(bx), crisp(by), Math.round(bw), lines.length * 16 + 8);
      ctx.fillStyle = '#fff';
      lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 12 + i * 16));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, size, hoverX, preview, sim]);

  const onMove = (e: MouseEvent<HTMLCanvasElement>) => setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left);
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (x >= PAD.l && x <= PAD.l + plotW) onPickPrice(Math.min(hi, Math.max(lo, pOf(x))));
  };

  return (
    <div className="sd-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setHoverX(null)} onClick={onClick} />
    </div>
  );
}
