export const fmtPrice = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? '--' : (cents / 100).toFixed(2);

export function fmtChange(cents: number | null | undefined, prev: number): string {
  if (cents === null || cents === undefined) return '--';
  const d = (cents - prev) / 100;
  return `${d > 0 ? '+' : ''}${d.toFixed(2)}`;
}

export function fmtPct(cents: number | null | undefined, prev: number): string {
  if (cents === null || cents === undefined || prev <= 0) return '--';
  const p = ((cents - prev) / prev) * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;
}

/** 数量（手）格式化：≥1 万显示“x.xx万” */
export function fmtVol(lots: number | null | undefined): string {
  if (lots === null || lots === undefined) return '--';
  const a = Math.abs(lots);
  if (a >= 1e8) return `${(lots / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${(lots / 1e4).toFixed(2)}万`;
  return String(Math.round(lots));
}

/** 金额（元）格式化：千万级起用“亿”显示（如 1745.9 万 → 0.17亿），与主流看盘软件一致 */
export function fmtAmount(yuan: number): string {
  const a = Math.abs(yuan);
  if (a >= 1e7) return `${(yuan / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${(yuan / 1e4).toFixed(1)}万`;
  return yuan.toFixed(0);
}

/** 价格（分）× 数量（手）→ 金额（元） */
export const amountOf = (cents: number | null, lots: number): number => (cents === null ? 0 : cents * lots);

export function dirClass(cents: number | null | undefined, prev: number): 'up' | 'down' | 'flat' {
  if (cents === null || cents === undefined) return 'flat';
  return cents > prev ? 'up' : cents < prev ? 'down' : 'flat';
}

export function signed(n: number, f: (x: number) => string = (x) => String(x)): string {
  return n > 0 ? `+${f(n)}` : n < 0 ? `-${f(-n)}` : f(0);
}

/** 解析用户输入的价格（元）→ 分；非法返回 null */
export function parsePrice(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const v = Math.round(parseFloat(t) * 100);
  return v > 0 ? v : null;
}

export function parseQty(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const v = parseInt(t, 10);
  return v > 0 ? v : null;
}

export const COLORS = {
  bg: '#000000',
  grid: '#3a0d0d',
  gridStrong: '#6b1a1a',
  axisText: '#9a9a9a',
  up: '#ff3c3c',
  down: '#1fd65f',
  flat: '#e8e8e8',
  priceLine: '#ffffff',
  yellow: '#f7d000',
  cyan: '#33ccff',
  crosshair: '#9a9a9a',
  muted: '#707070',
};

export const dirColor = (cents: number | null | undefined, prev: number): string => {
  const d = dirClass(cents, prev);
  return d === 'up' ? COLORS.up : d === 'down' ? COLORS.down : COLORS.flat;
};
