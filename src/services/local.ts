import { buildOpponent } from '../ai/buildAI';
import { capTeam, teamSizeForRound } from '../core/catalog';
import { hashString } from '../core/rng';
import { validateSnapshot } from '../run/runEngine';
import type { CompletedRun, RunState, TeamSnapshot } from '../core/types';
import { compareRuns } from '../run/runEngine';
import type { GameServices, LeaderboardService, MatchmakingService, RunService, SnapshotService } from './contracts';

const K_SNAPS = 'oua.snapshots.v1';
const K_RUN = 'oua.run.v1';
const K_BOARD = 'oua.board.v1';
const K_SEEDED = 'oua.world.seeded.v3';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export class LocalSnapshotService implements SnapshotService {
  async save(snapshot: TeamSnapshot): Promise<void> {
    const errs = validateSnapshot(snapshot);
    if (errs.length) throw new Error(`invalid snapshot: ${errs.join(',')}`);
    const all = readJson<TeamSnapshot[]>(K_SNAPS, []);
    all.push(snapshot);
    writeJson(K_SNAPS, all.slice(-200));
  }

  async listByRound(round: number): Promise<TeamSnapshot[]> {
    return readJson<TeamSnapshot[]>(K_SNAPS, []).filter((s) => s.round === round);
  }

  async getOpponent(round: number, excludeRunId: string, excludePlayerName?: string): Promise<TeamSnapshot | null> {
    const cap = teamSizeForRound(round);
    const me = excludePlayerName?.trim().toLowerCase() ?? '';
    const pool = (await this.listByRound(round))
      .filter((s) => s.runId !== excludeRunId)
      .filter((s) => !me || s.playerName.trim().toLowerCase() !== me)
      .map((s) => ({ ...s, units: capTeam(s.units, cap) }))
      .filter((s) => s.units.length >= 1 && !validateSnapshot(s).length);
    if (!pool.length) return null;
    return pool[Math.abs(hashString(excludeRunId + round)) % pool.length] ?? null;
  }
}

export class LocalRunService implements RunService {
  async save(run: RunState): Promise<void> {
    writeJson(K_RUN, run);
  }
  async load(): Promise<RunState | null> {
    return readJson<RunState | null>(K_RUN, null);
  }
  async clear(): Promise<void> {
    localStorage.removeItem(K_RUN);
  }
}

export class LocalLeaderboardService implements LeaderboardService {
  async submit(run: CompletedRun): Promise<void> {
    const all = readJson<CompletedRun[]>(K_BOARD, []);
    all.push(run);
    all.sort((a, b) => compareRuns(a, b) || b.finishedAt - a.finishedAt);
    writeJson(K_BOARD, all.slice(0, 50));
  }
  async list(): Promise<CompletedRun[]> {
    const all = readJson<CompletedRun[]>(K_BOARD, []);
    return all.slice().sort((a, b) => compareRuns(a, b) || a.finishedAt - b.finishedAt);
  }
}

export class LocalMatchmakingService implements MatchmakingService {
  constructor(private snapshots: SnapshotService) {}

  async findOpponent(round: number, excludeRunId: string, excludePlayerName?: string): Promise<TeamSnapshot> {
    const stored = await this.snapshots.getOpponent(round, excludeRunId, excludePlayerName);
    if (stored) return stored;
    return buildOpponent(round, hashString(`${excludeRunId}:${round}:house`), 0.45 + Math.min(0.45, round / 16));
  }
}

export function seedWorldIfNeeded(): void {
  if (readJson(K_SEEDED, false)) return;
  const snaps: TeamSnapshot[] = [];
  const board: CompletedRun[] = [];
  const aliases = [
    'Dolly Two-Time',
    'Ink-Stained Pete',
    'Velvet Mae',
    'Lefty Calhoun',
    'Miss Ribbon',
    'Porkpie Joe',
    'The Midnight Clerk',
    'Hattie No-Last-Name',
    'Cinder Sid',
    'Brass Nell',
    'Quiet Irving',
    'Marquee Bess',
  ];
  for (let i = 0; i < 12; i++) {
    const seed = hashString(`world:${i}:v1`);
    for (let r = 1; r <= 10; r++) {
      const snap = buildOpponent(r, seed + r * 17, 0.5 + (i % 5) * 0.08);
      snap.playerName = aliases[i]!;
      snap.playerId = `ghost_${i}`;
      snap.runId = `ghostrun_${i}`;
      snaps.push(snap);
    }
    const wins = 3 + (i % 8);
    board.push({
      runId: `ghostrun_${i}`,
      playerId: `ghost_${i}`,
      playerName: aliases[i]!,
      mode: i % 2 === 0 ? 'ai' : 'async',
      wins,
      survivorDiff: (i % 7) - 2,
      hpPctTotal: 3 + (i % 5) * 0.4,
      finishedAt: Date.now() - i * 86400000,
    });
  }
  writeJson(K_SNAPS, snaps);
  writeJson(K_BOARD, board);
  writeJson(K_SEEDED, true);
}

export function createLocalServices(): GameServices {
  seedWorldIfNeeded();
  const snapshots = new LocalSnapshotService();
  return {
    snapshots,
    matchmaking: new LocalMatchmakingService(snapshots),
    runs: new LocalRunService(),
    leaderboard: new LocalLeaderboardService(),
  };
}
