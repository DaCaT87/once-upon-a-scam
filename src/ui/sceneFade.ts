/** Short fade whenever the backdrop changes: menu, square, black round card, arena, hunt, library. */

let shown: string | null = null;

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

export function commitScene(): void {
  const next = sceneKey();
  if (shown === null) {
    shown = next;
    return;
  }
  if (next === shown) return;
  shown = next;
  const veil = document.getElementById('scene-fade');
  if (!veil) return;
  veil.style.transition = 'none';
  veil.style.opacity = '1';
  void veil.offsetWidth;
  veil.style.transition = 'opacity 0.42s ease';
  veil.style.opacity = '0';
  window.setTimeout(() => {
    if (sceneKey() !== next) return;
    veil.style.transition = 'none';
    veil.style.opacity = '0';
  }, 480);
}
