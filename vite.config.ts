/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    include: ['engine/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
