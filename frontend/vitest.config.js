import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react({ jsxRuntime: 'automatic' })],
  test: {
    environment: 'jsdom',
    include: ['test/components/**/*.test.jsx'],
    setupFiles: ['./vitest.setup.js'],
    restoreMocks: true,
  },
});
