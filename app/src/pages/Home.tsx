import { useEffect, useRef, useState, useCallback } from 'react';
import { VoxelWorld } from '../scene/VoxelWorld';
import { AudioEngine } from '../audio/AudioEngine';
import { parseLRC, plainToLyrics, type LyricLine } from '../lib/lrc';
import { THEMES } from '../lib/themes';
import { QUALITY_LABELS, loadQualityChoice, resolveQuality, saveQualityChoice, type QualityChoice } from '../lib/quality';
import { trpc } from '@/providers/trpc';
import type { NeteaseSong } from '../../contracts/types';
import { NeteasePanel } from '@/components/NeteasePanel';
import { LyricParticles, type ParticleTargets } from '@/components/LyricParticles';
import { Button } from '@/components/ui/button';
import { Play, Pause, Music, FileText, Sparkles, Upload, Loader2, Music2, X, PanelRightClose, PanelRightOpen, CloudSun, Sun, Flower2, CloudRain, Leaf, Wind, Snowflake, CloudSnow, Gauge, Volume2, VolumeX } from 'lucide-react';

/** 歌词 UI 提前量（秒）：高亮/滚动/卡拉OK扫光提前点亮，歌词时间轴与 seek 不变 */
const LOOKAHEAD = 0.4;

/** 天气二级菜单：mode 与 VoxelWorld.setWeather 契约一致 */
const WEATHER_OPTIONS = [
  { mode: 'auto', label: '自动', Icon: CloudSun },
  { mode: 'clear', label: '晴朗', Icon: Sun },
  { mode: 'petals', label: '花瓣', Icon: Flower2 },
  { mode: 'rain', label: '细雨', Icon: CloudRain },
  { mode: 'leaves', label: '落叶', Icon: Leaf },
  { mode: 'wind', label: '阵风', Icon: Wind },
  { mode: 'snow', label: '雪', Icon: Snowflake },
  { mode: 'snowstorm', label: '暴雪', Icon: CloudSnow },
] as const;
type WeatherMode = (typeof WEATHER_OPTIONS)[number]['mode'];

/**
 * 通用右上角下拉控件：触发按钮 + chips 二级菜单。
 * 支持点击外部 / Esc 关闭（原先天气菜单只能再点按钮或选中才收起）。
 */
