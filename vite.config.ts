import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: false },
  // HQChart 为 CommonJS 包，内部 require('jquery')，需要预构建
  optimizeDeps: { include: ['hqchart', 'jquery'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
