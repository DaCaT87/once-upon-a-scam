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
