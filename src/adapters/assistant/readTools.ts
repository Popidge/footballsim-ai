import type {
  BallPosition,
  MatchDetails,
  Player,
  Shots,
  Team,
  TeamStatistics,
} from '../../lib/types.js';

type NormalizedPosition = readonly [number | 'NP', number] | BallPosition;
type TeamSide = 'top' | 'bottom' | 'unknown';

interface TeamIdentity {
  id: number;
  name: string;
}

interface ScoreboardTeam extends TeamIdentity {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  shotsOffTarget: number;
  corners: number;
  freekicks: number;
  penalties: number;
  fouls: number;
}

interface ScoreboardContext {
  matchID: MatchDetails['matchID'];
  half: number;
  pitchSize: MatchDetails['pitchSize'];
  teams: {
    kickOff: ScoreboardTeam;
    second: ScoreboardTeam;
  };
}

interface PossessionContext {
  ball: {
    position: BallPosition;
    withPlayer: boolean;
    playerID: number | string;
    teamID: number | string;
    direction: string;
    lastTouch: MatchDetails['ball']['lastTouch'];
  };
  possessingTeam?: TeamIdentity;
  possessingPlayer?: PlayerSummary;
}

interface PlayerSummary {
  id: number;
  name: string;
  teamID: number;
  teamName: string;
  shirtNumber: number;
  position: string;
}

interface PlayerInvolvement extends PlayerSummary {
  currentPOS: Player['currentPOS'];
  intentPOS: Player['intentPOS'];
  hasBall: boolean;
  action: string;
  offside: boolean;
  injured: boolean;
  fitness: number;
  stats: Player['stats'];
  distanceToBall?: number;
  intentDistance?: number;
}

interface TeamThreatSummary extends TeamIdentity {
  intent: string;
  hasPossession: boolean;
  ballDistance: {
    nearestPlayer?: PlayerDistance;
    average: number;
  };
  attackingShape: {
    playersAheadOfBall: number;
    playersInFinalThird: number;
    averageIntentAdvance: number;
  };
  production: {
    goals: number;
    shots: number;
    shotsOnTarget: number;
    passAttempts: number;
    tackleAttempts: number;
  };
}

interface PlayerDistance {
  playerID: number;
  playerName: string;
  distance: number;
}

interface RecentEventsContext {
  limit: number;
  totalEvents: number;
  events: Array<{ index: number; message: string }>;
}

interface ShapeSummary extends TeamIdentity {
  intent: string;
  side: TeamSide;
  centroid: { current: [number, number]; intent: [number, number] };
  verticalSpread: { current: number; intent: number };
  horizontalSpread: { current: number; intent: number };
  players: Array<{
    playerID: number;
    name: string;
    position: string;
    currentPOS: Player['currentPOS'];
    intentPOS: Player['intentPOS'];
    hasBall: boolean;
    intentDelta?: [number, number];
  }>;
}

function getScoreboard(matchDetails: MatchDetails): ScoreboardContext {
  return {
    matchID: matchDetails.matchID,
    half: matchDetails.half,
    pitchSize: matchDetails.pitchSize,
    teams: {
      kickOff: normalizeScoreboardTeam(
        matchDetails.kickOffTeam,
        matchDetails.kickOffTeamStatistics,
      ),
      second: normalizeScoreboardTeam(matchDetails.secondTeam, matchDetails.secondTeamStatistics),
    },
  };
}

function getPossessionContext(matchDetails: MatchDetails): PossessionContext {
  const possessingTeam = findTeam(matchDetails, matchDetails.ball.withTeam);

  const possessingPlayer = findPlayer(matchDetails, matchDetails.ball.Player);

  return {
    ball: {
      position: matchDetails.ball.position,
      withPlayer: matchDetails.ball.withPlayer,
      playerID: matchDetails.ball.Player,
      teamID: matchDetails.ball.withTeam,
      direction: matchDetails.ball.direction,
      lastTouch: matchDetails.ball.lastTouch,
    },
    ...(possessingTeam && { possessingTeam: teamIdentity(possessingTeam) }),
    ...(possessingPlayer && {
      possessingPlayer: playerSummary(possessingPlayer.player, possessingPlayer.team),
    }),
  };
}

