import type { MatchDetails, Player, Team } from '../../lib/types.js';
import { validateAndResolvePlayerAction } from '../../lib/validation/action.js';

type TeamIntent = 'attack' | 'defend' | 'none';
type PlayerAction =
  | 'shoot'
  | 'throughBall'
  | 'pass'
  | 'cross'
  | 'cleared'
  | 'boot'
  | 'penalty'
  | 'tackle'
  | 'intercept'
  | 'slide'
  | 'run'
  | 'sprint'
  | 'none'
  | 'unassigned';

type PositionSnapshot = [number, number];

interface ChangeTeamIntent {
  type: 'ChangeTeamIntent';
  teamID: number;
  intent: TeamIntent;
}

interface AdjustLineCompactness {
  type: 'AdjustLineCompactness';
  teamID: number;
  compactness: number;
}

interface SetPlayerAction {
  type: 'SetPlayerAction';
  playerID: number;
  action: PlayerAction;
  fallbackAction?: PlayerAction;
}

interface MovePlayerIntentPosition {
  type: 'MovePlayerIntentPosition';
  playerID: number;
  intentPOS: PositionSnapshot;
}

interface ResetShape {
  type: 'ResetShape';
  teamID: number;
}

type AssistantActionCommand =
  | ChangeTeamIntent
  | AdjustLineCompactness
  | SetPlayerAction
  | MovePlayerIntentPosition
  | ResetShape;

interface CommandResult<TBefore = unknown, TAfter = unknown> {
  accepted: boolean;
  rejectedReason?: string;
  before?: TBefore;
  after?: TAfter;
}

interface TeamIntentSnapshot {
  teamID: number;
  intent: string;
}

interface PlayerActionSnapshot {
  playerID: number;
  action: string;
}

interface PlayerIntentSnapshot {
  playerID: number;
  intentPOS: PositionSnapshot;
}

interface ShapeSnapshot {
  teamID: number;
  players: PlayerIntentSnapshot[];
}

function applyAssistantActionCommand(
  matchDetails: MatchDetails,
  command: AssistantActionCommand,
): CommandResult {
  switch (command.type) {
    case 'ChangeTeamIntent': {
      return changeTeamIntent(matchDetails, command);
    }

    case 'AdjustLineCompactness': {
      return adjustLineCompactness(matchDetails, command);
    }

    case 'SetPlayerAction': {
      return setPlayerAction(matchDetails, command);
    }

    case 'MovePlayerIntentPosition': {
      return movePlayerIntentPosition(matchDetails, command);
    }

    case 'ResetShape': {
      return resetShape(matchDetails, command);
    }
  }
}

function changeTeamIntent(
  matchDetails: MatchDetails,
  command: ChangeTeamIntent,
): CommandResult<TeamIntentSnapshot, TeamIntentSnapshot> {
  const team = findTeam(matchDetails, command.teamID);

  if (!team) return reject(`Unknown teamID: ${command.teamID}`);

  const before = teamIntentSnapshot(team);

  team.intent = command.intent;

  return accept(before, teamIntentSnapshot(team));
}

function adjustLineCompactness(
  matchDetails: MatchDetails,
  command: AdjustLineCompactness,
): CommandResult<ShapeSnapshot, ShapeSnapshot> {
  const team = findTeam(matchDetails, command.teamID);

  if (!team) return reject(`Unknown teamID: ${command.teamID}`);

  if (!Number.isFinite(command.compactness) || command.compactness < 0 || command.compactness > 1) {
    return reject('compactness must be a finite number between 0 and 1');
  }

  const activePlayers = team.players.filter(isOnPitch);

  if (activePlayers.length === 0)
    return reject('Cannot adjust shape for a team with no on-pitch players');

  const before = shapeSnapshot(team);

  const [pitchWidth, pitchHeight] = matchDetails.pitchSize;

  const centroidY = average(activePlayers.map((player) => player.intentPOS[1]));

  for (const player of activePlayers) {
    const [x, y] = player.intentPOS;

    const compactedY = centroidY + (y - centroidY) * command.compactness;

    player.intentPOS = [
      clamp(Math.round(x), 0, pitchWidth),
      clamp(Math.round(compactedY), 0, pitchHeight),
    ];
  }

  return accept(before, shapeSnapshot(team));
}

