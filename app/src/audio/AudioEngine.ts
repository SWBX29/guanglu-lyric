/** Audio engine: file playback + WebAudio analyser, plus a built-in generative demo track. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private el: HTMLAudioElement | null = null;
  private freq: Uint8Array = new Uint8Array(0);
  private demoTimer: number | null = null;
  private demoStartAt = 0;
  private demoGain: GainNode | null = null;
  isDemo = false;
  demoDuration = 96;
  private demoOffset = 0;
  /** 0..1 用户音量（三态统一：频谱代理 / 直连 / 内置 demo） */
  private volume = 0.8;

  /** 设置音量（0..1）。同时作用于 <audio>.volume 与 demo GainNode。 */
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.el) this.el.volume = this.volume;
    if (this.demoGain) this.demoGain.gain.value = 0.32 * this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.72;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  async loadFile(file: File) {
    this.stop();
    this.ensureCtx();
    this.isDemo = false;
    const url = URL.createObjectURL(file);
    this.el = new Audio(url);
    this.el.crossOrigin = 'anonymous';
    this.el.volume = this.volume;
    this.source = this.ctx!.createMediaElementSource(this.el);
    this.source.connect(this.analyser!);
    await new Promise<void>((res, rej) => {
      this.el!.addEventListener('canplaythrough', () => res(), { once: true });
      this.el!.addEventListener('error', () => rej(new Error('音频加载失败')), { once: true });
      this.el!.load();
    });
  }

  /**
   * Load a remote/streaming URL.
   * spectrum=true（默认）：同源代理 + WebAudio 分析器，可拿频谱；
   * spectrum=false：**直连模式**——不接入分析器（跨源媒体会让节点输出静音），
   * 播放 / 歌词 / 进度正常，但 getBands() 恒为 0。
   */
  async loadUrl(url: string, opts: { spectrum?: boolean } = {}) {
    const spectrum = opts.spectrum !== false;
    this.stop();
    if (spectrum) this.ensureCtx();
    this.isDemo = false;
    const el = new Audio();
    if (spectrum) el.crossOrigin = 'anonymous';
    el.src = url;
    el.volume = this.volume;
    this.el = el;
    if (spectrum) {
      this.source = this.ctx!.createMediaElementSource(el);
      this.source.connect(this.analyser!);
    }
    await new Promise<void>((res, rej) => {
      el.addEventListener('canplay', () => res(), { once: true });
      el.addEventListener('error', () => rej(new Error('音频加载失败')), { once: true });
      el.load();
    });
  }

  /** Gentle generative pentatonic loop so the experience works without uploads */
  startDemo() {
    this.stop();
    this.ensureCtx();
    this.isDemo = true;
    const ctx = this.ctx!;
    this.demoGain = ctx.createGain();
    this.demoGain.gain.value = 0.32 * this.volume;
    this.demoGain.connect(this.analyser!);
    this.demoStartAt = ctx.currentTime + 0.1;
    this.demoOffset = 0;

    const scale = [0, 2, 4, 7, 9];
    const base = 261.63; // C4
    const note = (semi: number) => base * Math.pow(2, semi / 12);
    const bpm = 84;
    const beat = 60 / bpm;

    const scheduleBar = (barStart: number, barIdx: number) => {
      // pad chord
      const roots = [0, -3, 5, -5];
      const root = roots[barIdx % roots.length];
      for (const s of [0, 7, 12]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = note(root + s) / 2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, barStart);
        g.gain.linearRampToValueAtTime(0.05, barStart + 1.2);
        g.gain.linearRampToValueAtTime(0.0001, barStart + beat * 16);
        o.connect(g).connect(this.demoGain!);
        o.start(barStart);
        o.stop(barStart + beat * 16 + 0.1);
      }
      // melody
      let t = barStart;
      let idx = barIdx * 7;
      while (t < barStart + beat * 16 - 0.01) {
        const len = [1, 1, 2, 1, 1, 2][idx % 6] * beat;
        const semi = scale[(idx * 3 + ((idx / 5) | 0)) % scale.length] + (idx % 9 === 0 ? 12 : 0);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = note(semi);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.22, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + len * 0.95);
        o.connect(g).connect(this.demoGain!);
        o.start(t);
        o.stop(t + len);
        // soft kick on beats for rhythm detection
        if ((t - barStart) % (beat * 2) < 0.01) {
          const k = ctx.createOscillator();
          k.type = 'sine';
          k.frequency.setValueAtTime(120, t);
          k.frequency.exponentialRampToValueAtTime(40, t + 0.25);
          const kg = ctx.createGain();
          kg.gain.setValueAtTime(0.5, t);
          kg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
          k.connect(kg).connect(this.demoGain!);
          k.start(t);
          k.stop(t + 0.3);
        }
        t += len;
        idx++;
      }
    };

    const barLen = beat * 16;
    let scheduled = 0;
    const tick = () => {
      const ahead = ctx.currentTime + 6;
      while (this.demoStartAt + scheduled * barLen < ahead && scheduled * barLen < this.demoDuration) {
        scheduleBar(this.demoStartAt + scheduled * barLen, scheduled);
        scheduled++;
      }
      if (scheduled * barLen >= this.demoDuration + 4) {
        if (this.demoTimer) window.clearInterval(this.demoTimer);
      }
    };
    tick();
    this.demoTimer = window.setInterval(tick, 1000);
  }

  /** 返回播放 Promise：自动播放被浏览器拦截时调用方需要感知（否则 UI 与真实播放脱节） */
  play(): Promise<void> {
    this.ensureCtx();
    if (this.isDemo) {
      // resume demo scheduling from pause（demo 的续播走 resumeDemo）
      return Promise.resolve();
    }
    return this.el?.play() ?? Promise.resolve();
  }
  pause() {
    if (this.isDemo) {
      this.demoOffset = this.getTime();
      if (this.demoTimer) window.clearInterval(this.demoTimer);
      this.demoTimer = null;
      if (this.ctx) void this.ctx.suspend();
    } else this.el?.pause();
  }
  resumeDemo() {
    if (!this.isDemo) return;
    if (this.ctx) void this.ctx.resume();
    this.startDemo();
    this.seek(this.demoOffset);
  }

  seek(t: number) {
    if (this.isDemo) {
      this.demoStartAt = this.ctx!.currentTime - t;
    } else if (this.el) this.el.currentTime = t;
  }

  getTime(): number {
    if (this.isDemo && this.ctx) return Math.max(0, this.ctx.currentTime - this.demoStartAt);
    return this.el?.currentTime ?? 0;
  }
  getDuration(): number {
    if (this.isDemo) return this.demoDuration;
    return this.el?.duration ?? 0;
  }
  isPlaying(): boolean {
    if (this.isDemo) return this.ctx?.state === 'running';
    return !!this.el && !this.el.paused;
  }

  /** bass pulse 0..1, mid, treble */
  getBands(): { bass: number; mid: number; treble: number; level: number } {
    if (!this.analyser || !this.isPlaying()) return { bass: 0, mid: 0, treble: 0, level: 0 };
    this.analyser.getByteFrequencyData(this.freq as Uint8Array<ArrayBuffer>);
    const avg = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += this.freq[i];
      return s / ((b - a) * 255);
    };
    const bass = avg(1, 10);
    const mid = avg(10, 60);
    const treble = avg(60, 160);
    return { bass, mid, treble, level: (bass + mid + treble) / 3 };
  }

  stop() {
    if (this.demoTimer) window.clearInterval(this.demoTimer);
    this.demoTimer = null;
    if (this.el) {
      this.el.pause();
      this.el.src = '';
    }
    this.el = null;
    this.source?.disconnect();
    this.source = null;
    this.demoGain?.disconnect();
    this.demoGain = null;
  }
}