function getPlayerInvolvement(
  matchDetails: MatchDetails,
  playerNameOrId: number | string,
): PlayerInvolvement | undefined {
  const found = findPlayer(matchDetails, playerNameOrId);

  if (!found) return undefined;

  const { player, team } = found;

  const current = numericCurrentPosition(player);

  return {
    ...playerSummary(player, team),
    currentPOS: player.currentPOS,
    intentPOS: player.intentPOS,
    hasBall: player.hasBall,
    action: player.action,
    offside: player.offside,
    injured: player.injured,
    fitness: player.fitness,
    stats: player.stats,
    ...(current && { distanceToBall: distance(current, matchDetails.ball.position) }),
    ...(current && { intentDistance: distance(current, player.intentPOS) }),
  };
}

function getTeamThreatSummary(
  matchDetails: MatchDetails,
  teamId: number | string,
): TeamThreatSummary | undefined {
  const team = findTeam(matchDetails, teamId);

  if (!team) return undefined;

  const stats = getTeamStatistics(matchDetails, team.teamID);

  const playersWithPositions = team.players.flatMap((player) => {
    const current = numericCurrentPosition(player);

    return current ? [{ player, current }] : [];
  });

  const distances = playersWithPositions.map(({ player, current }) => ({
    playerID: player.playerID,
    playerName: player.name,
    distance: distance(current, matchDetails.ball.position),
  }));

  const nearestPlayer = distances.toSorted((a, b) => a.distance - b.distance)[0];

  const side = getTeamSide(team, matchDetails.pitchSize[1]);

  const finalThird = getFinalThirdCount(team, matchDetails.pitchSize[1], side);

  const playersAheadOfBall = countPlayersAheadOfBall(team, matchDetails.ball.position[1], side);

  return {
    ...teamIdentity(team),
    intent: team.intent,
    hasPossession: matchDetails.ball.withTeam === team.teamID,
    ballDistance: {
      ...(nearestPlayer && { nearestPlayer }),
      average: average(distances.map((item) => item.distance)),
    },
    attackingShape: {
      playersAheadOfBall,
      playersInFinalThird: finalThird,
      averageIntentAdvance: averageIntentAdvance(team, side),
    },
    production: {
      goals: stats.goals,
      shots: shotsTotal(stats.shots),
      shotsOnTarget: shotsOn(stats.shots),
      passAttempts: sumPlayerStat(team, 'passes'),
      tackleAttempts: sumPlayerStat(team, 'tackles'),
    },
  };
}

function getRecentEvents(matchDetails: MatchDetails, limit = 10): RecentEventsContext {
  const normalizedLimit = Math.max(0, Math.floor(limit));

  const start = Math.max(0, matchDetails.iterationLog.length - normalizedLimit);

  return {
    limit: normalizedLimit,
    totalEvents: matchDetails.iterationLog.length,
    events: matchDetails.iterationLog.slice(start).map((message, offset) => ({
      index: start + offset,
      message,
    })),
  };
}

function getShapeSummary(
  matchDetails: MatchDetails,
  teamId: number | string,
): ShapeSummary | undefined {
  const team = findTeam(matchDetails, teamId);

  if (!team) return undefined;

  const currentPositions = team.players
    .map((player) => player.currentPOS)
    .filter(isNumericPosition);

  const intentPositions = team.players.map((player) => player.intentPOS);

  return {
    ...teamIdentity(team),
    intent: team.intent,
    side: getTeamSide(team, matchDetails.pitchSize[1]),
    centroid: {
      current: centroid(currentPositions),
      intent: centroid(intentPositions),
    },
    verticalSpread: {
      current: spread(currentPositions, 1),
      intent: spread(intentPositions, 1),
    },
    horizontalSpread: {
      current: spread(currentPositions, 0),
      intent: spread(intentPositions, 0),
    },
    players: team.players.map((player) => {
      const current = numericCurrentPosition(player);

      return {
        playerID: player.playerID,
        name: player.name,
        position: player.position,
        currentPOS: player.currentPOS,
        intentPOS: player.intentPOS,
        hasBall: player.hasBall,
        ...(current && {
          intentDelta: [player.intentPOS[0] - current[0], player.intentPOS[1] - current[1]],
        }),
      };
    }),
  };
}

