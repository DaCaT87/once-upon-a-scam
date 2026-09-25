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

export class AudioEngine {
  ctx: AudioContext | null = null;
  music = 0.55;
  sfx = 0.75;
  ui = 0.7;
  private musicGain: GainNode | null = null;
  private playing = false;
  private timer: number | null = null;
  private step = 0;

  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.playing) this.startMusic();
  }

  setVolumes(music: number, sfx: number, ui: number): void {
    this.music = music;
    this.sfx = sfx;
    this.ui = ui;
    if (this.musicGain) this.musicGain.gain.value = music * 0.22;
  }

  startMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.playing) return;
    this.playing = true;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.music * 0.22;
    this.musicGain.connect(ctx.destination);
    const bpm = 148;
    const beat = 60 / bpm;
    const tick = () => {
      if (!this.ctx || !this.musicGain || !this.playing) return;
      const t = this.ctx.currentTime + 0.04;
      const s = this.step;
      this.bass(t, s);
      if (s % 2 === 0) this.comp(t, s);
      this.brush(t, s);
      if (s % 16 === 12) this.lick(t);
      this.step += 1;
      this.timer = window.setTimeout(tick, beat * 1000);
    };
    tick();
  }

  stopMusic(): void {
    this.playing = false;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
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

  private bass(t: number, step: number): void {
    if (!this.musicGain) return;
    const prog = [49, 49, 52, 52, 54, 54, 52, 49, 47, 47, 49, 49, 46, 47, 49, 49];
    const midi = prog[step % prog.length]!;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.musicGain);
    o.start(t);
    o.stop(t + 0.3);
  }

  private comp(t: number, step: number): void {
    if (!this.musicGain) return;
    const chords = [
      [64, 67, 71],
      [65, 69, 72],
      [62, 66, 69],
      [64, 67, 71],
    ];
    const ch = chords[Math.floor(step / 4) % chords.length]!;
    const ctx = this.ctx!;
    for (const m of ch) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.24);
    }
  }

  private brush(t: number, step: number): void {
    if (!this.musicGain) return;
    this.noise(t, step % 2 === 0 ? 0.06 : 0.04, 1800, 0.08, 'highpass');
  }

  private lick(t: number): void {
    if (!this.musicGain) return;
    const notes = [76, 79, 76, 72];
    notes.forEach((m, i) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      const f = this.ctx!.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      o.type = 'sawtooth';
      o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      g.gain.setValueAtTime(0.12, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.1);
      o.connect(f).connect(g).connect(this.musicGain!);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.12);
    });
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
