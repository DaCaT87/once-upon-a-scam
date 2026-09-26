export function isFullscreen(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
}

export async function enterFullscreen(): Promise<void> {
  if (isFullscreen()) return;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  if (!req) return;
  try {
    await Promise.race([
      Promise.resolve(req()),
      new Promise<void>((resolve) => window.setTimeout(resolve, 350)),
    ]);
  } catch {
    /* gesture required or denied */
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
  const exit = document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(document);
  if (!exit) return;
  try {
    await exit();
  } catch {
    /* ignored */
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (isFullscreen()) await exitFullscreen();
  else await enterFullscreen();
}

export function syncFullscreenChrome(enterLabel: string, exitLabel: string): void {
  const on = isFullscreen();
  document.documentElement.classList.toggle('is-fullscreen', on);
  const label = on ? exitLabel : enterLabel;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#fullscreen-btn, [data-act="fullscreen"]')) {
    btn.textContent = label;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/** A phone, not a desktop window. The short side of a handset stays under 700. */
export function isHandheld(): boolean {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return coarse && shortSide > 0 && shortSide < 700;
}

export function isPortrait(): boolean {
  return window.matchMedia('(orientation: portrait)').matches;
}

export function syncLandscapeGate(): void {
  document.documentElement.classList.toggle('needs-landscape', isHandheld() && isPortrait());
}

export function setLandscapeGateLabel(text: string): void {
  const el = document.querySelector('.landscape-gate p');
  if (el) el.textContent = text;
}

/** Full screen, then keep the phone sideways. Browsers only allow the lock after a tap. */
export async function holdLandscape(): Promise<void> {
  if (!isHandheld()) return;
  await enterFullscreen();
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {
    /* Safari refuses the lock. The portrait gate covers that case. */
  }
  syncLandscapeGate();
}

export function bindLandscapeHold(): void {
  const apply = () => syncLandscapeGate();
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.matchMedia('(orientation: portrait)').addEventListener('change', apply);
  document.addEventListener('fullscreenchange', () => {
    if (isFullscreen() && isHandheld()) {
      void screen.orientation?.lock?.('landscape').catch(() => {});
    }
    apply();
  });
  document.addEventListener('webkitfullscreenchange', apply);
  window.addEventListener('pointerdown', (e) => {
    if (!isHandheld()) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('#fullscreen-btn, [data-act="fullscreen"]')) return;
    void holdLandscape();
  });
}

export function bindFullscreenControls(labels: () => { enter: string; exit: string }): void {
  const apply = () => syncFullscreenChrome(labels().enter, labels().exit);
  document.getElementById('fullscreen-btn')?.addEventListener('click', () => {
    void toggleFullscreen();
  });
  document.addEventListener('fullscreenchange', apply);
  document.addEventListener('webkitfullscreenchange', apply);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      void toggleFullscreen();
    }
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      void toggleFullscreen();
    }
  });
  apply();
}
