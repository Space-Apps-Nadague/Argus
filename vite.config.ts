/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  test: {
    // Local agent worktrees (e.g. .claude/worktrees/*) are other checkouts, not this project's tests.
    exclude: [...configDefaults.exclude, '.claude/**', '.agents/**'],
  },
});
