import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  outputDir: '.playwright-mcp/browser-results',
  reporter: [['list'], ['html', { outputFolder: '.playwright-mcp/browser-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chrome-desktop', use: { channel: 'chrome', viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 } },
    { name: 'chrome-laptop', grepInvert: /暂停时切换像素密度/, use: { channel: 'chrome', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 } },
    { name: 'chrome-scaled', grepInvert: /暂停时切换像素密度/, use: { channel: 'chrome', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1.25 } },
    { name: 'chrome-phone', grepInvert: /暂停时切换像素密度/, use: { channel: 'chrome', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } },
    { name: 'edge-desktop', grepInvert: /暂停时切换像素密度/, use: { channel: 'msedge', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