function normalizeScoreboardTeam(team: Team, stats: TeamStatistics): ScoreboardTeam {
  return {
    ...teamIdentity(team),
    goals: stats.goals,
    shots: shotsTotal(stats.shots),
    shotsOnTarget: shotsOn(stats.shots),
    shotsOffTarget: shotsOff(stats.shots),
    corners: stats.corners,
    freekicks: stats.freekicks,
    penalties: stats.penalties,
    fouls: stats.fouls,
  };
}

function teamIdentity(team: Team): TeamIdentity {
  return { id: team.teamID, name: team.name };
}

function playerSummary(player: Player, team: Team): PlayerSummary {
  return {
    id: player.playerID,
    name: player.name,
    teamID: team.teamID,
    teamName: team.name,
    shirtNumber: player.shirtNumber,
    position: player.position,
  };
}

function findTeam(matchDetails: MatchDetails, teamId: number | string): Team | undefined {
  return [matchDetails.kickOffTeam, matchDetails.secondTeam].find((team) => team.teamID === teamId);
}

function findPlayer(
  matchDetails: MatchDetails,
  playerNameOrId: number | string,
): { player: Player; team: Team } | undefined {
  for (const team of [matchDetails.kickOffTeam, matchDetails.secondTeam]) {
    const player = team.players.find(
      (candidate) => candidate.playerID === playerNameOrId || candidate.name === playerNameOrId,
    );

    if (player) return { player, team };
  }

  return undefined;
}

function getTeamStatistics(matchDetails: MatchDetails, teamId: number): TeamStatistics {
  return matchDetails.kickOffTeam.teamID === teamId
    ? matchDetails.kickOffTeamStatistics
    : matchDetails.secondTeamStatistics;
}

function shotsTotal(shots: Shots | number): number {
  return typeof shots === 'number' ? shots : shots.total;
}

function shotsOn(shots: Shots | number): number {
  return typeof shots === 'number' ? 0 : (shots.on ?? 0);
}

function shotsOff(shots: Shots | number): number {
  return typeof shots === 'number' ? 0 : shots.off;
}

function sumPlayerStat(team: Team, stat: 'passes' | 'tackles'): number {
  return team.players.reduce((total, player) => total + player.stats[stat].total, 0);
}

function numericCurrentPosition(player: Player): [number, number] | undefined {
  return isNumericPosition(player.currentPOS) ? player.currentPOS : undefined;
}

function isNumericPosition(position: NormalizedPosition): position is [number, number] {
  return typeof position[0] === 'number';
}

function distance(
  first: readonly [number, number],
  second: readonly [number, number, number?],
): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function centroid(positions: Array<readonly [number, number]>): [number, number] {
  return [
    average(positions.map((position) => position[0])),
    average(positions.map((position) => position[1])),
  ];
}

function spread(positions: Array<readonly [number, number]>, axis: 0 | 1): number {
  if (positions.length === 0) return 0;

  const values = positions.map((position) => position[axis]);

  return Math.max(...values) - Math.min(...values);
}

function getTeamSide(team: Team, pitchHeight: number): TeamSide {
  const firstPosition = team.players[0]?.originPOS;

  if (!firstPosition) return 'unknown';

  return firstPosition[1] < pitchHeight / 2 ? 'top' : 'bottom';
}

function isAheadOfBall(playerY: number, ballY: number, side: TeamSide): boolean {
  if (side === 'top') return playerY > ballY;
  if (side === 'bottom') return playerY < ballY;

  return false;
}

function countPlayersAheadOfBall(team: Team, ballY: number, side: TeamSide): number {
  return team.players.filter((player) => isAheadOfBall(player.currentPOS[1], ballY, side)).length;
}

function getFinalThirdCount(team: Team, pitchHeight: number, side: TeamSide): number {
  if (side === 'top') {
    return team.players.filter((player) => player.currentPOS[1] >= pitchHeight * (2 / 3)).length;
  }

  if (side === 'bottom') {
    return team.players.filter((player) => player.currentPOS[1] <= pitchHeight / 3).length;
  }

  return 0;
}

function averageIntentAdvance(team: Team, side: TeamSide): number {
  if (side === 'unknown') return 0;

  const direction = side === 'top' ? 1 : -1;

  return average(
    team.players.map((player) => (player.intentPOS[1] - player.currentPOS[1]) * direction),
  );
}

export {
  getScoreboard,
  getPossessionContext,
  getPlayerInvolvement,
  getTeamThreatSummary,
  getRecentEvents,
  getShapeSummary,
};
