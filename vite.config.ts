/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 使用相对路径，方便直接部署到 GitHub Pages 的任意子路径。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 手动拆包，把 React 运行时与业务代码分离，利于缓存。
        manualChunks: {
          react: ['react', 'react-dom'],
          zustand: ['zustand'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: false,
  },
});
