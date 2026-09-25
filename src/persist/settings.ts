import type { CodexState, Settings } from '../core/types';

const K_SET = 'oua.settings.v1';
const K_CODEX = 'oua.codex.v1';
const K_PLAYER = 'oua.player.v1';

export const DEFAULT_SETTINGS: Settings = {
  locale: 'en',
  music: 0.55,
  sfx: 0.75,
  ui: 0.7,
  reduceShake: false,
  reduceFlash: false,
  battleSpeed: 1,
  showCombatLog: false,
  preferFullscreen: true,
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(K_SET) || '{}') as Settings) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(K_SET, JSON.stringify(s));
}

export function loadCodex(): CodexState {
  try {
    return JSON.parse(localStorage.getItem(K_CODEX) || '{"units":[],"stickers":[]}') as CodexState;
  } catch {
    return { units: [], stickers: [] };
  }
}

export function saveCodex(c: CodexState): void {
  localStorage.setItem(K_CODEX, JSON.stringify(c));
}

export function discover(c: CodexState, units: string[], stickers: string[]): CodexState {
  const u = new Set([...c.units, ...units]);
  const s = new Set([...c.stickers, ...stickers]);
  return { units: [...u], stickers: [...s] };
}

export function loadPlayer(): { id: string; name: string } {
  try {
    const raw = localStorage.getItem(K_PLAYER);
    if (raw) return JSON.parse(raw) as { id: string; name: string };
  } catch {
    /* empty */
  }
  const id = `p_${Date.now().toString(36)}`;
  const name = 'Velvet Mae';
  localStorage.setItem(K_PLAYER, JSON.stringify({ id, name }));
  return { id, name };
}

export function savePlayer(id: string, name: string): void {
  localStorage.setItem(K_PLAYER, JSON.stringify({ id, name }));
}
