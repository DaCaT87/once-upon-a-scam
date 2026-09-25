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
  | 'whoosh';

export type MusicCue = 'menu' | 'fight' | 'hunt';

const MUSIC_SRC: Record<MusicCue, string> = {
  menu: './audio/fairytale-waltz.mp3',
  fight: './audio/the-descent.mp3',
  hunt: './audio/darkest-child.mp3',
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

  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.playing) this.startMusic();
  }

  setVolumes(music: number, sfx: number, ui: number): void {
    this.music = music;
    this.sfx = sfx;
    this.ui = ui;
    if (this.musicEl) this.musicEl.volume = music;
  }

  /** Menu, scrap, or monster hunt. Starts only after the first tap. */
  setCue(cue: MusicCue): void {
    if (this.cue === cue && this.loaded === cue) return;
    this.cue = cue;
    if (this.playing) this.playCue();
  }

  startMusic(): void {
    if (this.playing) return;
    this.playing = true;
    this.playCue();
  }

  stopMusic(): void {
    this.playing = false;
    this.musicEl?.pause();
  }

  private playCue(): void {
    const el = this.musicEl ?? new Audio();
    this.musicEl = el;
    el.loop = true;
    el.volume = this.music;
    if (this.loaded !== this.cue) {
      el.src = MUSIC_SRC[this.cue];
      this.loaded = this.cue;
    }
    void el.play().catch(() => {});
  }

  play(name: SfxName, bus: 'sfx' | 'ui' = 'sfx'): void {
    if (!this.ctx) return;
    const g = bus === 'ui' ? this.ui : this.sfx;
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
        this.tone(t, 90, 0.12, 'sine', 0.28 * g);
        this.noise(t, 0.06, 400, 0.2 * g, 'lowpass');
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
        this.mutedTrumpet(t, 0.18 * g);
        break;
      case 'death':
        this.slide(t, 240, 70, 0.28, 0.16 * g);
        this.noise(t, 0.2, 600, 0.14 * g, 'lowpass');
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

  private mutedTrumpet(t: number, vol: number): void {
    const o = this.ctx!.createOscillator();
    const f = this.ctx!.createBiquadFilter();
    const g = this.ctx!.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(392, t);
    o.frequency.exponentialRampToValueAtTime(494, t + 0.12);
    f.type = 'bandpass';
    f.frequency.value = 700;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(f).connect(g).connect(this.dest());
    o.start(t);
    o.stop(t + 0.24);
  }

  private fanfare(t: number, g: number): void {
    [60, 64, 67, 72].forEach((m, i) => this.tone(t + i * 0.09, 440 * Math.pow(2, (m - 69) / 12), 0.2, 'triangle', 0.12 * g));
  }
}

export const audio = new AudioEngine();
