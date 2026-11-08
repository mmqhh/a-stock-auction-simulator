import { test, expect, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function paint(page: Page, selector = '.hq-chart canvas') {
  await expect(page.locator(selector)).toBeVisible();
  await page.waitForFunction((selector) => {
    const canvas = document.querySelector<HTMLCanvasElement>(selector);
    return canvas && canvas.width > 100 && canvas.height > 100;
  }, selector);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function screenshot(page: Page, info: TestInfo, name: string, session?: CDPSession) {
  const dir = join('.playwright-mcp', 'visual-qa', 'final', info.project.name);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${name}.png`);
  // 仅截图时隐藏短暂浮层，避免遮住本次要核验的图表或表格。
  if (session) {
    // 保留运行中覆写的 DPR；常规 screenshot 会用 Page 原来的 viewport 配置恢复截图视口。
    const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(file, Buffer.from(data, 'base64'));
  } else {
    await page.screenshot({ path: file, animations: 'disabled', style: '.toasts { visibility: hidden; }' });
  }
  await info.attach(name, { path: file, contentType: 'image/png' });
}

async function containedChildren(page: Page, selector: string) {
  const clipped = await page.locator(selector).evaluate((el) => {
    const outer = el.getBoundingClientRect();
    return [...el.children].filter((child) => {
      const rect = child.getBoundingClientRect();
      return rect.width > 0 && (rect.left < outer.left - 1 || rect.right > outer.right + 1 || rect.bottom > outer.bottom + 1);
    }).map((child) => child.textContent);
  });
  expect(clipped).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('/', { waitUntil: 'networkidle' });
  await paint(page);
  // 每项场景结束都检查实际浏览器异常和失败资源。
  test.info().annotations.push({ type: 'browser', description: await page.context().browser()!.version() });
  (page as Page & { qaErrors: string[] }).qaErrors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { qaErrors: string[] }).qaErrors).toEqual([]);
});

test('真实图表、图例、深度栏和窄屏设置可见', async ({ page }, info) => {
  await page.getByRole('button', { name: '⏩ 9:20', exact: true }).click();
  await paint(page);
  await containedChildren(page, '.depth-head');
  await screenshot(page, info, '01-locked-depth');
  await page.getByRole('button', { name: '供需曲线', exact: true }).click();
  await page.locator('.sd-panel').scrollIntoViewIfNeeded();
  await paint(page, '.sd-wrap canvas');
  await containedChildren(page, '.sd-legend');
  await screenshot(page, info, '02-supply-demand');
  const paintedPixels = await page.locator('.sd-wrap canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] > 150 && data[i + 1] < 80) || (data[i + 1] > 150 && data[i] < 80)) colored++;
    return colored;
  });
  expect(paintedPixels).toBeGreaterThan(100);
  await page.getByRole('button', { name: '⚙ 设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模拟设置' });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await screenshot(page, info, '03-settings');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('科创板输入、暂停点、锁单和最终成交在真实 Canvas 上同步', async ({ page }, info) => {
  await page.getByRole('button', { name: '⚙ 设置', exact: true }).click();
  await page.getByLabel('昨收价（元）', { exact: true }).fill('9'.repeat(310));
  await expect(page.getByRole('button', { name: '应用并重新开始' })).toBeDisabled();
  await page.getByLabel('昨收价（元）', { exact: true }).fill('10.00');
  await page.getByLabel('随机种子', { exact: true }).fill('4294967296');
  await expect(page.getByRole('button', { name: '应用并重新开始' })).toBeDisabled();
  await page.getByLabel('随机种子', { exact: true }).fill('42');
  await page.getByLabel('板块 / 涨跌幅', { exact: true }).selectOption('star');
  await page.getByLabel('背景场景', { exact: true }).selectOption('empty');
  await page.getByRole('button', { name: '应用并重新开始' }).click();
  await page.getByLabel('数量', { exact: true }).fill('1');
  await expect(page.getByRole('button', { name: '买入下单（回车）', exact: true })).toBeDisabled();
  await page.getByLabel('数量', { exact: true }).fill('2.01');
  await page.getByLabel('价格', { exact: true }).fill('10.10');
  await page.getByRole('button', { name: '买入下单（回车）', exact: true }).click();
  await page.getByRole('button', { name: '卖出', exact: true }).click();
  await page.getByLabel('价格', { exact: true }).fill('10.00');
  await page.getByLabel('价格', { exact: true }).press('Enter');
  await expect(page.locator('.tb-last')).toHaveText('10.05');
  await expect(page.locator('.tb-time')).toHaveText('09:15:00');
  await paint(page);
  // 截图之外检查真实叠加层像素，避免只有正确数据而首个点不可见。
  const markerPixels = await page.locator('.hq-overlay').evaluate((element) => {
    const canvas = element as HTMLCanvasElement, dpr = devicePixelRatio;
    const data = canvas.getContext('2d')!.getImageData(Math.floor(64 * dpr), Math.floor(26 * dpr), Math.ceil(10 * dpr), Math.ceil(10 * dpr)).data;
    let white = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200 && data[i + 3] > 128) white++;
    return white;
  });
  expect(markerPixels).toBeGreaterThan(3);
  await page.locator('.hq-wrap').scrollIntoViewIfNeeded();
  await screenshot(page, info, '04-star-paused');
  await page.getByRole('button', { name: '额', exact: true }).click();
  await expect(page.locator('.q-book .q-qty').filter({ hasText: /^2020$/ })).toHaveCount(2);
  await page.getByRole('button', { name: /我的委托/ }).click();
  await containedChildren(page, '.depth-head');
  await page.getByRole('button', { name: '撤单', exact: true }).first().click();
  await expect(page.locator('.tb-last')).toHaveText('--');
  await page.getByRole('button', { name: '卖出下单（回车）', exact: true }).click();
  await expect(page.locator('.tb-last')).toHaveText('10.05');
  await page.getByRole('button', { name: '⏩ 9:20', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤单', exact: true }).first()).toBeDisabled();
  await page.getByRole('button', { name: '买入', exact: true }).click();
  await page.getByLabel('价格', { exact: true }).fill('10.10');
  await page.getByRole('button', { name: '买入下单（回车）', exact: true }).click();
  await expect(page.locator('.tb-last')).toHaveText('10.10');
  await paint(page);
  await screenshot(page, info, '05-star-locked');
  await page.getByRole('button', { name: '⏭ 撮合', exact: true }).click();
  await expect(page.locator('.tb-time')).toHaveText('09:25:00');
  await expect(page.getByText('全部成交', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '集合竞价已结束', exact: true })).toBeDisabled();
  await page.locator('.done-banner').scrollIntoViewIfNeeded();
  await paint(page);
  await screenshot(page, info, '06-star-done');
});

test('背景关闭、播放暂停和诱单场景完成', async ({ page }, info) => {
  await page.getByLabel('场景', { exact: true }).selectOption('spoof');
  await page.getByLabel('活跃度', { exact: true }).fill('0');
  const initial = await page.locator('.q-god').textContent();
  await page.getByRole('button', { name: '⏩ 9:20', exact: true }).click();
  await expect(page.locator('.q-god')).toHaveText(initial!);
  await page.getByLabel('活跃度', { exact: true }).fill('1');
  await page.getByRole('button', { name: '↺ 重来', exact: true }).click();
  await page.getByRole('button', { name: '60x', exact: true }).click();
  await page.getByRole('button', { name: '▶ 开始', exact: true }).click();
  await expect(page.locator('.tb-time')).not.toHaveText('09:15:00');
  await page.getByRole('button', { name: '❚❚ 暂停', exact: true }).click();
  await expect(page.getByRole('button', { name: '▶ 继续', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '⏭ 撮合', exact: true }).click();
  await page.getByRole('button', { name: '逐笔委托', exact: true }).click();
  await page.getByLabel('只看大单', { exact: true }).check();
  await containedChildren(page, '.depth-head');
  await page.locator('.hq-wrap').scrollIntoViewIfNeeded();
  await paint(page);
  await screenshot(page, info, '07-spoof-done');
});

test('暂停时切换像素密度，两张 Canvas 都保持清晰', async ({ page }, info) => {
  test.skip(info.project.name !== 'chrome-desktop', '只需在一个独立会话中检查运行时切换');
  await page.getByRole('button', { name: '⏩ 9:20', exact: true }).click();
  await page.getByRole('button', { name: '供需曲线', exact: true }).click();
  await paint(page, '.sd-wrap canvas');
  const session = await page.context().newCDPSession(page);
  // 显示缩放同时改变 CSS 视口。单独覆写 CDP 的 DPR 不会触发 Chrome 的媒体查询事件。
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 800, deviceScaleFactor: 1.25, mobile: false,
  });
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(1.25);
  for (const selector of ['.hq-overlay', '.sd-wrap canvas']) {
    await expect.poll(() => page.locator(selector).evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return Math.abs(canvas.width - Math.floor(canvas.getBoundingClientRect().width) * devicePixelRatio);
    })).toBeLessThanOrEqual(1);
  }
  await screenshot(page, info, '08-density-change', session);
});
