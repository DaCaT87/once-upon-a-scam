/** Fade through black whenever the visible screen changes, not only the backdrop. */

let shown: string | null = null;
let rampGen = 0;

function sceneKey(): string {
  const root = document.documentElement;
  if (root.classList.contains('is-preamble')) return 'preamble';
  if (root.classList.contains('is-hunt')) return 'hunt';
  if (root.classList.contains('is-battle')) return 'battle';
  if (root.classList.contains('is-codex')) return 'codex';
  if (root.classList.contains('is-square')) return 'square';
  if (root.classList.contains('is-menu')) return 'menu';
  return 'plain';
}

function veilEl(): HTMLElement | null {
  return document.getElementById('scene-fade');
}

function reduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function lockVeil(opacity: string): void {
  const veil = veilEl();
  if (!veil) return;
  veil.getAnimations().forEach((anim) => anim.cancel());
  veil.style.transition = 'none';
  veil.style.opacity = opacity;
}

/** Move the veil by hand. A CSS transition on this layer was staying at the first frame. */
function ramp(from: number, to: number, ms: number): Promise<void> {
  const veil = veilEl();
  const mine = ++rampGen;
  if (!veil) return Promise.resolve();
  lockVeil(String(from));
  if (ms <= 0 || reduceMotion()) {
    lockVeil(String(to));
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled || mine !== rampGen) return;
      settled = true;
      lockVeil(String(to));
      resolve();
    };
    const t0 = performance.now();
    const step = (now: number) => {
      if (settled || mine !== rampGen) return;
      const u = Math.min(1, (now - t0) / ms);
      const eased = u * u * (3 - 2 * u);
      veil.style.opacity = String(from + (to - from) * eased);
      if (u >= 1) {
        finish();
        return;
      }
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
    window.setTimeout(finish, ms + 80);
  });
}

/** True when this screen is not the one currently remembered. */
export function willChangeScene(page: string): boolean {
  return shown !== null && page !== shown;
}

/** Remember this screen without flashing the veil. */
export function syncScene(page?: string): void {
  shown = page ?? sceneKey();
}

/** Darken the screen that is still visible. Resolves once the veil is opaque. */
export async function fadeOutScene(ms = 360): Promise<void> {
  const veil = veilEl();
  if (!veil) return;
  veil.style.pointerEvents = 'auto';
  const current = Number(getComputedStyle(veil).opacity);
  const from = Number.isFinite(current) ? current : 0;
  await ramp(from, 1, ms);
}

/** Uncover the screen that was just painted. */
export function revealScene(page: string, ms = 500): void {
  shown = page;
  const veil = veilEl();
  if (!veil) return;
  void ramp(1, 0, ms).then(() => {
    if (shown !== page) return;
    const live = veilEl();
    if (live) live.style.pointerEvents = 'none';
  });
}

/** Drop the veil immediately. Used when the scrap curtain is the transition. */
export function hideVeil(): void {
  rampGen += 1;
  const veil = veilEl();
  if (!veil) return;
  lockVeil('0');
  veil.style.pointerEvents = 'none';
}
