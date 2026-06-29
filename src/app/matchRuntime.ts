import { initiateGame, playIteration, startSecondHalf } from '../engine.js';
import { setMatchSeed } from '../lib/common.js';
import type { MatchDetails, PitchDetails, Team } from '../lib/types.js';

interface MatchSessionState {
  matchDetails: MatchDetails;
  rngStep: number;
  seed: number;
}

const sessionState = new WeakMap<MatchSession, MatchSessionState>();

interface CreateMatchSessionOptions {
  team1: Team;
  team2: Team;
  pitch: PitchDetails;
  seed?: number;
}

interface AdvanceMatchOptions {
  iterations: number;
}

interface MatchSession {
  readonly matchID: MatchDetails['matchID'];
  readonly seed?: number;
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

type MatchSnapshot = DeepReadonly<MatchDetails>;

function createMatchSession(options: CreateMatchSessionOptions): MatchSession {
  const seed = options.seed ?? numericSeedFromMatchID(stableSeedInput(options));

  setMatchSeed(seed);

  const matchDetails = initiateGame(options.team1, options.team2, options.pitch);

  const session: MatchSession = {
    matchID: matchDetails.matchID,
    seed,
  };

  sessionState.set(session, { matchDetails, rngStep: 1, seed });

  return session;
}

function advanceMatch(session: MatchSession, options: AdvanceMatchOptions): MatchSnapshot {
  const state = getSessionState(session);

  if (!Number.isInteger(options.iterations) || options.iterations < 0) {
    throw new Error('iterations must be a non-negative integer');
  }

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    setMatchSeed(seedForStep(state));
    state.matchDetails = playIteration(state.matchDetails);
    state.rngStep++;
  }

  return cloneSnapshot(state.matchDetails);
}

function startSecondHalfForSession(session: MatchSession): MatchSnapshot {
  const state = getSessionState(session);

  setMatchSeed(seedForStep(state));
  state.matchDetails = startSecondHalf(state.matchDetails);
  state.rngStep++;

  return cloneSnapshot(state.matchDetails);
}

function getMatchSnapshot(session: MatchSession): MatchSnapshot {
  return cloneSnapshot(getSessionState(session).matchDetails);
}

function getSessionState(session: MatchSession): MatchSessionState {
  const state = sessionState.get(session);

  if (!state) {
    throw new Error('Unknown match session');
  }

  return state;
}

function seedForStep(state: MatchSessionState): number {
  return numericSeedFromMatchID(`${state.seed}:${state.rngStep}`);
}

function stableSeedInput(options: CreateMatchSessionOptions): string {
  return JSON.stringify({ pitch: options.pitch, team1: options.team1, team2: options.team2 });
}

function numericSeedFromMatchID(matchID: MatchDetails['matchID']): number {
  const input = String(matchID);

  let hash = 0x811c9dc5;

  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function cloneSnapshot(matchDetails: MatchDetails): MatchSnapshot {
  return structuredClone(matchDetails) as MatchSnapshot;
}

export type {
  AdvanceMatchOptions,
  CreateMatchSessionOptions,
  DeepReadonly,
  MatchSession,
  MatchSnapshot,
};
export { advanceMatch, createMatchSession, getMatchSnapshot, startSecondHalfForSession };
