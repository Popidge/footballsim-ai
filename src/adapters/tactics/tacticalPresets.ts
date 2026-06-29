import type { MatchDetails, Player, Team } from '../../lib/types.js';

type TacticalPresetName =
  | 'moreCompact'
  | 'lessCompact'
  | 'higherPress'
  | 'lowerBlock'
  | 'protectLead'
  | 'increaseAttackingThreat';

type TeamIntent = 'attack' | 'defend' | 'none';
type TacticalPlayerAction =
  | 'run'
  | 'sprint'
  | 'intercept'
  | 'throughBall';
type EngineField = 'Team.intent' | 'Player.intentPOS' | 'Player.action';
type PositionSnapshot = [number, number];

interface TacticalPresetChange {
  field: EngineField;
  teamID: number;
  playerID?: number;
  before: string | PositionSnapshot;
  after: string | PositionSnapshot;
}

interface TacticalPresetResult {
  preset: TacticalPresetName;
  teamID: number;
  explanation: string;
  diff: TacticalPresetChange[];
}

interface TacticalPresetOptions {
  playerIDs?: number[];
}

interface PresetMutationContext {
  matchDetails: MatchDetails;
  team: Team;
  diff: TacticalPresetChange[];
}

function applyTacticalPreset(
  matchDetails: MatchDetails,
  teamID: number,
  preset: TacticalPresetName,
  options: TacticalPresetOptions = {},
): TacticalPresetResult {
  const team = findTeam(matchDetails, teamID);

  if (!team) throw new Error(`Unknown teamID: ${teamID}`);

  const diff: TacticalPresetChange[] = [];

  const players = selectPlayers(team, options.playerIDs);

  const context = { matchDetails, team, diff };

  switch (preset) {
    case 'moreCompact':
      setTeamIntent(team, 'defend', diff);
      compactIntentPositions(context, players, 0.7);
      break;

    case 'lessCompact':
      setTeamIntent(team, 'attack', diff);
      compactIntentPositions(context, players, 1.25);
      break;

    case 'higherPress':
      setTeamIntent(team, 'attack', diff);
      shiftIntentPositions(context, players, 25);
      setActions(players.filter(isPressingRole), 'sprint', diff, team.teamID);
      break;

    case 'lowerBlock':
      setTeamIntent(team, 'defend', diff);
      shiftIntentPositions(context, players, -30);
      setActions(players.filter(isDefensiveRole), 'intercept', diff, team.teamID);
      break;

    case 'protectLead':
      setTeamIntent(team, 'defend', diff);
      compactIntentPositions(context, players, 0.65);
      shiftIntentPositions(context, players, -20);
      setActions(players.filter((player) => player.position !== 'GK'), 'intercept', diff, team.teamID);
      setActions(players.filter(isForwardRole), 'run', diff, team.teamID);
      break;

    case 'increaseAttackingThreat':
      setTeamIntent(team, 'attack', diff);
      shiftIntentPositions(context, players.filter(notGoalkeeper), 30);
      stretchWidePlayers(context, players, 20);
      setActions(players.filter(isForwardRole), 'sprint', diff, team.teamID);
      setActions(players.filter(isMidfieldRole), 'throughBall', diff, team.teamID);
      break;
  }

  return {
    preset,
    teamID: team.teamID,
    explanation: buildExplanation(preset, team, diff),
    diff,
  };
}

function findTeam(matchDetails: MatchDetails, teamID: number): Team | undefined {
  return [matchDetails.kickOffTeam, matchDetails.secondTeam].find((team) => team.teamID === teamID);
}

function selectPlayers(team: Team, playerIDs?: number[]): Player[] {
  const activePlayers = team.players.filter(isOnPitch);

  if (!playerIDs) return activePlayers;

  const selectedIDs = new Set(playerIDs);

  return activePlayers.filter((player) => selectedIDs.has(player.playerID));
}

function setTeamIntent(team: Team, intent: TeamIntent, diff: TacticalPresetChange[]): void {
  if (team.intent === intent) return;

  diff.push({ field: 'Team.intent', teamID: team.teamID, before: team.intent, after: intent });
  team.intent = intent;
}

