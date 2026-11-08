// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Simulation } from './engine/simulation';
import { App } from './App';

// DOM 集成测试运行真实 App / 引擎 / 图表数据适配器，Canvas 绘制单独验证。
vi.mock('./ui/HQAuctionChart', async () => {
  const { buildAuctionData } = await import('./ui/auctionChartData');
  return { HQAuctionChart: ({ sim }: { sim: Simulation }) => (
    <output aria-label="竞价图数据">{JSON.stringify(buildAuctionData(sim).stock[0].before.at(-1))}</output>
  ) };
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function fill(user: ReturnType<typeof userEvent.setup>, name: string, text: string) {
  const input = screen.getByRole('textbox', { name });
  await user.clear(input);
  await user.paste(text);
}

describe('模拟器界面回归', () => {
  it('科创板 2.01 手下单、盘口金额、暂停时图表与最终成交一致', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /设置/ }));
    await user.selectOptions(screen.getByLabelText('板块 / 涨跌幅'), 'star');
    await user.selectOptions(screen.getByLabelText('背景场景'), 'empty');
    await user.click(screen.getByRole('button', { name: '应用并重新开始' }));

    await fill(user, '数量', '1');
    expect((screen.getByRole('button', { name: /买入下单/ }) as HTMLButtonElement).disabled).toBe(true);
    await fill(user, '数量', '2.01');
    await user.click(screen.getByRole('button', { name: '增加数量' }));
    expect((screen.getByLabelText('数量') as HTMLInputElement).value).toBe('2.02');
    await user.click(screen.getByRole('button', { name: '减少数量' }));
    await fill(user, '价格', '10.10');
    await user.click(screen.getByRole('button', { name: /买入下单/ }));
    await user.click(screen.getByRole('button', { name: '卖出' }));
    await fill(user, '价格', '10.00');
    await user.keyboard('{Enter}');

    const data = await screen.findByLabelText('竞价图数据');
    expect(JSON.parse(data.textContent!).slice(0, 5)).toEqual([91500, 10.05, 201, 0, 0]);
    expect(screen.getByText('≈ 2010元 · 201股')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '额' }));
    expect(localStorage.getItem('quotePanel.unit')).toBe('amt');
    expect(screen.getAllByText('2020').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /⏭ 撮合/ }));
    expect(screen.getAllByText('全部成交')).toHaveLength(2);
    expect(screen.getAllByText('2.01').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: '集合竞价已结束' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('异常昨收和种子无法应用，修正后可以正常重启', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /设置/ }));
    const dialog = screen.getByRole('dialog', { name: '模拟设置' });
    const apply = within(dialog).getByRole('button', { name: '应用并重新开始' }) as HTMLButtonElement;
    await fill(user, '昨收价（元）', '9'.repeat(310));
    expect(apply.disabled).toBe(true);
    expect(within(dialog).getByText(/昨收价须在/)).toBeTruthy();
    await fill(user, '昨收价（元）', '10.00');
    await fill(user, '随机种子', '4294967296');
    expect(apply.disabled).toBe(true);
    await fill(user, '随机种子', '42');
    expect(apply.disabled).toBe(false);
    await user.click(apply);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('可撤阶段撤单立即更新，9:20 后撤单按钮禁用', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('场景', { exact: true }), 'empty');
    await user.click(screen.getByRole('button', { name: /买入下单/ }));
    await user.click(screen.getByRole('button', { name: /我的委托/ }));
    await user.click(screen.getByRole('button', { name: '撤单' }));
    expect(screen.getByText('已撤', { exact: true })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /买入下单/ }));
    await user.click(screen.getByRole('button', { name: '⏩ 9:20' }));
    expect((screen.getByRole('button', { name: '撤单' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
