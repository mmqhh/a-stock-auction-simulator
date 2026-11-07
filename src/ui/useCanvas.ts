import { useEffect, useRef, useState } from 'react';

/** 跟随容器尺寸的高清 Canvas */
export function useCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 准备好绘图上下文（已按 devicePixelRatio 缩放），尺寸为 0 时返回 null */
  const getCtx = (): CanvasRenderingContext2D | null => {
    const c = canvasRef.current;
    if (!c || size.w === 0 || size.h === 0) return null;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(size.w * dpr);
    const ph = Math.round(size.h * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
      c.style.width = `${size.w}px`;
      c.style.height = `${size.h}px`;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

  return { wrapRef, canvasRef, size, getCtx };
}

export function dashedLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, dash: number[] = [3, 3]) {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** 0.5 像素对齐，保证 1px 线条清晰 */
export const crisp = (v: number) => Math.round(v) + 0.5;
