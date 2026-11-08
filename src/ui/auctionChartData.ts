import type { Simulation, Snapshot } from '../engine/simulation';

/** 距竞价开始毫秒 → HHMMSS 整数。 */
function hhmmss(start: number, t: number): number {
  const s = start + Math.floor(t / 1000);
  return Math.floor(s / 3600) * 10000 + Math.floor((s % 3600) / 60) * 100 + s % 60;
}

function todayInt(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** HQChart 2.0 行：时间、元、匹配股数、未匹配股数、颜色、量轴上限、日期。 */
export type AuctionRow = [number, number | null, number, number, number, number, number];

/** 纯数据适配器。历史快照不变，实时点在下单、撤单或推进时更新。 */
export function buildAuctionData(s: Simulation, date = todayInt()) {
  const series: Snapshot[] = [...s.snapshots];
  const r = s.result;
  const last = series[series.length - 1];
  const live = { price: r.price, matched: r.matched, unmatched: r.unmatched, unmatchedSide: r.unmatchedSide };
  if (last && s.t === last.t) {
    // 初始时刻或暂停在快照边界下单：替换展示点，不改写已记录的历史。
    series[series.length - 1] = { t: last.t, ...live };
  } else if (!s.done && last && s.t > last.t) {
    // HQChart 需要等间隔网格；实时点使用下一个网格位置，随后由快照替换。
    const nextT = last.t + s.snapshotMs;
    if (nextT <= s.timing.duration) series.push({ t: nextT, ...live });
  }
  let maxVol = 1;
  for (const x of series) maxVol = Math.max(maxVol, x.matched + x.unmatched);
  const volTop = niceCeil(maxVol * 1.05);
  const rows: AuctionRow[] = series.map((x) => [
    hhmmss(s.timing.startClock, x.t), x.price === null ? null : x.price / 100,
    x.matched, x.unmatched, x.unmatchedSide === 'B' ? 1 : x.unmatchedSide === 'S' ? 2 : 0,
    volTop, date,
  ]);
  const priceNow = (r.price ?? s.prevClose) / 100;
  return {
    stock: [{
      name: s.config.stock.name,
      symbol: s.config.stock.rule === 'SSE' ? '600000.sh' : '000001.sz',
      yclose: s.prevClose / 100,
      price: priceNow, open: priceNow, high: priceNow, low: priceNow,
      vol: 0, amount: 0, date, time: hhmmss(s.timing.startClock, s.t), minute: [],
      before: rows,
      beforeinfo: {
        ver: 2.0, totalcount: rows.length,
        TimeConfig: {
          AryTime: [{ Start: hhmmss(s.timing.startClock, 0), End: hhmmss(s.timing.startClock, s.timing.duration), Date: date }],
          Step: s.config.snapshotSec,
        },
      },
    }],
    code: 0, AutoUpdate: false,
  };
}
