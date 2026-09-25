/** Design camera. The whole game lives in this box and is scaled uniformly. */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

export function applyViewportScale(): void {
  const scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(scale));
}

export function bindViewportScale(): void {
  const fit = () => applyViewportScale();
  fit();
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  document.addEventListener('webkitfullscreenchange', fit);
  window.visualViewport?.addEventListener('resize', fit);
}
