// @vitest-environment jsdom
import { expect, it } from 'vitest';
import HQChart from 'hqchart/lib/umychart.vue.js';

it('锁定版本的 HQChart 独立图形入口提供封装需要的公共 API', () => {
  const chart = HQChart.default ?? HQChart;
  expect(typeof chart.JSChart.Init).toBe('function');
  expect(typeof chart.JSChart.SetStyle).toBe('function');
  expect(typeof chart.HQChartStyle.GetStyleConfig).toBe('function');
  const style = chart.HQChartStyle.GetStyleConfig(chart.STYLE_TYPE_ID.BLACK_ID);
  expect(style.Minute).toBeDefined();
});
