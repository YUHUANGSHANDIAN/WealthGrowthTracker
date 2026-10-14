/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// 生产 Web 构建注入受限 CSP：不允许内联脚本/eval，联网仅限本应用、HTTPS 网关与本地回环端点。
// （开发服务器不注入，避免影响 HMR。）
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.github.com https: http://localhost:* http://127.0.0.1:* http://[::1]:*",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join('; ');

function webContentSecurityPolicy(): Plugin {
  return {
    name: 'wealth-web-csp',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: WEB_CSP }, injectTo: 'head-prepend' }];
    },
  };
}

// base 使用相对路径，方便直接部署到 GitHub Pages 的任意子路径。
export default defineConfig({
  plugins: [react(), webContentSecurityPolicy()],
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
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: false,
  },
});
