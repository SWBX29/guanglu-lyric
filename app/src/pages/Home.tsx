import { useEffect, useRef, useState, useCallback } from 'react';
import { VoxelWorld } from '../scene/VoxelWorld';
import { AudioEngine } from '../audio/AudioEngine';
import { parseLRC, plainToLyrics, type LyricLine } from '../lib/lrc';
import { THEMES } from '../lib/themes';
import { trpc } from '@/providers/trpc';
import type { NeteaseSong } from '../../contracts/types';
import { NeteasePanel } from '@/components/NeteasePanel';
import { LyricParticles, type ParticleTargets } from '@/components/LyricParticles';
import { Button } from '@/components/ui/button';
import { Play, Pause, Music, FileText, Sparkles, Upload, Loader2, Music2, X, PanelRightClose, PanelRightOpen, CloudSun, Sun, Flower2, CloudRain, Leaf, Wind, Snowflake, CloudSnow } from 'lucide-react';

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

const SAMPLE_LYRICS = `[00:02]沿着微光铺成的小路
[00:08]一步一步走向清晨的雾
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
  const listContainerRef = useRef<HTMLDivElement>(null);
  const lastSweepElRef = useRef<HTMLDivElement | null>(null);
  const lastPreElRef = useRef<HTMLDivElement | null>(null);

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
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const bands = engine.getBands();
      const isPlaying = engine.isPlaying();
      world.update(dt, isPlaying, bands);

      // lyrics placement —— 按 audio.currentTime 精确同步
      const t = engine.getTime();
      const dur = engine.getDuration();
      if (dur > 0) {
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

  // 天气切换：防御式调用（场景代理的 setWeather 可能尚未就绪）
  useEffect(() => {
    (worldRef.current as any)?.setWeather?.(weather);
  }, [weather]);

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
    if (d.playable) {
      setTrackLoading(true);
      engine
        .loadUrl(d.proxyUrl)
        .then(() => {
          engine.play();
          setPlaying(true);
          setStarted(true);
        })
        .catch(() => setPlayError('音频加载失败，请稍后重试'))
        .finally(() => setTrackLoading(false));
    } else {
      setPlayError(d.reason || 'VIP 歌曲，无法播放');
      setTrackLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songUrlQ.data, songId]);

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
        // 已在播放列表里 → 直接继续
        engineRef.current?.play();
        setPlaying(true);
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
    [currentSong?.id],
  );

  const begin = useCallback(async () => {
    const engine = engineRef.current!;
    const lyricSource = lrcText ?? (lyricDraft.trim() ? lyricDraft : null);
    let lines: LyricLine[] = [];
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
      engine.play();
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
    setStarted(true);
    setPlaying(true);
  }, [audioFile, lrcText, lyricDraft]);

  const togglePlay = () => {
    const engine = engineRef.current!;
    if (engine.isPlaying()) {
      engine.pause();
      setPlaying(false);
    } else {
      if (engine.isDemo && engine.ctx?.state === 'suspended') engine.resumeDemo();
      else engine.play();
      setPlaying(true);
    }
  };

  const busy = trackLoading || (songId != null && songUrlQ.isFetching);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black select-none">
      <canvas ref={canvasRef} className="fixed inset-0 w-full h-full" />

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
              className="absolute h-px w-px overflow-hidden opacity-0"
              onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
            />
            <input
              ref={lrcNameRef}
              type="file"
              accept=".lrc,.txt"
              className="absolute h-px w-px overflow-hidden opacity-0"
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

      {/* 网易云面板 */}
      {panelOpen && (
        <div className="absolute bottom-28 left-5 top-[4.5rem] z-20 w-[min(92vw,340px)]">
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
                {pureMusic && !busy && !playError && (
                  <div className="mt-0.5 text-[11px] text-white/40">纯音乐，请欣赏</div>
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
            <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-amber-200/80" style={{ width: `${progress * 100}%` }} />
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
                                  <>
                                    {chars.map((ch, ci) => (
                                      <span
                                        key={ci}
                                        className="lyric-char lyric-char-write"
                                        style={{ animationDelay: `${(ci * perChar).toFixed(0)}ms` }}
                                      >
                                        {ch === ' ' ? ' ' : ch}
                                      </span>
                                    ))}
                                    {/* 发光笔尖：随揭示进度左→右移动，揭完淡出 */}
                                    <span
                                      className="lyric-pen"
                                      style={{ animationDuration: `${writeDur.toFixed(0)}ms` }}
                                    />
                                  </>
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

          {/* 纯音乐 / 无歌词：呼吸提示 */}
          {pureMusic && lyrics.length === 0 && !busy && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-center">
              <div className="lyric-breath font-serif-sc text-lg text-amber-50/80">纯 音 乐 · 请 欣 赏</div>
            </div>
          )}

          {/* 主题切换（从 themes 列表遍历生成） */}
          <div className="absolute right-5 top-5 z-20 flex flex-col items-end gap-2">
            {THEMES.map((th, i) => (
              <button
                key={th.id}
                onClick={() => setThemeIdx(i)}
                className={`rounded-full border px-4 py-1.5 font-serif-sc text-sm tracking-wider backdrop-blur transition ${
                  i === themeIdx
                    ? 'border-amber-200/60 bg-amber-100/15 text-amber-100'
                    : 'border-white/10 bg-black/40 text-white/55 hover:text-white/85'
                }`}
              >
                {th.name}
              </button>
            ))}

            {/* 天气二级菜单 */}
            <div className="mt-2 flex max-w-[min(88vw,300px)] flex-wrap justify-end gap-1.5 rounded-2xl border border-white/10 bg-black/40 p-2 backdrop-blur">
              {WEATHER_OPTIONS.map(({ mode, label, Icon }) => (
                <button
                  key={mode}
                  onClick={() => setWeather(mode)}
                  title={label}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs backdrop-blur transition ${
                    weather === mode
                      ? 'border-amber-200/60 bg-amber-100/15 text-amber-100'
                      : 'border-white/10 bg-white/5 text-white/55 hover:text-white/85'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
