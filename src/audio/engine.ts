export type SfxName =
  | 'paper'
  | 'sticker'
  | 'peel'
  | 'punch'
  | 'boing'
  | 'wood'
  | 'bell'
  | 'death'
  | 'click'
  | 'whoosh'
  | 'puff';

export type MusicCue = 'menu' | 'square' | 'final' | 'fight' | 'hunt';

type BattleCue = 'fight' | 'hunt';
type HtmlCue = 'menu' | 'square' | 'final';

const MENU_SRC = './audio/fairytale-waltz.mp3';

/** Kevin MacLeod, CC BY 4.0. Scrap/hunt use WebAudio beds below, not these HTML tracks. */
const TRACK: Record<HtmlCue, { src: string; from: number; gain: number }> = {
  menu: { src: MENU_SRC, from: 3, gain: 0.5 },
  square: { src: './audio/enchanted-valley.mp3', from: 0, gain: 0.48 },
  final: { src: './audio/the-parting.mp3', from: 0, gain: 0.62 },
};

/** How long the result word stays up with its jingle. Matches the wavs. */
const RESULT_SEC = { win: 6.75, draw: 5, lose: 3.55 } as const;

/** Open file is the short attack plus one pass of the motif. The loop file repeats until the scrap ends. */
const BATTLE_MUSIC: Record<BattleCue, { open: string; loop: string }> = {
  fight: {
    open: './audio/scrap-open.wav?v=boss1',
    loop: './audio/scrap-loop.wav?v=boss1',
  },
  hunt: {
    open: './audio/hunt-open.wav',
    loop: './audio/hunt-loop.wav',
  },
};

/** The square waltz. The scrap is a different tune. */
const MENU_MUSIC = {
  open: './audio/menu-open.wav',
  loop: './audio/menu-loop.wav',
};

