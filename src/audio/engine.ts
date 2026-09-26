export type SfxName =
  | 'paper'
  | 'sticker'
  | 'peel'
  | 'punch'
  | 'boing'
  | 'wood'
  | 'bell'
  | 'crash'
  | 'death'
  | 'click'
  | 'whoosh'
  | 'puff';

export type MusicCue = 'menu' | 'square' | 'final' | 'fight' | 'hunt';

type BattleCue = 'fight' | 'hunt';

const MENU_SRC = './audio/fairytale-waltz.mp3';

/** Kevin MacLeod, CC BY 4.0. Each phase keeps its own piece and fades that piece out. */
const TRACK: Record<MusicCue, { src: string; from: number; gain: number }> = {
  menu: { src: MENU_SRC, from: 3, gain: 0.5 },
  square: { src: './audio/thatched-villagers.mp3', from: 0, gain: 0.42 },
  final: { src: './audio/the-parting.mp3', from: 0, gain: 0.62 },
  fight: { src: './audio/the-descent.mp3', from: 0, gain: 1 },
  hunt: { src: './audio/clash-defiant.mp3', from: 0, gain: 1 },
};

/** Open file is the short attack plus one pass of the motif. The loop file repeats until the scrap ends. */
const BATTLE_MUSIC: Record<BattleCue, { open: string; loop: string; finale: string; introShare: number; bpm: number }> = {
  fight: {
    open: './audio/scrap-open.wav?v=boss1',
    loop: './audio/scrap-loop.wav?v=boss1',
    finale: './audio/scrap-finale.wav?v=boss1',
    introShare: 1,
    bpm: 109.78,
  },
  hunt: {
    open: './audio/hunt-open.wav',
    loop: './audio/hunt-loop.wav',
    finale: './audio/hunt-finale.wav',
    introShare: 2 / 6,
    bpm: 108,
  },
};

/** The square waltz. The scrap is a different tune. */
const MENU_MUSIC = {
  open: './audio/menu-open.wav',
  loop: './audio/menu-loop.wav',
  introShare: 2 / 10,
};

/** Skip the quiet opening. The waltz also loops back to this point, not to 0. */
const MENU_LOOP_AT = 3;