function ControlMenu<T extends string>({
  value,
  options,
  onSelect,
  triggerIcon,
  triggerTitle,
  align = 'right',
}: {
  value: T;
  options: readonly { value: T; label: string; Icon?: React.ComponentType<{ className?: string }> }[];
  onSelect: (v: T) => void;
  triggerIcon: React.ReactNode;
  triggerTitle: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm backdrop-blur transition ${
          open
            ? 'border-amber-200/60 bg-amber-100/15 text-amber-100'
            : 'border-white/10 bg-black/40 text-white/55 hover:text-white/85'
        }`}
      >
        {triggerIcon}
        {current.label}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-[calc(100%+6px)] z-30 flex max-h-[min(60vh,16rem)] max-w-[min(88vw,320px)] flex-wrap gap-1.5 overflow-y-auto rounded-2xl border border-white/10 bg-black/85 p-2 shadow-2xl backdrop-blur [scrollbar-width:none] ${
            align === 'right' ? 'right-0 justify-end' : 'left-0'
          }`}
        >
          {options.map(({ value: v, label, Icon }) => (
            <button
              key={v}
              role="menuitemradio"
              aria-checked={value === v}
              onClick={() => {
                onSelect(v);
                setOpen(false);
              }}
              title={label}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition ${
                value === v
                  ? 'border-amber-200/60 bg-amber-100/15 text-amber-100'
                  : 'border-white/10 bg-white/5 text-white/55 hover:text-white/85'
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SAMPLE_LYRICS = `[00:02]沿着微光铺成的小路[00:08]一步一步走向清晨的雾
[00:14]像素的花开在脚边
[00:20]风把星光吹成了碎片
[00:26]世界安静得像一幅画
[00:32]你是画里唯一的光啊
[00:38]夕阳把影子拉得很长
[00:44]落叶轻轻落在肩膀上
[00:50]冬夜的雪慢慢飘下来
[00:56]盖住了所有未说出口的话
[01:02]别怕黑 别怕路远
[01:08]光会带你走到春天
[01:14]啦啦啦 啦啦啦
[01:20]小路尽头 有人在等你回家`;

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<VoxelWorld | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const lyricsRef = useRef<LyricLine[]>([]);
  const lineElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const listElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const glowRef = useRef<string>('#ffd98a');
  const audioNameRef = useRef<HTMLInputElement>(null);
  const lrcNameRef = useRef<HTMLInputElement>(null);

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [themeIdx, setThemeIdx] = useState(2);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLine, setCurrentLine] = useState(-1);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [lrcText, setLrcText] = useState<string | null>(null);
  const [lyricDraft, setLyricDraft] = useState('');
  const [progress, setProgress] = useState(0);
  const [prevLine, setPrevLine] = useState(-1);
  const [lyricsOpen, setLyricsOpen] = useState(true);
  const [weather, setWeather] = useState<WeatherMode>('auto');
  const [qualityChoice, setQualityChoice] = useState<QualityChoice>(() => loadQualityChoice());
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const lastSweepElRef = useRef<HTMLDivElement | null>(null);
  const lastPreElRef = useRef<HTMLDivElement | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);

  /** 通过指针位置求 seek 目标时间并写入 AudioEngine */
  const seekFromClientX = useCallback((clientX: number) => {
    const bar = seekBarRef.current;
    const engine = engineRef.current;
    if (!bar || !engine) return;
    const dur = engine.getDuration();
    if (!(dur > 0)) return;
    const rect = bar.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    engine.seek(k * dur);
    setProgress(k);
  }, []);

  const onSeekDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      seekingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      seekFromClientX(e.clientX);
    },
    [seekFromClientX],
  );
  const onSeekMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (seekingRef.current) seekFromClientX(e.clientX);
    },
    [seekFromClientX],
  );
  const onSeekUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    seekingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // 网易云状态
  const [panelOpen, setPanelOpen] = useState(false);
  const [currentSong, setCurrentSong] = useState<NeteaseSong | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [pureMusic, setPureMusic] = useState(false);

  const songId = currentSong?.id ?? null;
  const songUrlQ = trpc.netease.songUrl.useQuery(
    { id: songId ?? 0 },
    { enabled: songId != null, retry: 1, refetchOnWindowFocus: false },
  );
  const refetchSongUrl = songUrlQ.refetch;
  const lyricQ = trpc.netease.lyric.useQuery(
    { id: songId ?? 0 },
    { enabled: songId != null, retry: 1, refetchOnWindowFocus: false },
  );

  // init three world once
  useEffect(() => {
    const world = new VoxelWorld(canvasRef.current!);
    worldRef.current = world;
    const engine = new AudioEngine();
    engineRef.current = engine;
    world.setTheme(THEMES[2]);
    glowRef.current = THEMES[2].lyricGlow;

    let raf = 0;
    let last = performance.now();
    // 直连降级（spectrum:false）时 AnalyserNode 不接入，getBands 恒 0 → 场景完全静止。
    // 这里用播放时间驱动一套低频模拟节拍兜底，仅在「在播但频谱全 0」时生效。
    let simT = 0;
    let simBass = 0;
    let simMid = 0;
    let simTreble = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let bands = engine.getBands();
      const isPlaying = engine.isPlaying();
      const flat = bands.bass === 0 && bands.mid === 0 && bands.treble === 0;
      if (isPlaying && flat) {
        // 以 84 BPM 的节拍为骨架 + 缓慢起伏的音色包络
        simT += dt;
        const beat = 60 / 84;
        const phase = (simT % beat) / beat;
        const kick = Math.pow(1 - phase, 3); // 每拍一个衰减脉冲
        const swell = 0.5 + 0.5 * Math.sin(simT * 0.35);
        const melody = 0.4 + 0.35 * Math.sin(simT * 1.1 + Math.sin(simT * 0.23) * 2);
        simBass += (kick * 0.55 + swell * 0.25 - simBass) * Math.min(1, dt * 8);
        simMid += (melody * 0.5 + kick * 0.2 - simMid) * Math.min(1, dt * 5);
        simTreble += (0.25 + 0.25 * Math.sin(simT * 1.7) - simTreble) * Math.min(1, dt * 4);
        bands = { bass: simBass, mid: simMid, treble: simTreble, level: (simBass + simMid + simTreble) / 3 };
      } else if (flat) {
        // 未播放时让模拟量回落，避免恢复播放瞬间跳变
        simBass += (0 - simBass) * Math.min(1, dt * 3);
        simMid += (0 - simMid) * Math.min(1, dt * 3);
        simTreble += (0 - simTreble) * Math.min(1, dt * 3);
        bands = { bass: simBass, mid: simMid, treble: simTreble, level: (simBass + simMid + simTreble) / 3 };
      }
      world.update(dt, isPlaying, bands);

      // lyrics placement —— 按 audio.currentTime 精确同步
      const t = engine.getTime();
      const dur = engine.getDuration();
      if (dur > 0 && !seekingRef.current) {
        const p = t / dur;
        setProgress((prev) => (Math.abs(prev - p) > 0.003 ? p : prev));
      }
      const lines = lyricsRef.current;
      // UI 提前量：高亮/滚动/扫光都基于 ta（提前 0.4s），让人有预读时间；
      // 歌词 3D 飞行定位仍用真实时间 t，时间轴本身不变，seek 也不受影响
      const ta = t + LOOKAHEAD;
      let cur = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const dtLine = line.time - t; // >0 future
        if (line.time <= ta) cur = i;
        const el = lineElsRef.current.get(i);
        if (!el) continue;
        const ahead = 11; // seconds visible ahead
        const behind = 4;
        if (dtLine < -behind || dtLine > ahead) {
          el.style.opacity = '0';
          continue;
        }
        const cz = world.getCharZ();
        const z = cz - 5 - dtLine * 6.2;
        const side = i % 2 === 0 ? -1 : 1;
        const p = world.project(side * 5.1, 2.0, z);
        if (!p.visible) {
          el.style.opacity = '0';
          continue;
        }
        const distFade = Math.min(1, Math.max(0, (ahead - dtLine) / 3));
        const pastFade = dtLine < 0 ? Math.max(0, 1 + dtLine / behind) : 1;
        const lineFade = distFade * pastFade * (dtLine <= 0 ? 0.45 : 1);
        el.style.opacity = String(lineFade);
        // 进入视野时由模糊到清晰（随淡入因子联动，仅 transform/opacity/filter）
        const blurPx = (1 - Math.min(1, lineFade / 0.85)) * 5;
        el.style.filter = blurPx > 0.15 ? `blur(${blurPx.toFixed(1)}px)` : 'none';
        // 漂浮摆动：随时间轻微摇曳 + 随 treble 呼吸
        const swayX = Math.sin(now / 900 + i * 1.7) * 7;
        const swayY = Math.cos(now / 1150 + i * 2.3) * 5;
        el.style.transform = `translate(${p.x + swayX}px, ${p.y + swayY}px) translate(-50%,-50%) scale(${Math.max(0.55, 1 + dtLine * -0.03)})`;
      }
      // 列表：卡拉 OK 扫光进度 + bass 脉冲（rAF 直写 CSS 变量，零重渲染）
      const container = listContainerRef.current;
      if (container) container.style.setProperty('--bass', bands.bass.toFixed(3));
      const curListEl = cur >= 0 ? listElsRef.current.get(cur) ?? null : null;
      if (lastSweepElRef.current && lastSweepElRef.current !== curListEl) {
        lastSweepElRef.current.style.removeProperty('--sweep');
      }
      if (curListEl) {
        const start = lines[cur].time;
        const end = lines[cur + 1]?.time ?? start + 4;
        // 扫光起点同步提前 0.4s，扫光时长仍按行实际时长
        const sweep = Math.min(1, Math.max(0, (ta - start) / Math.max(0.4, end - start)));
        curListEl.style.setProperty('--sweep', `${(sweep * 112).toFixed(1)}%`);
      }
      lastSweepElRef.current = curListEl;
      // 预亮：当前行唱到 70% 后，下一行随进度轻微提亮，视线自然过渡
      let preEl: HTMLDivElement | null = null;
      let preK = 0;
      if (cur >= 0 && lines[cur + 1]) {
        const start = lines[cur].time;
        const end = lines[cur + 1].time;
        const p = (t - start) / Math.max(0.4, end - start); // 真实时间上的行内进度
        if (p >= 0.7) {
          preEl = listElsRef.current.get(cur + 1) ?? null;
          preK = Math.min(1, (p - 0.7) / 0.3);
        }
      }
      if (lastPreElRef.current && lastPreElRef.current !== preEl) {
        lastPreElRef.current.style.removeProperty('--pre');
      }
      if (preEl) preEl.style.setProperty('--pre', preK.toFixed(3));
      lastPreElRef.current = preEl;
      if (cur !== -1 || lines.length === 0) {
        setCurrentLine((prev) => {
          if (prev === cur) return prev;
          setPrevLine(prev);
          return cur;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => world.resize();
    addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      world.dispose();
      engine.stop();
    };
  }, []);

  useEffect(() => {
    const th = THEMES[themeIdx];
    worldRef.current?.setTheme(th);
    glowRef.current = th.lyricGlow;
    document.documentElement.style.setProperty('--lyric-glow', th.lyricGlow);
  }, [themeIdx]);

  // 天气切换：任何主题下可选任何天气（'auto' 跟随主题默认）
  useEffect(() => {
    worldRef.current?.setWeather(weather);
  }, [weather]);

  // 画质切换：写入 VoxelWorld（重建 composer RT）并持久化用户选择
  useEffect(() => {
    worldRef.current?.setQuality(resolveQuality(qualityChoice));
    saveQualityChoice(qualityChoice);
  }, [qualityChoice]);

  // 音量：AudioEngine 统一入口（三态：频谱代理 / 直连 / 内置 demo）
  useEffect(() => {
    engineRef.current?.setVolume(muted ? 0 : volume);
  }, [volume, muted]);

  // 当前歌词行变化 → 列表平滑滚动跟随
  // 注意：不能用 scrollIntoView —— 它会滚动所有可滚动祖先；面板收起/动画中
  // 列表元素位于屏幕外时，会把 fixed 根容器横向卷动，导致整个 3D 画布左移出屏。
  // 改为只在列表容器内部做垂直 scrollTo，布局与画布完全解耦。
  useEffect(() => {
    if (currentLine < 0 || !lyricsOpen) return;
    const container = listContainerRef.current;
    const el = listElsRef.current.get(currentLine);
    if (!container || !el) return;
    const cRect = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top = container.scrollTop + (r.top - cRect.top) - cRect.height / 2 + r.height / 2;
    container.scrollTo({ top, behavior: 'smooth' });
  }, [currentLine, lyricsOpen]);

  // 粒子聚散目标：旧行取当前位置；新行取 scrollIntoView(block:center) 的最终落点（容器视觉中心）
  const getParticleTargets = useCallback((): ParticleTargets => {
    const container = listContainerRef.current;
    if (!container) return { from: null, to: null };
    const fromEl = prevLine >= 0 ? listElsRef.current.get(prevLine) : undefined;
    const toEl = currentLine >= 0 ? listElsRef.current.get(currentLine) : undefined;
    const from = fromEl ? fromEl.getBoundingClientRect() : null;
    let to: DOMRect | null = null;
    if (toEl) {
      const r = toEl.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      to = new DOMRect(r.left, cRect.top + cRect.height / 2 - r.height / 2, r.width, r.height);
    }
    return { from, to };
  }, [currentLine, prevLine]);

  // 网易云歌曲：拿到可播放地址后切换 AudioEngine 音源（必须用同源 proxyUrl，否则拿不到频谱）
  useEffect(() => {
    const d = songUrlQ.data;
    if (!d || songId == null) return;
    const engine = engineRef.current;
    if (!engine) return;
    // 快速切歌守卫：旧歌曲的异步链路晚到时不得再写状态（否则会覆盖新歌的 UI）
    let cancelled = false;
    if (d.playable) {
      setTrackLoading(true);
      // spectrum=true 走同源代理；false 为直连模式（网易云限制云出口时的降级，无频谱）
      engine
        .loadUrl(d.spectrum ? d.proxyUrl : d.url, { spectrum: d.spectrum })
        .then(async () => {
          if (cancelled) return;
          try {
            await engine.play();
            if (cancelled) return;
            setPlaying(true);
            setStarted(true);
          } catch {
            if (!cancelled) setPlayError('播放被浏览器拦截，请再点一次播放按钮');
          }
        })
        .catch(() => {
          if (!cancelled) setPlayError('音频加载失败，请稍后重试');
        })
        .finally(() => {
          if (!cancelled) setTrackLoading(false);
        });
    } else {
      setPlayError(d.reason || 'VIP 歌曲，无法播放');
      setTrackLoading(false);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songUrlQ.data, songId]);

  // 取链请求本身失败（网络/接口错误）：必须复位加载态，否则 HUD 永远卡在「加载中…」
  useEffect(() => {
    if (songId == null || !songUrlQ.isError) return;
    setTrackLoading(false);
    setPlayError('获取播放地址失败，请重试');
  }, [songId, songUrlQ.isError, songUrlQ.errorUpdatedAt]);

  // 网易云歌词：解析真实 LRC 时间轴
  useEffect(() => {
    const d = lyricQ.data;
    if (!d || songId == null) return;
    if (d.pureMusic || !d.lrc) {
      setPureMusic(true);
      lyricsRef.current = [];
      setLyrics([]);
      setCurrentLine(-1);
      setPrevLine(-1);
      return;
    }
    const lines = parseLRC(d.lrc);
    if (!lines.length) {
      setPureMusic(true);
      lyricsRef.current = [];
      setLyrics([]);
      setCurrentLine(-1);
      setPrevLine(-1);
      return;
    }
    setPureMusic(false);
    lyricsRef.current = lines;
    setLyrics(lines);
    setCurrentLine(-1);
    setPrevLine(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricQ.data, songId]);

  const playNetease = useCallback(
    (song: NeteaseSong) => {
      if (song.id === currentSong?.id) {
        const engine = engineRef.current;
        // 上次取链/加载失败：同曲重试（不依赖 id 变化，手动重新取链）
        if (playError && !engine?.isPlaying()) {
          setPlayError(null);
          setTrackLoading(true);
          void refetchSongUrl();
          return;
        }
        // 已在播放列表里 → 直接继续
        engine
          ?.play()
          .then(() => {
            setPlayError(null);
            setPlaying(true);
            setStarted(true);
          })
          .catch(() => setPlayError('播放被浏览器拦截，请再点一次播放按钮'));
        setStarted(true);
        return;
      }
      setPlayError(null);
      setTrackLoading(true);
      setPureMusic(false);
      lyricsRef.current = [];
      setLyrics([]);
      setCurrentLine(-1);
      setPrevLine(-1);
      setCurrentSong(song);
      setStarted(true);
    },
    [currentSong?.id, playError, refetchSongUrl],
  );

  const begin = useCallback(async () => {
    const engine = engineRef.current!;
    const lyricSource = lrcText ?? (lyricDraft.trim() ? lyricDraft : null);
    let lines: LyricLine[] = [];
    // 被自动播放策略拦截时置 false：不再无条件 setPlaying(true)，否则 UI 与真实播放脱节
    let playOk = true;
    setCurrentSong(null);
    setPlayError(null);
    if (audioFile) {
      const hasTimestamp = !!lyricSource && /\[\d+:\d+/.test(lyricSource);
      await engine.loadFile(audioFile);
      if (lyricSource && hasTimestamp) {
        // 本地 LRC：currentTime 精确同步
        lines = parseLRC(lyricSource);
      } else if (lyricSource) {
        // 纯文本歌词：没有时间轴，均匀分布兜底
        lines = plainToLyrics(lyricSource, engine.getDuration());
      }
      // 感知 play() 的 Promise（原来 fire-and-forget，拦截时静默失败）
      try {
        await engine.play();
      } catch {
        playOk = false;
      }
      setPureMusic(lines.length === 0);
    } else {
      engine.startDemo();
      lines = parseLRC(lyricSource && /\[\d+:\d+/.test(lyricSource) ? lyricSource : SAMPLE_LYRICS);
      setPureMusic(false);
    }
    if (!lines.length && !audioFile) lines = parseLRC(SAMPLE_LYRICS);
    lyricsRef.current = lines;
    setLyrics(lines);
    setCurrentLine(-1);
    setPrevLine(-1);
    // 必须在 try 之外：即便 play() 被拦截，开始浮层也要正常关闭，不阻塞 UI 反馈
    setStarted(true);
    if (playOk) setPlaying(true);
    else setPlayError('播放被浏览器拦截，请再点一次播放按钮');
  }, [audioFile, lrcText, lyricDraft]);

  const togglePlay = () => {
    const engine = engineRef.current!;
    if (engine.isPlaying()) {
      engine.pause();
      setPlaying(false);
      return;
    }
    if (engine.isDemo && engine.ctx?.state === 'suspended') {
      engine.resumeDemo();
      setPlaying(true);
      return;
    }
    engine
      .play()
      .then(() => {
        setPlayError(null);
        setPlaying(true);
      })
      .catch(() => setPlayError('播放被浏览器拦截，请再点一次播放按钮'));
  };

  const busy = trackLoading || (songId != null && songUrlQ.isFetching);
  // 直连模式（API 被网易云风控拒绝时的降级）：能播、能看歌词，但拿不到频谱
  const directPlay = songUrlQ.data?.playable === true && songUrlQ.data.spectrum === false;
  // 歌词请求失败（网络/接口错误）：界面需要给出提示，否则完全无反馈
  const lyricError = songId != null && lyricQ.isError;

  return (
    <div className="fixed inset-0 overflow-clip bg-black select-none">
      <canvas ref={canvasRef} className="fixed inset-0 w-full h-full" aria-hidden="true" />
      {/* 3D 场景为纯装饰层：为不支持 WebGL / 屏幕阅读器提供可读降级说明 */}
      <span className="sr-only">
        背景为随音乐律动的像素 3D 场景（需要 WebGL 支持）。若未显示，不影响音乐播放与歌词功能。
      </span>

      {/* 3D flying lyrics layer（currentTime 精确同步） */}
      {started &&
        lyrics.map((l, i) => (
          <div
            key={i}
            ref={(el) => {
              if (el) lineElsRef.current.set(i, el);
              else lineElsRef.current.delete(i);
            }}
            className={`lyric-line ${i === currentLine ? 'lyric-current' : ''}`}
            style={{ opacity: 0 }}
          >
            {l.text}
          </div>
        ))}

      {/* start overlay */}
      {!started && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="w-[min(92vw,460px)] rounded-3xl border border-white/10 bg-black/60 p-8 text-center shadow-2xl">
            <div className="mb-2 flex justify-center">
              <Sparkles className="h-8 w-8 text-amber-200" />
            </div>
            <h1 className="mb-1 font-serif-sc text-2xl tracking-widest text-amber-50">光路 · 歌词</h1>
            <p className="mb-6 text-sm text-white/50">一个会随音乐律动的治愈系像素小路</p>

            {/* 主入口：网易云 */}
            <Button
              className="mb-4 w-full rounded-full bg-red-500/85 text-white hover:bg-red-400"
              onClick={() => setPanelOpen(true)}
            >
              <Music2 className="mr-2 h-4 w-4" />
              网易云音乐 · 扫码点歌
            </Button>

            {/* 备用入口：本地文件 */}
            <div className="mb-3 flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => audioNameRef.current?.click()}
              >
                <Music className="mr-2 h-4 w-4" />
                {audioFile ? audioFile.name.slice(0, 14) : '选择音乐'}
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => lrcNameRef.current?.click()}
              >
                <FileText className="mr-2 h-4 w-4" />
                {lrcText ? '歌词已就绪' : '选择 LRC 歌词'}
              </Button>
            </div>

            <textarea
              value={lyricDraft}
              onChange={(e) => setLyricDraft(e.target.value)}
              placeholder={'也可以直接粘贴歌词文本，每行一句。\n带时间轴的 LRC 会精准卡点 ✨'}
              rows={3}
              className="mb-3 w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-2 font-serif-sc text-sm text-white/85 placeholder:text-white/30 focus:border-amber-200/40 focus:outline-none"
            />
            <input
              ref={audioNameRef}
              type="file"
              accept="audio/*"
              aria-label="选择本地音乐文件"
              className="sr-only"
              onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
            />
            <input
              ref={lrcNameRef}
              type="file"
              accept=".lrc,.txt"
              aria-label="选择 LRC 歌词文件"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setLrcText(await f.text());
              }}
            />

            <Button
              variant="outline"
              className="w-full rounded-full border-amber-200/30 bg-amber-200/10 text-amber-100 hover:bg-amber-200/20"
              onClick={begin}
            >
              <Upload className="mr-2 h-4 w-4" />
              {audioFile ? '用本地音乐开始漫步' : '没有音乐？用内置小曲先逛逛'}
            </Button>
            <p className="mt-3 text-xs text-white/35">本地 LRC 与网易云歌词均按播放时间精准同步</p>
          </div>
        </div>
      )}

      {/* 网易云面板切换按钮 */}
      <div className="absolute left-5 top-5 z-20">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm backdrop-blur transition ${
            panelOpen
              ? 'border-red-300/50 bg-red-400/15 text-red-100'
              : 'border-white/10 bg-black/40 text-white/70 hover:text-white'
          }`}
        >
          {panelOpen ? <X className="h-4 w-4" /> : <Music2 className="h-4 w-4 text-red-300" />}
          {panelOpen ? '收起' : '网易云音乐'}
        </button>
      </div>

      {/* 网易云面板：上下边距随视口高度自适应。
          高屏（≥900px）取原值 72/112px（零回归）；矮屏（如 320×568）收紧到 56/91px，
          把多出的空间让给内部滚动列表（原固定值 384px 可用高，扣 QR 176px 后列表仅剩 ~96px）。 */}
      {panelOpen && (
        <div
          className="absolute left-5 z-20 w-[min(92vw,340px)]"
          style={{ top: 'max(3.5rem, min(4.5rem, 8dvh))', bottom: 'max(5rem, min(7rem, 16dvh))' }}
        >
          <NeteasePanel activeSongId={currentSong?.id} onPlay={playNetease} />
        </div>
      )}

      {/* HUD */}
      {started && (
        <>
          {/* 播放中歌曲信息 */}
          {currentSong && (
            <div className="absolute bottom-6 left-5 z-20 flex max-w-[min(70vw,300px)] items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-3 py-2.5 backdrop-blur">
              {currentSong.cover ? (
                <img src={currentSong.cover} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
                  <Music2 className="h-5 w-5 text-white/60" />
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm text-white/90">{currentSong.name}</div>
                <div className="truncate text-xs text-white/45">{currentSong.artists}</div>
                {busy && (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-100/70">
                    <Loader2 className="h-3 w-3 animate-spin" /> 加载中…
                  </div>
                )}
                {playError && <div className="mt-0.5 text-[11px] text-red-300/90">{playError}</div>}
                {!busy && !playError && (directPlay || pureMusic) && (
                  <div className="mt-0.5 text-[11px] text-white/40">
                    {directPlay ? '直连播放（当前网络下无频谱）' : '纯音乐，请欣赏'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 播放控制 */}
          <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3">
            <button
              onClick={togglePlay}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/50 text-amber-100 backdrop-blur transition hover:scale-105 hover:bg-black/70"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
            </button>
            {/* 进度条：可点击/拖拽 seek（原为纯展示） */}
            <div
              ref={seekBarRef}
              role="slider"
              tabIndex={0}
              aria-label="播放进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              onPointerDown={onSeekDown}
              onPointerMove={onSeekMove}
              onPointerUp={onSeekUp}
              className="group relative flex h-6 w-40 cursor-pointer items-center"
            >
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-amber-200/80" style={{ width: `${progress * 100}%` }} />
              </div>
              <div
                className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-amber-100 opacity-0 shadow transition group-hover:opacity-100"
                style={{ left: `calc(${progress * 100}% - 6px)` }}
              />
            </div>
            {/* 音量：点击图标静音，拖动滑杆调节（三态统一走 AudioEngine.setVolume） */}
            <div className="group flex items-center gap-1.5">
              <button
                onClick={() => setMuted((m) => !m)}
                title={muted ? '取消静音' : '静音'}
                aria-pressed={muted}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:text-white"
              >
                {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                aria-label="音量"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  if (v > 0) setMuted(false);
                }}
                className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/15 accent-amber-200"
              />
            </div>
          </div>

          {/* 同步歌词列表：当前行高亮发光 + 平滑滚动跟随（可折叠） */}
          {lyrics.length > 0 && (
            <>
              <div className={`lyric-panel-wrap${lyricsOpen ? '' : ' lyric-panel-hidden'}`}>
                <LyricParticles burstKey={currentLine} getTargets={getParticleTargets} disabled={!lyricsOpen} />
                <div
                  ref={listContainerRef}
                  className="max-h-[52vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/30 px-5 py-6 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  <div className="flex flex-col gap-2.5 [mask-image:linear-gradient(to_bottom,transparent,black_15%,black_85%,transparent)]">
                    {lyrics.map((l, i) => {
                      const depth = currentLine < 0 ? 2 : Math.min(5, Math.abs(i - currentLine));
                      return (
                        <div
                          key={i}
                          ref={(el) => {
                            if (el) listElsRef.current.set(i, el);
                            else listElsRef.current.delete(i);
                          }}
                          onClick={() => engineRef.current?.seek(l.time)}
                          style={{ '--depth': depth } as React.CSSProperties}
                          className={`lyric-list-item cursor-pointer font-serif-sc ${
                            i === currentLine
                              ? 'lyric-list-cur text-base font-bold'
                              : i === prevLine
                                ? 'lyric-list-leaving text-sm text-white/45'
                                : 'text-sm text-white/35 hover:text-white/60'
                          }`}
                        >
                          {i === currentLine
                            ? (() => {
                                // 模拟书写：逐字揭示节奏 = 行实际时长 / 字数（≤80ms/字），
                                // 行激活本身带 0.4s 提前量，书写与卡拉OK扫光同步开始
                                const chars = l.text.split('');
                                const start = l.time;
                                const end = lyrics[i + 1]?.time ?? start + 4;
                                const perChar = Math.min(
                                  80,
                                  Math.max(16, ((end - start) * 1000) / Math.max(1, chars.length)),
                                );
                                const writeDur = perChar * chars.length;
                                return (
                                  // 书写容器：笔尖轨道 = 文字实际宽度（inline-block），
                                  // 否则笔尖会越过文字末尾飘到整行右侧空白处
                                  <span className="lyric-write-wrap">
                                    {chars.map((ch, ci) => (
                                      <span
                                        key={ci}
                                        className="lyric-char lyric-char-write"
                                        style={{ animationDelay: `${(ci * perChar).toFixed(0)}ms` }}
                                      >
                                        {ch === ' ' ? '\u00A0' : ch}
                                      </span>
                                    ))}
                                    {/* 发光笔尖：随揭示进度左→右移动，揭完淡出 */}
                                    <span
                                      className="lyric-pen"
                                      style={{ animationDuration: `${writeDur.toFixed(0)}ms` }}
                                    />
                                  </span>
                                );
                              })()
                            : l.text}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 歌词面板悬浮开关 */}
              <button
                onClick={() => setLyricsOpen((v) => !v)}
                className={`lyric-toggle${lyricsOpen ? '' : ' lyric-toggle-closed'}`}
                title={lyricsOpen ? '隐藏歌词' : '显示歌词'}
                aria-label={lyricsOpen ? '隐藏歌词' : '显示歌词'}
              >
                {lyricsOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              </button>
            </>
          )}

          {/* 纯音乐 / 无歌词：呼吸提示 + 音符飘散 */}
          {pureMusic && lyrics.length === 0 && !busy && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-center">
              <div className="relative inline-block">
                <div className="lyric-breath font-serif-sc text-lg text-amber-50/80">纯 音 乐 · 请 欣 赏</div>
                <span className="lyric-drift-note" style={{ left: '12%', animationDelay: '0s' }}>
                  ♪
                </span>
                <span className="lyric-drift-note" style={{ left: '48%', animationDelay: '1.6s' }}>
                  ♫
                </span>
                <span className="lyric-drift-note" style={{ left: '82%', animationDelay: '3.2s' }}>
                  ♪
                </span>
              </div>
            </div>
          )}

          {/* 歌词获取失败：避免界面彻底无反馈 */}
          {lyricError && lyrics.length === 0 && !busy && !pureMusic && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-center">
              <div className="text-xs text-white/40">歌词获取失败</div>
            </div>
          )}

          {/* 本地文件路径下 currentSong 为空（begin 开始时置 null），播放信息卡片不渲染；
              这里给 playError 一个兜底显示位，否则「播放被拦截」提示设了却看不见 */}
          {playError && !currentSong && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-center">
              <div className="text-xs text-red-300/90">{playError}</div>
            </div>
          )}

          {/* 主题切换 + 天气菜单 + 画质菜单：并排一行（整簇高度不向下延伸，避免与右侧居中的歌词面板重叠） */}
          <div className="absolute right-5 top-5 z-20 flex items-start gap-2">
            <ControlMenu
              value={qualityChoice}
              options={QUALITY_LABELS.map((o) => ({
                value: o.value,
                label: o.label,
                Icon: Gauge as React.ComponentType<{ className?: string }>,
              }))}
              onSelect={setQualityChoice}
              triggerTitle="画质档位（按设备自动 / 手动覆盖）"
              triggerIcon={<Gauge className="h-3.5 w-3.5" />}
            />
            <ControlMenu
              value={weather}
              options={WEATHER_OPTIONS.map((o) => ({ value: o.mode, label: o.label, Icon: o.Icon }))}
              onSelect={setWeather}
              triggerTitle="选择天气"
              triggerIcon={(() => {
                const cur = WEATHER_OPTIONS.find((o) => o.mode === weather) ?? WEATHER_OPTIONS[0];
                const CurIcon = cur.Icon;
                return <CurIcon className="h-3.5 w-3.5" />;
              })()}
            />

            <div className="flex flex-col items-end gap-2">
              {THEMES.map((th, i) => (
                <button
                  key={th.id}
                  onClick={() => setThemeIdx(i)}
                  aria-pressed={i === themeIdx}
                  className={`rounded-full border px-4 py-1.5 font-serif-sc text-sm tracking-wider backdrop-blur transition ${
                    i === themeIdx
                      ? 'border-amber-200/60 bg-amber-100/15 text-amber-100'
                      : 'border-white/10 bg-black/40 text-white/55 hover:text-white/85'
                  }`}
                >
                  {th.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
