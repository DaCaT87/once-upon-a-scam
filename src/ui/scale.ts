/** Smallest layout the screens were drawn for. Wider or taller screens grow past it. */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

export function applyViewportScale(): void {
  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  const tallPhone = h > w && w < 700;
  // A tall phone cannot show a 1920-wide board without shrinking it to a postage stamp.
  // Lay that screen out as a column, then scale the column to the phone width.
  const designW = tallPhone ? 640 : DESIGN_W;
  const scale = tallPhone ? w / designW : Math.min(w / DESIGN_W, h / DESIGN_H);
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(scale));
  root.style.setProperty('--design-w', String(w / scale));
  root.style.setProperty('--design-h', String(h / scale));
  root.style.setProperty('--vv-x', `${vv?.offsetLeft ?? 0}px`);
  root.style.setProperty('--vv-y', `${vv?.offsetTop ?? 0}px`);
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
