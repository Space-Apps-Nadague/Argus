/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind IPv4 explicitly: with `true` Vite listens on IPv6 only and WSL2
    // doesn't forward Windows' 127.0.0.1 to it (VS Code browser / Windows Chrome).
    host: '0.0.0.0',
    proxy: {
      // ARGUS AI backend (server/, specs/04-ai-backend.md)
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