function compactIntentPositions(
  context: PresetMutationContext,
  players: Player[],
  factor: number,
): void {
  const { diff, matchDetails, team } = context;

  if (players.length === 0) return;

  const centroidY = average(players.map((player) => player.intentPOS[1]));

  for (const player of players.filter(notGoalkeeper)) {
    setPlayerIntentPosition(team.teamID, player, [
      player.intentPOS[0],
      clamp(Math.round(centroidY + (player.intentPOS[1] - centroidY) * factor), 0, matchDetails.pitchSize[1]),
    ], diff);
  }
}

function shiftIntentPositions(
  context: PresetMutationContext,
  players: Player[],
  attackingShift: number,
): void {
  const { diff, matchDetails, team } = context;

  const sideMultiplier = teamAttacksTowardIncreasingY(matchDetails, team) ? 1 : -1;

  for (const player of players) {
    setPlayerIntentPosition(team.teamID, player, [
      player.intentPOS[0],
      clamp(player.intentPOS[1] + attackingShift * sideMultiplier, 0, matchDetails.pitchSize[1]),
    ], diff);
  }
}

function stretchWidePlayers(
  context: PresetMutationContext,
  players: Player[],
  amount: number,
): void {
  const { diff, matchDetails, team } = context;

  const centreX = matchDetails.pitchSize[0] / 2;

  for (const player of players.filter(isWideRole)) {
    const direction = player.intentPOS[0] < centreX ? -1 : 1;

    setPlayerIntentPosition(team.teamID, player, [
      clamp(player.intentPOS[0] + amount * direction, 0, matchDetails.pitchSize[0]),
      player.intentPOS[1],
    ], diff);
  }
}

function setActions(
  players: Player[],
  action: TacticalPlayerAction,
  diff: TacticalPresetChange[],
  teamID: number,
): void {
  for (const player of players) {
    if (player.action === action) continue;

    diff.push({ field: 'Player.action', teamID, playerID: player.playerID, before: player.action, after: action });
    player.action = action;
  }
}

function setPlayerIntentPosition(
  teamID: number,
  player: Player,
  intentPOS: PositionSnapshot,
  diff: TacticalPresetChange[],
): void {
  if (player.intentPOS[0] === intentPOS[0] && player.intentPOS[1] === intentPOS[1]) return;

  diff.push({
    field: 'Player.intentPOS',
    teamID,
    playerID: player.playerID,
    before: [...player.intentPOS],
    after: intentPOS,
  });
  player.intentPOS = intentPOS;
}

function buildExplanation(preset: TacticalPresetName, team: Team, diff: TacticalPresetChange[]): string {
  const changedPlayers = new Set(diff.filter((change) => change.playerID).map((change) => change.playerID)).size;

  return `${preset} applied to ${team.name}: updated ${diff.length} engine field(s) across ${changedPlayers} player(s).`;
}

function teamAttacksTowardIncreasingY(matchDetails: MatchDetails, team: Team): boolean {
  return team.players[0].originPOS[1] < matchDetails.pitchSize[1] / 2;
}

function isOnPitch(player: Player): boolean {
  return player.currentPOS[0] !== 'NP';
}

function notGoalkeeper(player: Player): boolean {
  return player.position !== 'GK';
}

function isDefensiveRole(player: Player): boolean {
  return ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM'].includes(player.position);
}

function isMidfieldRole(player: Player): boolean {
  return ['CM', 'CDM', 'CAM', 'LM', 'RM'].includes(player.position);
}

function isForwardRole(player: Player): boolean {
  return ['ST', 'CF', 'LW', 'RW', 'LF', 'RF'].includes(player.position);
}

function isWideRole(player: Player): boolean {
  return ['LB', 'RB', 'LWB', 'RWB', 'LM', 'RM', 'LW', 'RW', 'LF', 'RF'].includes(player.position);
}

function isPressingRole(player: Player): boolean {
  return isMidfieldRole(player) || isForwardRole(player);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export { applyTacticalPreset };

export type { TacticalPresetName, TacticalPresetOptions, TacticalPresetResult, TacticalPresetChange };
