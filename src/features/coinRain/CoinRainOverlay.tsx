import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';

interface Coin {
  x: number;
  y: number;
  vy: number;
  vx: number;
  size: number;
  rotation: number;
  vr: number;
  alpha: number;
}

const INTENSITY_COUNT = { off: 0, low: 24, medium: 48, high: 80 } as const;

/**
 * 金币雨庆祝动画（canvas + requestAnimationFrame）。
 * - 遵循 prefers-reduced-motion：动画被禁用时直接不渲染。
 * - 组件卸载时清理 RAF，避免泄漏。
 * - 约 5 秒后自动结束。
 */
export function CoinRainOverlay() {
  const active = useAppStore((s) => s.coinRainActive);
  const stop = useAppStore((s) => s.stopCoinRain);
  const config = useAppStore((s) => s.coinRainConfig);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const coinsRef = useRef<Coin[]>([]);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!active) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      // 减少动效偏好：短暂显示后直接结束，不做逐帧动画。
      const t = setTimeout(stop, 800);
      return () => clearTimeout(t);
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const count = INTENSITY_COUNT[configRef.current.intensity];
    coinsRef.current = Array.from({ length: count }, () => spawnCoin(window.innerWidth, window.innerHeight));

    const start = performance.now();
    const duration = 5000;

    const frame = (now: number) => {
      const elapsed = now - start;
      if (elapsed > duration) {
        stop();
        return;
      }
      const cfg = configRef.current;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const wind = cfg.windStrength - 0.5; // -0.5..0.5
      for (const c of coinsRef.current) {
        c.vy += 0.25;
        c.vx += wind * 0.04;
        c.x += c.vx;
        c.y += c.vy;
        c.rotation += c.vr;
        const ground = window.innerHeight - c.size;
        if (c.y >= ground) {
          c.y = ground;
          c.vy = -c.vy * cfg.bounceFactor;
          if (Math.abs(c.vy) < 0.8) c.vy = 0;
        }
        // 尾部淡出
        if (elapsed > duration - 1200) {
          c.alpha = Math.max(0, (duration - elapsed) / 1200);
        }
        drawCoin(ctx, c);
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [active, stop]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[70] pointer-events-none" role="presentation" aria-hidden>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

function spawnCoin(w: number, h: number): Coin {
  const size = 18 + Math.random() * 22;
  return {
    x: Math.random() * w,
    y: -size - Math.random() * h * 0.6,
    vy: 2 + Math.random() * 3,
    vx: (Math.random() - 0.5) * 1.5,
    size,
    rotation: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.15,
    alpha: 1,
  };
}

function drawCoin(ctx: CanvasRenderingContext2D, c: Coin) {
  ctx.save();
  ctx.globalAlpha = c.alpha;
  ctx.translate(c.x, c.y);
  ctx.rotate(c.rotation);
  // 金币主体（旋转时压扁成椭圆，模拟 3D 翻转）
  const scaleX = Math.abs(Math.cos(c.rotation));
  ctx.beginPath();
  ctx.ellipse(0, 0, c.size * (0.3 + 0.7 * scaleX), c.size, 0, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(0, -c.size * 0.3, c.size * 0.1, 0, 0, c.size);
  grad.addColorStop(0, '#ffe08a');
  grad.addColorStop(0.7, '#f5b700');
  grad.addColorStop(1, '#c98a00');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#a06b00';
  ctx.stroke();
  // 内圈
  ctx.beginPath();
  ctx.ellipse(0, 0, c.size * 0.55 * (0.3 + 0.7 * scaleX), c.size * 0.55, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(160,107,0,0.5)';
  ctx.stroke();
  ctx.restore();
}