/** Real stings. The synth below is only the fallback if a file is still loading. */
const SFX_SRC: Partial<Record<SfxName, string>> = {
  punch: './audio/sfx/punch.wav?v=trim1',
  death: './audio/sfx/character-fall.wav?v=trim1',
  whoosh: './audio/sfx/swing.wav?v=trim1',
  puff: './audio/sfx/swoosh.wav?v=trim1',
  sticker: './audio/sfx/book-flip.wav?v=trim1',
  peel: './audio/sfx/book-flip.wav?v=trim1',
  paper: './audio/sfx/flipcard.wav?v=trim1',
  wood: './audio/sfx/flipcard.wav?v=trim1',
  bell: './audio/sfx/lucky.wav?v=trim1',
  boing: './audio/sfx/damage-from-punch.wav?v=trim1',
  click: './audio/sfx/click.wav?v=tick2',
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
  private bedGain: GainNode | null = null;
  private bedGen = 0;
  private bedCue: BattleCue | 'menu' | null = null;
  private bedPhase: 'bed' | 'finale' | null = null;
  private bedLive = false;
  private endRequested = false;
  /** Coming back from a scrap or a hunt reward: start on the waltz, not the intro. */
  private resumeLoop = false;
  private introEndsAt = 0;
  private loopStartsAt = 0;
  private bedStart = 0;
  private htmlFade = 0;
  /** Waltz is leaving for a scrap. Volume sliders must not snap it back up. */
  private menuDucking = false;
  /** A track is fading out. Volume sliders must not snap it back up. */
  private fadingEl: HTMLAudioElement | null = null;
  private openSrc: AudioBufferSourceNode | null = null;
  private loopSrc: AudioBufferSourceNode | null = null;
  private finaleSrc: AudioBufferSourceNode | null = null;
  private readonly bedCache = new Map<BattleCue, Promise<[AudioBuffer, AudioBuffer, AudioBuffer]>>();
  private menuCache: Promise<[AudioBuffer, AudioBuffer]> | null = null;
  private readonly sfxBuffers = new Map<SfxName, AudioBuffer>();
  private readonly sfxLoading = new Set<SfxName>();
  private readonly sfxRaw = new Map<SfxName, Promise<ArrayBuffer>>();
  private sfxOut: GainNode | null = null;

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

  /** Wake the effect bus and decode the files. Does not start the music. */
  arm(): Promise<void> {
    if (!this.ctx) this.ctx = new AudioContext();
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const jobs: Promise<unknown>[] = [];
    for (const [name, pending] of this.sfxRaw) {
      if (this.sfxBuffers.has(name) || this.sfxLoading.has(name)) continue;
      this.sfxLoading.add(name);
      jobs.push(
        pending
          .then((raw) => ctx.decodeAudioData(raw.slice(0)))
          .then((buf) => {
            this.sfxBuffers.set(name, buf);
          })
          .catch(() => {})
          .finally(() => this.sfxLoading.delete(name)),
      );
    }
    return Promise.all(jobs).then(() => undefined);
  }

  /** Drop whatever effect is still ringing, so the next one is heard alone. */
  cutSfx(): void {
    this.sfxOut?.disconnect();
    this.sfxOut = null;
  }

  setVolumes(music: number, sfx: number, ui: number): void {
    this.music = music;
    this.sfx = sfx;
    this.ui = ui;
    for (const [cue, el] of this.musicEls) {
      if (el === this.fadingEl) continue;
      el.volume = music * TRACK[cue].gain;
    }
    if (this.bedGain && !this.menuDucking) this.bedGain.gain.value = this.musicLevel();
  }

  /**
   * Fight was pressed. The square waltz fades out now, and the scrap bed is decoded
   * so the fanfare can start the moment the board appears.
   */
  leaveSquare(next: BattleCue): void {
    // Decode the scrap bed while the pinup is up, so the fanfare is ready on the board.
    void this.loadBed(next).catch(() => {});
    const el = this.musicEl;
    if (!el || (this.cue !== 'menu' && this.cue !== 'square')) return;
    this.fadingEl = el;
    this.fadeHtmlVolume(el, 0, 1.5);
  }

  /** The square is on screen. Anything left of the scrap stops, and the waltz starts now. */
  private musicLevel(): number {
    return this.bedCue === 'menu' ? this.music * 0.46 : this.music;
  }

  /** The piece that is playing fades out. The next one starts only when a screen asks for it. */
  fadeOut(): void {
    const el = this.musicEl;
    if (!el || this.fadingEl === el) return;
    this.fadingEl = el;
    this.loaded = null;
    this.fadeHtmlVolume(el, 0, 0.8);
    const fading = el;
    window.setTimeout(() => {
      fading.pause();
      if (this.musicEl === fading) this.musicEl = null;
      if (this.fadingEl === fading) this.fadingEl = null;
    }, 880);
  }

  /** Hold silence. The waltz waits until the square itself is on screen. */
  quiet(): void {
    this.resumeLoop = true;
    ++this.bedGen;
    this.stopBedSources();
    this.fadingEl = null;
    for (const el of this.musicEls.values()) el.pause();
    this.musicEl = null;
    this.cue = 'menu';
    this.loaded = null;
  }

  /** Menu, scrap, or monster hunt. The square waltz starts when the square is on screen. */
  setCue(cue: MusicCue): void {
    if (cue !== this.cue && (cue === 'menu' || cue === 'square' || cue === 'final')) {
      this.stopBedSources();
      this.cue = cue;
      if (this.playing) this.playTrack(cue);
      this.resumeLoop = false;
      return;
    }
    if (cue === 'menu' && this.bedCue && this.bedCue !== 'menu' && (this.bedPhase === 'bed' || this.bedPhase === 'finale')) {
      this.handoffToMenu();
      return;
    }
    if ((cue === 'fight' || cue === 'hunt') && this.bedPhase === 'finale' && this.cue === cue) return;
    if (this.cue === cue && this.loaded === cue && this.playing && this.bedPhase !== 'finale') return;
    this.cue = cue;
    if (this.playing) this.playCue();
  }

  /**
   * The fight is over. The same piece keeps going under the results
   * and fades across that screen, instead of stopping on the last hit.
   */
  beginEnding(): number {
    if ((this.cue === 'fight' || this.cue === 'hunt') && (this.bedLive || this.bedPhase === 'bed')) {
      return this.finishBed();
    }
    const el = this.musicEl;
    if (!el || (this.cue !== 'fight' && this.cue !== 'hunt')) return 0;
    if (this.fadingEl === el) return 0;
    const seconds = 2.8;
    this.fadingEl = el;
    this.fadeHtmlVolume(el, 0, seconds);
    const fading = el;
    window.setTimeout(() => {
      fading.pause();
      if (this.musicEl === fading) this.musicEl = null;
      if (this.fadingEl === fading) this.fadingEl = null;
    }, seconds * 1000 + 80);
    return 0;
  }

  startMusic(): void {
    this.playing = true;
    this.playCue();
  }

  stopMusic(): void {
    this.playing = false;
    this.musicEl?.pause();
    this.stopBedSources();
  }

  private elFor(cue: MusicCue): HTMLAudioElement {
    let el = this.musicEls.get(cue);
    if (!el) {
      const spec = TRACK[cue];
      el = new Audio(spec.src);
      el.preload = 'auto';
      el.loop = false;
      el.addEventListener('ended', () => {
        if (this.cue !== cue || !this.playing || this.musicEl !== el) return;
        this.playFrom(el, spec.from);
      });
      this.musicEls.set(cue, el);
    }
    return el;
  }

  /** One piece per phase. It starts at its own downbeat, never on top of the previous piece. */
  private playTrack(cue: MusicCue): void {
    this.stopBedSources();
    const spec = TRACK[cue];
    const next = this.elFor(cue);
    for (const el of this.musicEls.values()) {
      if (el !== next) el.pause();
    }
    this.fadingEl = null;
    this.musicEl = next;
    this.loaded = cue;
    this.cue = cue;
    next.volume = this.music * spec.gain;
    this.playFrom(next, spec.from);
  }

  /** The waltz keeps its own element, so coming back does not wait on a fresh download. */
  private elForMenu(): HTMLAudioElement {
    let el = this.musicEls.get('menu');
    if (!el) {
      el = new Audio(MENU_SRC);
      el.preload = 'auto';
      el.loop = false;
      el.addEventListener('ended', () => {
        if (this.cue !== 'menu' || !this.playing || this.musicEl !== el) return;
        const resume = () => {
          el.removeEventListener('seeked', resume);
          if (this.cue !== 'menu' || !this.playing || this.musicEl !== el) return;
          void el.play().catch(() => {
            this.playing = false;
          });
        };
        el.addEventListener('seeked', resume);
        try {
          el.currentTime = MENU_LOOP_AT;
        } catch {
          el.removeEventListener('seeked', resume);
        }
      });
      this.musicEls.set('menu', el);
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
    this.resumeLoop = false;
    if (this.cue === 'fight' || this.cue === 'hunt') {
      void this.playBed(this.cue);
      return;
    }
    this.playTrack(this.cue);
  }

  private async loadBed(cue: BattleCue): Promise<[AudioBuffer, AudioBuffer, AudioBuffer]> {
    let pending = this.bedCache.get(cue);
    if (!pending) {
      if (!this.ctx) this.ctx = new AudioContext();
      const ctx = this.ctx;
      const spec = BATTLE_MUSIC[cue];
      pending = Promise.all(
        [spec.open, spec.loop, spec.finale].map(async (src) => {
          const res = await fetch(src);
          if (!res.ok) throw new Error(src);
          return ctx.decodeAudioData(await res.arrayBuffer());
        }),
      ) as Promise<[AudioBuffer, AudioBuffer, AudioBuffer]>;
      pending.catch(() => {
        if (this.bedCache.get(cue) === pending) this.bedCache.delete(cue);
      });
      this.bedCache.set(cue, pending);
    }
    return pending;
  }

  private musicOut(): GainNode {
    if (!this.ctx) this.ctx = new AudioContext();
    if (!this.bedGain) {
      this.bedGain = this.ctx.createGain();
      this.bedGain.connect(this.ctx.destination);
      this.bedGain.gain.value = this.music;
    }
    return this.bedGain;
  }

  private snapBed(level: number): GainNode {
    const gain = this.musicOut();
    const now = this.ctx!.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(level, now);
    return gain;
  }

  private startBuf(buffer: AudioBuffer, when: number, loop: boolean): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(this.musicOut());
    src.start(when);
    return src;
  }

  private async loadMenu(): Promise<[AudioBuffer, AudioBuffer]> {
    if (!this.menuCache) {
      if (!this.ctx) this.ctx = new AudioContext();
      const ctx = this.ctx;
      const pending = Promise.all(
        [MENU_MUSIC.open, MENU_MUSIC.loop].map(async (src) => {
          const res = await fetch(src);
          if (!res.ok) throw new Error(src);
          return ctx.decodeAudioData(await res.arrayBuffer());
        }),
      ) as Promise<[AudioBuffer, AudioBuffer]>;
      pending.catch(() => {
        if (this.menuCache === pending) this.menuCache = null;
      });
      this.menuCache = pending;
    }
    return this.menuCache;
  }

  /** The square waltz. Coming back from a scrap starts on the loop, not the intro. */
  private async playMenu(loopOnly: boolean): Promise<void> {
    const gen = ++this.bedGen;
    this.menuDucking = false;
    this.stopBedSources();
    this.pauseHtml();
    this.bedPhase = 'bed';
    this.bedCue = 'menu';
    this.loaded = 'menu';
    this.cue = 'menu';
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    let buffers: [AudioBuffer, AudioBuffer];
    try {
      buffers = await this.loadMenu();
    } catch {
      if (gen === this.bedGen) this.bedPhase = null;
      return;
    }
    if (gen !== this.bedGen || !this.playing || this.cue !== 'menu') return;
    const [open, loop] = buffers;
    const t0 = this.ctx.currentTime + 0.02;
    this.snapBed(this.musicLevel());
    this.bedStart = t0;
    this.bedLive = false;
    if (loopOnly) {
      this.loopSrc = this.startBuf(loop, t0, true);
      return;
    }
    this.openSrc = this.startBuf(open, t0, false);
    this.introEndsAt = t0 + open.duration * MENU_MUSIC.introShare;
    this.loopStartsAt = t0 + open.duration;
    this.loopSrc = this.startBuf(loop, this.loopStartsAt, true);
  }

  private dropNow(src: AudioBufferSourceNode | null): void {
    if (!src) return;
    src.onended = null;
    try { src.stop(); } catch { /* already stopped */ }
    try { src.disconnect(); } catch { /* already gone */ }
  }

  private haltAt(src: AudioBufferSourceNode | null, when: number): void {
    if (!src) return;
    src.onended = null;
    try { src.stop(when); } catch { /* already stopped */ }
  }

  private stopBedSources(): void {
    this.dropNow(this.openSrc);
    this.dropNow(this.loopSrc);
    this.dropNow(this.finaleSrc);
    this.openSrc = this.loopSrc = this.finaleSrc = null;
    this.bedPhase = null;
    this.bedLive = false;
    this.bedCue = null;
  }

  private pauseHtml(): void {
    for (const el of this.musicEls.values()) el.pause();
    this.musicEl = null;
  }

  private async playBed(cue: BattleCue): Promise<void> {
    const gen = ++this.bedGen;
    this.menuDucking = false;
    this.stopBedSources();
    this.pauseHtml();
    this.bedPhase = 'bed';
    this.bedCue = cue;
    this.loaded = cue;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    let buffers: [AudioBuffer, AudioBuffer, AudioBuffer];
    try {
      buffers = await this.loadBed(cue);
    } catch {
      if (gen === this.bedGen) this.bedPhase = null;
      return;
    }
    if (gen !== this.bedGen || !this.playing) return;
    const [open, loop, finale] = buffers;
    this.snapBed(this.music);
    if (this.endRequested || this.cue !== cue) {
      const endIt = this.endRequested || this.cue === 'menu';
      this.endRequested = false;
      if (endIt && this.cue === 'menu') this.playFinale(finale, this.ctx.currentTime + 0.05, gen);
      return;
    }
    const spec = BATTLE_MUSIC[cue];
    const t0 = this.ctx.currentTime + 0.05;
    this.bedStart = t0;
    this.bedLive = true;
    this.openSrc = this.startBuf(open, t0, false);
    this.introEndsAt = t0 + open.duration * spec.introShare;
    this.loopStartsAt = t0 + open.duration;
    this.loopSrc = this.startBuf(loop, this.loopStartsAt, true);
  }

  /**
   * Hunt closes on the next beat with its cadence sting.
   * The scrap melts out over a few bars so the last hit does not cut the tune short.
   */
  private finishBed(): number {
    if (!this.ctx || !this.bedCue || this.bedCue === 'menu' || !this.bedLive) return 0;
    const cue = this.bedCue;
    const gen = this.bedGen;
    const pending = this.bedCache.get(cue);
    if (!pending) return 0;
    const now = this.ctx.currentTime;
    const beat = 60 / BATTLE_MUSIC[cue].bpm;
    const step = cue === 'fight' ? beat * 4 : beat;
    const elapsed = Math.max(0, now - this.bedStart);
    const into = elapsed % step;
    const remain = into < 0.03 ? 0.02 : step - into;
    const at = now + remain;
    this.bedLive = false;
    this.bedPhase = 'finale';

    if (cue === 'fight') {
      // Soft release: ride the bar, then fade the bed away. No sting.
      const fadeSec = 3.4;
      const gain = this.musicOut();
      const level = Math.max(0.0001, gain.gain.value);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(level, now);
      gain.gain.setValueAtTime(level, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + fadeSec);
      window.setTimeout(() => {
        if (gen !== this.bedGen || this.bedPhase !== 'finale') return;
        this.dropNow(this.openSrc);
        this.dropNow(this.loopSrc);
        this.dropNow(this.finaleSrc);
        this.openSrc = this.loopSrc = this.finaleSrc = null;
        this.bedPhase = null;
        this.bedCue = null;
        this.snapBed(this.musicLevel());
      }, Math.round((remain + fadeSec) * 1000) + 40);
      // Let the end banner wait for the first soft beat of the fade.
      return remain + 0.85;
    }

    void pending.then(([, , finale]) => {
      if (gen !== this.bedGen || !this.ctx || this.bedPhase !== 'finale') return;
      this.haltAt(this.openSrc, at);
      this.openSrc = null;
      this.haltAt(this.loopSrc, at);
      this.loopSrc = null;
      this.playFinale(finale, at, gen);
    }).catch(() => {
      if (gen !== this.bedGen) return;
      this.stopBedSources();
      if (this.playing) {
        this.cue = 'menu';
        this.loaded = null;
        this.playCue();
      }
    });
    return remain;
  }

  private playFinale(finale: AudioBuffer, when: number, gen: number): void {
    this.bedPhase = 'finale';
    this.dropNow(this.finaleSrc);
    this.finaleSrc = this.startBuf(finale, when, false);
    this.finaleSrc.onended = () => {
      if (gen !== this.bedGen) return;
      this.finaleSrc = null;
      this.bedPhase = null;
      this.bedCue = null;
    };
  }

  /** The square has its own music. Whatever is left of the scrap fades out as the waltz fades in. */
  private handoffToMenu(): void {
    const gen = ++this.bedGen;
    this.menuDucking = false;
    this.cue = 'menu';
    this.bedPhase = null;
    this.bedLive = false;
    this.bedCue = null;
    const sources = [this.openSrc, this.loopSrc, this.finaleSrc];
    this.openSrc = this.loopSrc = this.finaleSrc = null;
    for (const src of sources) this.dropNow(src);
    if (this.playing && this.cue === 'menu') void this.playMenu(true);
    void gen;
  }

  private fadeHtmlVolume(el: HTMLAudioElement, to: number, seconds: number): void {
    window.clearInterval(this.htmlFade);
    const from = el.volume;
    const steps = Math.max(16, Math.round(seconds * 30));
    let i = 0;
    this.htmlFade = window.setInterval(() => {
      i += 1;
      if (this.fadingEl !== el && this.musicEl !== el) {
        window.clearInterval(this.htmlFade);
        return;
      }
      const t = Math.min(1, i / steps);
      const s = t * t * (3 - 2 * t);
      el.volume = from + (to - from) * s;
      if (i >= steps) window.clearInterval(this.htmlFade);
    }, (seconds * 1000) / steps);
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
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    let g = bus === 'ui' ? this.ui : this.sfx;
    if (name === 'paper' || name === 'wood') g *= 2.6;
    if (name === 'punch' || name === 'boing') g *= 0.8;
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
      case 'death':
        this.tone(t, 70, 0.16, 'sine', 0.2 * g);
        this.noise(t, 0.05, 180, 0.08 * g, 'lowpass');
        break;
      case 'click':
        this.tone(t, 340, 0.04, 'square', 0.05 * g);
        break;
      case 'whoosh':
        this.noise(t, 0.16, 900, 0.14 * g, 'bandpass');
        break;
      case 'puff':
        this.noise(t, 0.28, 420, 0.16 * g, 'lowpass');
        this.slide(t, 210, 80, 0.3, 0.08 * g);
        break;
    }
  }

  private dest(): AudioNode {
    const ctx = this.ctx!;
    if (!this.sfxOut) {
      this.sfxOut = ctx.createGain();
      this.sfxOut.connect(ctx.destination);
    }
    return this.sfxOut;
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
}

export const audio = new AudioEngine();
