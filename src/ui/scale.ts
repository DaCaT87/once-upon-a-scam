import { isHandheld } from './fullscreen';

/** Smallest layout the screens were drawn for. Wider or taller screens grow past it. */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

export function applyViewportScale(): void {
  const root = document.documentElement;
  // Itch GIF capture locks scale/inset so mid-shot reflows cannot zoom the board.
  if (root.dataset.ouaCapLock === '1') return;
  const vv = window.visualViewport;
  const rawH = vv?.height ?? window.innerHeight;
  const w = vv?.width ?? window.innerWidth;
  const handheld = isHandheld();
  // Phone uses the full screen; desktop keeps a small top gap.
  const topGap = handheld ? 0 : 18;
  const h = Math.max(1, rawH - topGap);
  // Same 1920 board on phone and desktop — never a separate portrait column.
  const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
  const menu = root.classList.contains('is-menu');
  // Desktop menu stays a centered 16:9 frame. Phone menu fills the screen
  // (no black side bars); the wide home plate covers the extra width.
  const frameMenu = menu && !handheld;
  const menuSpare = frameMenu ? Math.max(0, (w - DESIGN_W * scale) / 2) : 0;
  root.classList.toggle('is-handheld', handheld);
  root.style.setProperty('--ui-scale', String(scale));
  root.style.setProperty('--design-w', String(frameMenu ? DESIGN_W : w / scale));
  root.style.setProperty('--design-h', String(frameMenu ? DESIGN_H : h / scale));
  root.style.setProperty('--vv-x', `${(vv?.offsetLeft ?? 0) + menuSpare}px`);
  root.style.setProperty('--vv-y', `${(vv?.offsetTop ?? 0) + topGap}px`);
}

export function bindViewportScale(): void {
  const fit = () => applyViewportScale();
  fit();
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  document.addEventListener('webkitfullscreenchange', fit);
  window.visualViewport?.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('scroll', fit);
}
