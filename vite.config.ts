/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // ARGUS AI backend (server/, specs/03-ai-backend.md)
      '/api': {
        target: `http://127.0.0.1:${process.env.ARGUS_SERVER_PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    // Local agent worktrees (e.g. .claude/worktrees/*) are other checkouts, not this project's tests.
    exclude: [...configDefaults.exclude, '.claude/**', '.agents/**'],
  },
});
