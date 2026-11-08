// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Simulation } from '../engine/simulation';
import { HQAuctionChart } from './HQAuctionChart';
import type { buildAuctionData } from './auctionChartData';

type Data = ReturnType<typeof buildAuctionData>;
const harness = vi.hoisted(() => ({ data: [] as Data[], destroy: vi.fn(), stop: vi.fn() }));
vi.mock('hqchart/lib/umychart.vue.js', () => ({ default: {
  STYLE_TYPE_ID: { BLACK_ID: 0 },
  HQChartStyle: { GetStyleConfig: () => ({ Minute: {} }) },
  JSChart: {
    SetStyle: vi.fn(),
    Init: () => {
      let filter: (request: { Name: string; PreventDefault: boolean }, callback: (data: Data) => void) => void;
      return {
        SetOption: (options: { NetworkFilter: typeof filter }) => { filter = options.NetworkFilter; },
        JSChartContainer: {
          RequestMinuteData: () => {
            const request = { Name: 'MinuteChartContainer::RequestMinuteData', PreventDefault: false };
            filter(request, (data) => harness.data.push(data));
            expect(request.PreventDefault).toBe(true);
          },
        },
        OnSize: vi.fn(), ChartDestroy: harness.destroy, StopAutoUpdate: harness.stop,
      };
    },
  },
} }));

beforeEach(() => {
  harness.data.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function simulation() {
  return new Simulation({ scenarioId: 'empty', seed: 1, snapshotSec: 3, stock: {
    code: 'SIM001', name: '模拟股份', prevClose: 1000, board: 'star', rule: 'SSE',
  } });
}

it('同一模拟实例的下单与撤单重渲染会喂入新数据，重启和卸载销毁图表', () => {
  const sim = simulation();
  const view = render(<HQAuctionChart sim={sim} frame={0} />);
  sim.placeOrder('B', 1010, 201);
  const sell = sim.placeOrder('S', 1000, 201);
  if (!sell.ok) throw new Error('申报失败');
  view.rerender(<HQAuctionChart sim={sim} frame={1} />);
  expect(harness.data.at(-1)?.stock[0].before.at(-1)?.slice(1, 4)).toEqual([10.05, 201, 0]);
  sim.cancelOrder(sell.value.id);
  view.rerender(<HQAuctionChart sim={sim} frame={2} />);
  expect(harness.data.at(-1)?.stock[0].before.at(-1)?.slice(1, 4)).toEqual([null, 0, 0]);
  view.rerender(<HQAuctionChart sim={simulation()} frame={3} />);
  expect(harness.destroy).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(harness.destroy).toHaveBeenCalledTimes(2);
  expect(harness.stop).toHaveBeenCalledTimes(2);
});
