/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

function localFrontendOutput(): string | undefined {
  if (process.env.WGT_FRONTEND_DIST?.trim()) {
    return resolve(process.env.WGT_FRONTEND_DIST.trim());
  }
  const configPath = resolve(dirname(fileURLToPath(import.meta.url)), '.wgt-local.json');
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { cacheRoot?: unknown };
    if (typeof config.cacheRoot !== 'string' || !config.cacheRoot.trim()) return undefined;
    const cacheRoot = resolve(config.cacheRoot.trim()).replace(/[\\/]+$/, '');
    for (const retired of ['D:\\Dev', 'D:\\DevCache']) {
      if (cacheRoot.toLowerCase() === retired.toLowerCase()
        || cacheRoot.toLowerCase().startsWith(`${retired.toLowerCase()}\\`)) {
        throw new Error(`拒绝使用已退役的项目根：${retired}`);
      }
    }
    return resolve(cacheRoot, 'frontend');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('拒绝使用已退役')) throw error;
    return undefined;
  }
}

// base 使用相对路径，方便直接部署到 GitHub Pages 的任意子路径。
export default defineConfig({
  plugins: [react(), webContentSecurityPolicy()],
  base: './',
  define: {
    __WGT_BUILD_ID__: JSON.stringify(process.env.WGT_BUILD_ID?.trim() || 'development'),
    __WGT_BUILD_COMMIT__: JSON.stringify(process.env.WGT_BUILD_COMMIT?.trim() || 'uncommitted'),
    __WGT_BUILD_TIME__: JSON.stringify(process.env.WGT_BUILD_TIME?.trim() || ''),
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    ...(localFrontendOutput()
      ? { outDir: localFrontendOutput(), emptyOutDir: true }
      : {}),
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
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: false,
  },
});
