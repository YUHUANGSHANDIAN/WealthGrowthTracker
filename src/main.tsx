import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// PWA：仅在 Web 分发（非 Tauri）且生产构建时注册 Service Worker，
// 避免 Tauri 内旧 JS 长期缓存问题。业务数据只在 storage service，不进 Cache Storage。
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
if (!isTauri && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 注册失败不阻断应用 */
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