const SFX_SRC: Record<SfxName, string> = {
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
  private readonly musicEls = new Map<HtmlCue, HTMLAudioElement>();
  private bedGain: GainNode | null = null;
  private bedGen = 0;
  private bedCue: BattleCue | 'menu' | null = null;
  private bedPhase: 'bed' | 'finale' | null = null;
  private bedLive = false;
  /** Coming back from a scrap or a hunt reward: start on the waltz, not the intro. */
  private resumeLoop = false;
  private loopStartsAt = 0;
  private bedStart = 0;
  private htmlFade = 0;
  /** Waltz is leaving for a scrap. Volume sliders must not snap it back up. */
  private menuDucking = false;
  /** A track is fading out. Volume sliders must not snap it back up. */
  private fadingEl: HTMLAudioElement | null = null;
  private openSrc: AudioBufferSourceNode | null = null;
  private loopSrc: AudioBufferSourceNode | null = null;
  private resultSrc: AudioBufferSourceNode | null = null;
  private resultCache: Promise<Record<'win' | 'draw' | 'lose', AudioBuffer>> | null = null;
  private readonly bedCache = new Map<BattleCue, Promise<[AudioBuffer, AudioBuffer]>>();
  private menuCache: Promise<[AudioBuffer, AudioBuffer]> | null = null;
  private readonly sfxBuffers = new Map<SfxName, AudioBuffer>();
  private readonly sfxLoading = new Set<SfxName>();
  private readonly sfxRaw = new Map<SfxName, Promise<ArrayBuffer>>();
  private sfxOut: GainNode | null = null;
  /** Preloaded HTML tick so Fight does not wait on the first network fetch. */
  private clickWarm: HTMLAudioElement | null = null;

  constructor() {
    for (const [name, src] of Object.entries(SFX_SRC) as [SfxName, string][]) {
      this.sfxRaw.set(
        name,
        fetch(src).then((res) => res.arrayBuffer()),
      );
    }
    const clickSrc = SFX_SRC.click;
    if (clickSrc) {
      this.clickWarm = new Audio(clickSrc);
      this.clickWarm.preload = 'auto';
      try {
        this.clickWarm.load();
      } catch {
        /* ignore */
      }
    }
  }

  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.loadSfx();
    // Decode the tick first so Fight never waits on HTMLAudio on Samsung.
    void this.ensureClickBuffer();
    if (!this.playing) this.startMusic();
  }

  private ensureClickBuffer(): Promise<void> {
    if (this.sfxBuffers.has('click') || !this.ctx) return Promise.resolve();
    const pending = this.sfxRaw.get('click');
    if (!pending) return Promise.resolve();
    if (this.sfxLoading.has('click')) return Promise.resolve();
    this.sfxLoading.add('click');
    const ctx = this.ctx;
    return pending
      .then((raw) => ctx.decodeAudioData(raw.slice(0)))
      .then((buf) => {
        this.sfxBuffers.set('click', buf);
      })
      .catch(() => {})
      .finally(() => this.sfxLoading.delete('click'));
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
   * Fight was pressed. The square piece fades out now, and the scrap bed is decoded
   * so the fanfare can start the moment the field appears.
   */
  leaveSquare(next: BattleCue): void {
    // Decode the scrap bed during the curtain, so the fanfare is ready on the board.
    void this.loadBed(next).catch(() => {});
    void this.loadResults().catch(() => {});
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
   * The fight is over. A short fade starts at once. Returns how long it takes
   * to reach silence, so the result word can come in before that.
   */
  beginEnding(): number {
    if ((this.cue === 'fight' || this.cue === 'hunt') && (this.bedLive || this.bedPhase === 'bed')) {
      return this.finishBed();
    }
    return 0;
  }

  /** Short result tune. Starts only after the scrap piece has gone quiet. */
  playResult(winner: 'player' | 'enemy' | 'draw'): number {
    const kind = winner === 'player' ? 'win' : winner === 'draw' ? 'draw' : 'lose';
    ++this.bedGen;
    this.dropNow(this.openSrc);
    this.dropNow(this.loopSrc);
    this.openSrc = this.loopSrc = null;
    this.bedLive = false;
    this.bedPhase = null;
    this.bedCue = null;
    const pending = this.playing ? (this.resultCache ?? this.loadResults()) : null;
    if (!pending) return 2.2;
    void pending
      .then((set) => {
        const buf = set[kind];
        if (!buf || !this.playing || !this.ctx) return;
        if (this.ctx.state === 'suspended') void this.ctx.resume();
        this.dropNow(this.resultSrc);
        this.snapBed(this.music * 0.8);
        this.resultSrc = this.startBuf(buf, this.ctx.currentTime + 0.02, false);
        this.resultSrc.onended = () => {
          this.resultSrc = null;
        };
      })
      .catch(() => {});
    return RESULT_SEC[kind];
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

  private elFor(cue: HtmlCue): HTMLAudioElement {
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
  private playTrack(cue: HtmlCue): void {
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

  private async loadBed(cue: BattleCue): Promise<[AudioBuffer, AudioBuffer]> {
    let pending = this.bedCache.get(cue);
    if (!pending) {
      if (!this.ctx) this.ctx = new AudioContext();
      const ctx = this.ctx;
      const spec = BATTLE_MUSIC[cue];
      pending = Promise.all(
        [spec.open, spec.loop].map(async (src) => {
          const res = await fetch(src);
          if (!res.ok) throw new Error(src);
          return ctx.decodeAudioData(await res.arrayBuffer());
        }),
      ) as Promise<[AudioBuffer, AudioBuffer]>;
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
    this.loopStartsAt = t0 + open.duration;
    this.loopSrc = this.startBuf(loop, this.loopStartsAt, true);
  }

  private dropNow(src: AudioBufferSourceNode | null): void {
    if (!src) return;
    src.onended = null;
    try { src.stop(); } catch { /* already stopped */ }
    try { src.disconnect(); } catch { /* already gone */ }
  }

  private stopBedSources(): void {
    this.dropNow(this.openSrc);
    this.dropNow(this.loopSrc);
    this.dropNow(this.resultSrc);
    this.openSrc = this.loopSrc = this.resultSrc = null;
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
    void this.loadResults().catch(() => {});
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    let buffers: [AudioBuffer, AudioBuffer];
    try {
      buffers = await this.loadBed(cue);
    } catch {
      if (gen === this.bedGen) this.bedPhase = null;
      return;
    }
    if (gen !== this.bedGen || !this.playing || this.cue !== cue) return;
    const [open, loop] = buffers;
    this.snapBed(this.music);
    const t0 = this.ctx.currentTime + 0.05;
    this.bedStart = t0;
    this.bedLive = true;
    this.openSrc = this.startBuf(open, t0, false);
    this.loopStartsAt = t0 + open.duration;
    this.loopSrc = this.startBuf(loop, this.loopStartsAt, true);
  }

  /** A light fade right after the last hit. It stays audible until the last moment. */
  private finishBed(): number {
    if (!this.ctx || !this.bedCue || this.bedCue === 'menu' || !this.bedLive) return 0;
    const cue = this.bedCue;
    const gen = this.bedGen;
    const pending = this.bedCache.get(cue);
    if (!pending) return 0;
    const now = this.ctx.currentTime;
    const remain = 0.12;
    const at = now + remain;
    this.bedLive = false;
    this.bedPhase = 'finale';

    const fadeSec = 1.2;
    const gain = this.musicOut();
    const level = Math.max(0.0001, gain.gain.value);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(level, now);
    gain.gain.linearRampToValueAtTime(0.0001, at + fadeSec);
    window.setTimeout(() => {
      if (gen !== this.bedGen || this.bedPhase !== 'finale') return;
      this.dropNow(this.openSrc);
      this.dropNow(this.loopSrc);
      this.openSrc = this.loopSrc = null;
      this.bedPhase = null;
      this.bedCue = null;
      this.snapBed(this.musicLevel());
    }, Math.round((remain + fadeSec) * 1000) + 40);
    return remain + fadeSec;
  }

  private loadResults(): Promise<Record<'win' | 'draw' | 'lose', AudioBuffer>> {
    if (!this.resultCache) {
      if (!this.ctx) this.ctx = new AudioContext();
      const ctx = this.ctx;
      const files = {
        win: './audio/result-win.wav?v=sting5',
        draw: './audio/result-draw.wav?v=sting7',
        lose: './audio/result-lose.wav?v=sting3',
      } as const;
      const pending = Promise.all(
        (Object.keys(files) as ('win' | 'draw' | 'lose')[]).map(async (kind) => {
          const res = await fetch(files[kind]);
          if (!res.ok) throw new Error(files[kind]);
          return [kind, await ctx.decodeAudioData(await res.arrayBuffer())] as const;
        }),
      ).then((pairs) => Object.fromEntries(pairs) as Record<'win' | 'draw' | 'lose', AudioBuffer>);
      pending.catch(() => {
        if (this.resultCache === pending) this.resultCache = null;
      });
      this.resultCache = pending;
    }
    return this.resultCache;
  }

  /** The square has its own music. Whatever is left of the scrap fades out as the waltz fades in. */
  private handoffToMenu(): void {
    const gen = ++this.bedGen;
    this.menuDucking = false;
    this.cue = 'menu';
    this.bedPhase = null;
    this.bedLive = false;
    this.bedCue = null;
    const sources = [this.openSrc, this.loopSrc];
    this.openSrc = this.loopSrc = null;
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

  /** UI ticks: reuse one warm element. Cloning is late on Samsung Chrome. */
  private playHtmlClick(): void {
    const src = SFX_SRC.click;
    if (!src) return;
    if (!this.clickWarm) {
      this.clickWarm = new Audio(src);
      this.clickWarm.preload = 'auto';
    }
    const el = this.clickWarm;
    el.volume = Math.max(0, Math.min(1, this.ui));
    try {
      el.pause();
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    void el.play().catch(() => {
      const one = new Audio(src);
      one.volume = el.volume;
      void one.play().catch(() => {});
    });
  }

  private playSample(name: SfxName, vol: number): boolean {
    const buf = this.sfxBuffers.get(name);
    if (!buf || !this.ctx) return false;
    // Even if suspended, schedule now — resume() below lets Samsung flush it.
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = buf;
    g.gain.value = vol;
    src.connect(g).connect(this.dest());
    try {
      src.start(0);
    } catch {
      return false;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return true;
  }

  play(name: SfxName, bus: 'sfx' | 'ui' = 'sfx'): void {
    if (name === 'click') {
      // WebAudio first: on Samsung, HTMLAudio started before a long Fight sim
      // often only becomes audible after the next paint.
      if (this.ctx && this.sfxBuffers.has('click') && this.playSample('click', this.ui)) return;
      this.playHtmlClick();
      return;
    }
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    let g = bus === 'ui' ? this.ui : this.sfx;
    if (name === 'paper' || name === 'wood') g *= 2.6;
    if (name === 'punch' || name === 'boing') g *= 0.8;
    if (this.playSample(name, g)) return;
    this.playOfficial(name, g);
  }

  /** The file is still decoding. Play that file when it is ready. Never a generated tone. */
  private playOfficial(name: SfxName, vol: number): void {
    const ctx = this.ctx;
    const pending = this.sfxRaw.get(name);
    if (!ctx || !pending) return;
    this.loadSfx();
    void pending
      .then(async (raw) => {
        const ready = this.sfxBuffers.get(name);
        if (ready) return ready;
        const buf = await ctx.decodeAudioData(raw.slice(0));
        this.sfxBuffers.set(name, buf);
        return buf;
      })
      .then(() => {
        this.playSample(name, vol);
      })
      .catch(() => {});
  }

  private dest(): AudioNode {
    const ctx = this.ctx!;
    if (!this.sfxOut) {
      this.sfxOut = ctx.createGain();
      this.sfxOut.connect(ctx.destination);
    }
    return this.sfxOut;
  }
}

export const audio = new AudioEngine();