function setPlayerAction(
  matchDetails: MatchDetails,
  command: SetPlayerAction,
): CommandResult<PlayerActionSnapshot, PlayerActionSnapshot> {
  const found = findPlayer(matchDetails, command.playerID);

  if (!found) return reject(`Unknown playerID: ${command.playerID}`);

  const before = playerActionSnapshot(found.player);

  const candidate: Player = { ...found.player, action: command.action };

  let resolvedAction: string;

  try {
    resolvedAction = validateAndResolvePlayerAction({
      matchDetails,
      player: candidate,
      fallbackAction: command.fallbackAction ?? 'run',
    });
  } catch (error) {
    return reject(error instanceof Error ? error.message : 'Invalid player action');
  }

  found.player.action = resolvedAction;

  return accept(before, playerActionSnapshot(found.player));
}

function movePlayerIntentPosition(
  matchDetails: MatchDetails,
  command: MovePlayerIntentPosition,
): CommandResult<PlayerIntentSnapshot, PlayerIntentSnapshot> {
  const found = findPlayer(matchDetails, command.playerID);

  if (!found) return reject(`Unknown playerID: ${command.playerID}`);

  if (!isOnPitch(found.player)) return reject(`Player ${command.playerID} is not on the pitch`);

  const validationError = validateIntentPosition(matchDetails, command.intentPOS);

  if (validationError) return reject(validationError);

  const before = playerIntentSnapshot(found.player);

  found.player.intentPOS = [...command.intentPOS];

  return accept(before, playerIntentSnapshot(found.player));
}

function resetShape(
  matchDetails: MatchDetails,
  command: ResetShape,
): CommandResult<ShapeSnapshot, ShapeSnapshot> {
  const team = findTeam(matchDetails, command.teamID);

  if (!team) return reject(`Unknown teamID: ${command.teamID}`);

  const before = shapeSnapshot(team);

  for (const player of team.players) {
    if (isOnPitch(player)) {
      player.intentPOS = [...player.originPOS];
    }
  }

  return accept(before, shapeSnapshot(team));
}

function validateIntentPosition(
  matchDetails: MatchDetails,
  position: PositionSnapshot,
): string | undefined {
  const [pitchWidth, pitchHeight] = matchDetails.pitchSize;

  const [x, y] = position;

  if (!Number.isInteger(x) || !Number.isInteger(y))
    return 'intentPOS must contain integer x/y values';
  if (x < 0 || x > pitchWidth) return `intentPOS x must be between 0 and ${pitchWidth}`;
  if (y < 0 || y > pitchHeight) return `intentPOS y must be between 0 and ${pitchHeight}`;

  return undefined;
}

function findTeam(matchDetails: MatchDetails, teamID: number): Team | undefined {
  return [matchDetails.kickOffTeam, matchDetails.secondTeam].find((team) => team.teamID === teamID);
}

function findPlayer(
  matchDetails: MatchDetails,
  playerID: number,
): { player: Player; team: Team } | undefined {
  for (const team of [matchDetails.kickOffTeam, matchDetails.secondTeam]) {
    const player = team.players.find((candidate) => candidate.playerID === playerID);

    if (player) return { player, team };
  }

  return undefined;
}

function isOnPitch(player: Player): boolean {
  return player.currentPOS[0] !== 'NP';
}

function teamIntentSnapshot(team: Team): TeamIntentSnapshot {
  return { teamID: team.teamID, intent: team.intent };
}

function playerActionSnapshot(player: Player): PlayerActionSnapshot {
  return { playerID: player.playerID, action: player.action };
}

function playerIntentSnapshot(player: Player): PlayerIntentSnapshot {
  return { playerID: player.playerID, intentPOS: [...player.intentPOS] };
}

function shapeSnapshot(team: Team): ShapeSnapshot {
  return { teamID: team.teamID, players: team.players.map(playerIntentSnapshot) };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function accept<TBefore, TAfter>(before: TBefore, after: TAfter): CommandResult<TBefore, TAfter> {
  return { accepted: true, before, after };
}

function reject<TBefore = unknown, TAfter = unknown>(
  reason: string,
): CommandResult<TBefore, TAfter> {
  return { accepted: false, rejectedReason: reason };
}

export {
  applyAssistantActionCommand,
  changeTeamIntent,
  adjustLineCompactness,
  setPlayerAction,
  movePlayerIntentPosition,
  resetShape,
};

export type {
  AssistantActionCommand,
  ChangeTeamIntent,
  AdjustLineCompactness,
  SetPlayerAction,
  MovePlayerIntentPosition,
  ResetShape,
  CommandResult,
};
