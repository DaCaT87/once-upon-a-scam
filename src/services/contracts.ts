import type { CompletedRun, RunState, TeamSnapshot } from '../core/types';

export interface SnapshotService {
  save(snapshot: TeamSnapshot): Promise<void>;
  getOpponent(round: number, excludeRunId: string, excludePlayerName?: string): Promise<TeamSnapshot | null>;
  listByRound(round: number): Promise<TeamSnapshot[]>;
}

export interface MatchmakingService {
  findOpponent(round: number, excludeRunId: string, excludePlayerName?: string): Promise<TeamSnapshot>;
}

export interface RunService {
  save(run: RunState): Promise<void>;
  load(): Promise<RunState | null>;
  clear(): Promise<void>;
}

export interface LeaderboardService {
  submit(run: CompletedRun): Promise<void>;
  list(): Promise<CompletedRun[]>;
}

export interface GameServices {
  snapshots: SnapshotService;
  matchmaking: MatchmakingService;
  runs: RunService;
  leaderboard: LeaderboardService;
}
