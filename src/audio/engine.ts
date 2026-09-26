export type SfxName =
  | 'paper'
  | 'sticker'
  | 'peel'
  | 'punch'
  | 'boing'
  | 'wood'
  | 'bell'
  | 'crash'
  | 'trumpet'
  | 'death'
  | 'hover'
  | 'click'
  | 'win'
  | 'lose'
  | 'whoosh'
  | 'shopRecruit'
  | 'shopSticker'
  | 'hunt'
  | 'well'
  | 'oven'
  | 'clone'
  | 'book';

export type MusicCue = 'menu' | 'fight' | 'hunt';

const MUSIC_SRC: Record<MusicCue, string> = {
  menu: './audio/fairytale-waltz.mp3',
  fight: './audio/clash-defiant.mp3',
  hunt: './audio/the-descent.mp3',
};

/** Skip the quiet opening. The waltz also loops back to this point, not to 0. */
const CUE_START: Partial<Record<MusicCue, number>> = { menu: 3 };

/** Real stings. The synth below is only the fallback if a file is still loading. */
const SFX_SRC: Partial<Record<SfxName, string>> = {
  punch: './audio/sfx/hit.mp3',
  death: './audio/sfx/ko.mp3',
  trumpet: './audio/sfx/banner.mp3',
  win: './audio/sfx/win.mp3',
  lose: './audio/sfx/lose.mp3',
  shopRecruit: './audio/sfx/recruit.mp3',
  shopSticker: './audio/sfx/shop-sticker.mp3',
  hunt: './audio/sfx/hunt.mp3',
  well: './audio/sfx/well.mp3',
  oven: './audio/sfx/oven.mp3',
  clone: './audio/sfx/clone.mp3',
  book: './audio/sfx/book.mp3',
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  music = 0.55;
  sfx = 0.75;
  ui = 0.7;
  private playing = false;
  private cue: MusicCue = 'menu';
  private loaded: MusicCue | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private readonly musicEls = new Map<MusicCue, HTMLAudioElement>();
  private readonly sfxBuffers = new Map<SfxName, AudioBuffer>();
  private readonly sfxLoading = new Set<SfxName>();
  private readonly sfxRaw = new Map<SfxName, Promise<ArrayBuffer>>();

  constructor() {
    for (const [name, src] of Object.entries(SFX_SRC) as [SfxName, string][]) {
      this.sfxRaw.set(
        name,
        fetch(src).then((res) => res.arrayBuffer()),
      );
    }
  }

  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.loadSfx();
    if (!this.playing) this.startMusic();
  }

  setVolumes(music: number, sfx: number, ui: number): void {
    this.music = music;
    this.sfx = sfx;
    this.ui = ui;
    for (const el of this.musicEls.values()) el.volume = music;
  }

  /** Menu, scrap, or monster hunt. The first touch on the title screen starts it. */
  setCue(cue: MusicCue): void {
    if (this.cue === cue && this.loaded === cue && this.playing) return;
    this.cue = cue;
    if (this.playing) this.playCue();
  }

  startMusic(): void {
    this.playing = true;
    this.playCue();
  }

  stopMusic(): void {
    this.playing = false;
    this.musicEl?.pause();
  }

  /** Each cue keeps its own element, so coming back to the waltz does not wait on a fresh download. */
  private elFor(cue: MusicCue): HTMLAudioElement {
    let el = this.musicEls.get(cue);
    if (!el) {
      el = new Audio(MUSIC_SRC[cue]);
      el.preload = 'auto';
      const start = CUE_START[cue] ?? 0;
      el.loop = start === 0;
      if (start > 0) {
        el.addEventListener('ended', () => {
          if (this.cue !== cue || !this.playing || this.musicEl !== el) return;
          const resume = () => {
            el.removeEventListener('seeked', resume);
            if (this.cue !== cue || !this.playing || this.musicEl !== el) return;
            void el.play().catch(() => {
              this.playing = false;
            });
          };
          el.addEventListener('seeked', resume);
          try {
            el.currentTime = start;
          } catch {
            el.removeEventListener('seeked', resume);
          }
        });
      }
      this.musicEls.set(cue, el);
    }
    return el;
  }

  private playFrom(el: HTMLAudioElement, start: number): void {
    const go = () => {
      if (this.musicEl !== el || !this.playing) return;
      const begin = () => {
        if (this.musicEl !== el || !this.playing) return;
        void el.play().catch(() => {
          this.playing = false;
        });
      };
      if (Math.abs(el.currentTime - start) < 0.05) {
        begin();
        return;
      }
      const resume = () => {
        el.removeEventListener('seeked', resume);
        begin();
      };
      el.addEventListener('seeked', resume);
      try {
        el.currentTime = start;
      } catch {
        el.removeEventListener('seeked', resume);
        begin();
      }
    };
    if (el.readyState < 1) {
      el.addEventListener('loadedmetadata', go, { once: true });
      return;
    }
    go();
  }

  private playCue(): void {
    const next = this.elFor(this.cue);
    for (const [cue, el] of this.musicEls) {
      if (cue !== this.cue) el.pause();
    }
    this.musicEl = next;
    const start = CUE_START[this.cue] ?? 0;
    next.loop = start === 0;
    next.volume = this.music;
    const fresh = this.loaded !== this.cue;
    this.loaded = this.cue;
    if (!fresh) {
      void next.play().catch(() => {
        this.playing = false;
      });
      return;
    }
    this.playFrom(next, start);
  }

  private loadSfx(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (const [name, pending] of this.sfxRaw) {
      if (this.sfxBuffers.has(name) || this.sfxLoading.has(name)) continue;
      this.sfxLoading.add(name);
      void pending
        .then((raw) => ctx.decodeAudioData(raw.slice(0)))
        .then((buf) => this.sfxBuffers.set(name, buf))
        .catch(() => {})
        .finally(() => this.sfxLoading.delete(name));
    }
  }

  private playSample(name: SfxName, vol: number): boolean {
    const buf = this.sfxBuffers.get(name);
    if (!buf || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = buf;
    g.gain.value = vol;
    src.connect(g).connect(this.dest());
    src.start();
    return true;
  }

  play(name: SfxName, bus: 'sfx' | 'ui' = 'sfx'): void {
    if (!this.ctx) return;
    const g = bus === 'ui' ? this.ui : this.sfx;
    if (this.playSample(name, g)) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'paper':
        this.noise(t, 0.08, 1800, 0.18 * g, 'highpass');
        break;
      case 'sticker':
        this.noise(t, 0.05, 2400, 0.16 * g, 'bandpass');
        this.tone(t, 220, 0.09, 'triangle', 0.08 * g);
        break;
      case 'peel':
        this.noise(t, 0.16, 3200, 0.2 * g, 'highpass');
        this.slide(t, 420, 180, 0.14, 0.07 * g);
        break;
      case 'punch':
        this.tone(t, 140, 0.045, 'sine', 0.22 * g);
        this.noise(t, 0.03, 220, 0.12 * g, 'lowpass');
        break;
      case 'boing':
        this.slide(t, 180, 420, 0.16, 0.16 * g);
        break;
      case 'wood':
        this.tone(t, 140, 0.07, 'triangle', 0.14 * g);
        this.noise(t, 0.04, 800, 0.1 * g, 'bandpass');
        break;
      case 'bell':
        this.tone(t, 880, 0.35, 'sine', 0.1 * g);
        this.tone(t, 1320, 0.28, 'sine', 0.05 * g);
        break;
      case 'crash':
        this.noise(t, 0.35, 2000, 0.22 * g, 'highpass');
        this.tone(t, 60, 0.2, 'sawtooth', 0.08 * g);
        break;
      case 'trumpet':
        this.tone(t, 392, 0.12, 'triangle', 0.06 * g);
        this.tone(t + 0.08, 523, 0.16, 'sine', 0.05 * g);
        break;
      case 'death':
        this.tone(t, 70, 0.16, 'sine', 0.2 * g);
        this.noise(t, 0.05, 180, 0.08 * g, 'lowpass');
        break;
      case 'hover':
        this.tone(t, 520, 0.04, 'triangle', 0.04 * g);
        break;
      case 'click':
        this.tone(t, 340, 0.04, 'square', 0.05 * g);
        break;
      case 'win':
        this.fanfare(t, g);
        break;
      case 'lose':
        this.slide(t, 220, 90, 0.4, 0.14 * g);
        break;
      case 'whoosh':
        this.noise(t, 0.18, 900, 0.14 * g, 'bandpass');
        break;
      case 'shopRecruit':
        this.tone(t, 523, 0.1, 'triangle', 0.1 * g);
        this.tone(t + 0.08, 784, 0.14, 'triangle', 0.08 * g);
        break;
      case 'shopSticker':
        this.slide(t, 640, 900, 0.12, 0.1 * g);
        break;
      case 'hunt':
        this.tone(t, 55, 0.22, 'sine', 0.16 * g);
        this.noise(t, 0.08, 180, 0.1 * g, 'lowpass');
        break;
      case 'well':
        this.slide(t, 1400, 400, 0.14, 0.08 * g);
        break;
      case 'oven':
        this.noise(t, 0.2, 600, 0.1 * g, 'bandpass');
        break;
      case 'clone':
        this.slide(t, 200, 1400, 0.12, 0.08 * g);
        this.tone(t + 0.12, 880, 0.1, 'sine', 0.06 * g);
        break;
      case 'book':
        this.tone(t, 330, 0.16, 'sine', 0.08 * g);
        this.tone(t + 0.06, 494, 0.18, 'sine', 0.06 * g);
        break;
    }
  }

  private dest(): AudioNode {
    return this.ctx!.destination;
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.dest());
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private slide(t: number, a: number, b: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(a, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, b), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.dest());
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(t: number, dur: number, freq: number, vol: number, kind: BiquadFilterType): void {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.8;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.dest());
    src.start(t);
    src.stop(t + dur);
  }

  private fanfare(t: number, g: number): void {
    [60, 64, 67, 72].forEach((m, i) => this.tone(t + i * 0.09, 440 * Math.pow(2, (m - 69) / 12), 0.2, 'triangle', 0.12 * g));
  }
}

export const audio = new AudioEngine();
