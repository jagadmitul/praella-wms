import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Component tests run in jsdom against the real components.
 *
 * Server Components and Server Actions are not exercised here — those are
 * covered end to end by the API integration suite and by driving the running
 * app in a browser. What is worth testing in isolation is the client-side
 * logic: permission-gated rendering, line-item maths, and the formatters that
 * turn API strings into what a user actually reads.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
