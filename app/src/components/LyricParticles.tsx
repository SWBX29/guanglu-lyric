import { useEffect, useRef } from 'react';

export interface ParticleTargets {
  /** 旧行当前位置（散出源），可为 null */
  from: DOMRect | null;
  /** 新行最终落点（聚合目标），可为 null */
  to: DOMRect | null;
}

interface Props {
  /** 变化即触发一次聚合/散开（传 currentLine 即可） */
  burstKey: number;
  getTargets: () => ParticleTargets;
  disabled?: boolean;
}

interface Particle {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
  delay: number; // 0..0.2，归一化时间轴上的错峰
  scatter: boolean;
}

const DURATION = 720; // ms，0.6-0.8s 区间
const SCATTER_N = 20;
const GATHER_N = 28;

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return [255, 217, 138];
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * 歌词行切换瞬间的粒子聚合/散开层。
 * - 只在 burstKey 变化时跑一段 rAF（~0.72s），结束后清空画布并停止循环，稳态零开销
 * - 旧行位置散出小光点，新行落点处粒子聚合
 */
export function LyricParticles({ burstKey, getTargets, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const targetsRef = useRef(getTargets);
  targetsRef.current = getTargets;

  useEffect(() => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const cRect = canvas.getBoundingClientRect();
    const { from, to } = targetsRef.current();
    if (!from && !to) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(cRect.width * dpr));
    canvas.height = Math.max(1, Math.round(cRect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';

    const glowRaw = getComputedStyle(document.documentElement).getPropertyValue('--lyric-glow');
    const [r, g, b] = hexToRgb(glowRaw || '#ffd98a');

    const toLocal = (rect: DOMRect) => ({
      x: rect.left - cRect.left,
      y: rect.top - cRect.top,
      w: rect.width,
      h: rect.height,
    });

    const particles: Particle[] = [];

    if (from) {
      const f = toLocal(from);
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      for (let i = 0; i < SCATTER_N; i++) {
        const px = f.x + Math.random() * f.w;
        const py = f.y + Math.random() * f.h;
        // 沿远离行中心的方向散出，带随机扰动
        const base = Math.atan2(py - cy, px - cx);
        const ang = base + rand(-0.9, 0.9);
        const dist = rand(36, 92);
        particles.push({
          x0: px,
          y0: py,
          x1: px + Math.cos(ang) * dist,
          y1: py + Math.sin(ang) * dist - rand(0, 18),
          size: rand(1.2, 2.8),
          delay: rand(0, 0.12),
          scatter: true,
        });
      }
    }

    if (to) {
      const t = toLocal(to);
      for (let i = 0; i < GATHER_N; i++) {
        const ex = t.x + Math.random() * t.w;
        const ey = t.y + Math.random() * t.h;
        const ang = Math.random() * Math.PI * 2;
        const dist = rand(46, 130);
        particles.push({
          x0: ex + Math.cos(ang) * dist,
          y0: ey + Math.sin(ang) * dist,
          x1: ex,
          y1: ey,
          size: rand(1.2, 3),
          delay: rand(0, 0.18),
          scatter: false,
        });
      }
    }

    if (!particles.length) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / DURATION;
      ctx.clearRect(0, 0, cRect.width, cRect.height);
      if (t >= 1) {
        rafRef.current = 0;
        return; // 结束即停，稳态零 rAF
      }
      for (const p of particles) {
        const lt = Math.min(1, Math.max(0, (t - p.delay) / (1 - p.delay)));
        if (lt <= 0) continue;
        const e = easeOutCubic(lt);
        const x = p.x0 + (p.x1 - p.x0) * e;
        const y = p.y0 + (p.y1 - p.y0) * e;
        let alpha: number;
        if (p.scatter) {
          alpha = 0.9 * (1 - lt);
        } else {
          // 聚合：先淡入，抵达后微微淡出，避免盖住文字
          const fadeIn = Math.min(1, lt / 0.2);
          const fadeOut = lt > 0.82 ? 1 - ((lt - 0.82) / 0.18) * 0.85 : 1;
          alpha = 0.95 * fadeIn * fadeOut;
        }
        if (alpha <= 0.01) continue;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      ctx.clearRect(0, 0, cRect.width, cRect.height);
    };
  }, [burstKey, disabled]);

  // unmount 兜底清理
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return <canvas ref={canvasRef} className="lyric-particles" aria-hidden="true" />;
}
