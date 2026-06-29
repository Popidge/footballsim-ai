import { describe, expect, it } from 'vitest';

import { applyTacticalPreset } from '../adapters/tactics/tacticalPresets.js';
import type { MatchDetails, Player, Team } from '../lib/types.js';

describe('tactical presets', () => {
  it('applies a higher press with an exact engine-field diff', () => {
    const matchDetails = createMatchDetails();

    const result = applyTacticalPreset(matchDetails, 1, 'higherPress');

    expect(matchDetails.kickOffTeam.intent).toBe('attack');
    expect(matchDetails.kickOffTeam.players[5].intentPOS).toEqual([340, 225]);
    expect(matchDetails.kickOffTeam.players[5].action).toBe('sprint');
    expect(result.explanation).toContain('higherPress applied to Top');
    expect(result.diff).toContainEqual({
      field: 'Team.intent',
      teamID: 1,
      before: 'none',
      after: 'attack',
    });
    expect(result.diff).toContainEqual({
      field: 'Player.intentPOS',
      teamID: 1,
      playerID: 6,
      before: [340, 200],
      after: [340, 225],
    });
    expect(result.diff).toContainEqual({
      field: 'Player.action',
      teamID: 1,
      playerID: 6,
      before: 'none',
      after: 'sprint',
    });
  });

  it('applies attacking shifts in the opposite y direction for the bottom team', () => {
    const matchDetails = createMatchDetails();

    const result = applyTacticalPreset(matchDetails, 2, 'increaseAttackingThreat');

    expect(matchDetails.secondTeam.intent).toBe('attack');
    expect(matchDetails.secondTeam.players[9].intentPOS).toEqual([340, 370]);
    expect(matchDetails.secondTeam.players[9].action).toBe('sprint');
    expect(result.diff).toContainEqual({
      field: 'Player.intentPOS',
      teamID: 2,
      playerID: 20,
      before: [340, 400],
      after: [340, 370],
    });
  });

  it('can scope a preset to selected players while still updating team intent', () => {
    const matchDetails = createMatchDetails();

    const result = applyTacticalPreset(matchDetails, 1, 'lowerBlock', { playerIDs: [2] });

    expect(matchDetails.kickOffTeam.intent).toBe('defend');
    expect(matchDetails.kickOffTeam.players[1].intentPOS).toEqual([80, 50]);
    expect(matchDetails.kickOffTeam.players[2].intentPOS).toEqual([230, 80]);
    expect(result.diff).toEqual([
      { field: 'Team.intent', teamID: 1, before: 'none', after: 'defend' },
      { field: 'Player.intentPOS', teamID: 1, playerID: 2, before: [80, 80], after: [80, 50] },
      { field: 'Player.action', teamID: 1, playerID: 2, before: 'none', after: 'intercept' },
    ]);
  });
});

function createMatchDetails(): MatchDetails {
  return {
    matchID: 'preset-test',
    kickOffTeam: createTeam(1, 'Top', 0),
    secondTeam: createTeam(2, 'Bottom', 600),
    pitchSize: [680, 600, 0],
    ball: {
      position: [340, 300, 0],
      withPlayer: false,
      Player: '',
      withTeam: '',
      direction: 'wait',
      ballOverIterations: [],
      lastTouch: { playerName: '', playerID: 0, teamID: 0 },
    },
    half: 1,
    kickOffTeamStatistics: { goals: 0, shots: 0, corners: 0, freekicks: 0, penalties: 0, fouls: 0 },
    secondTeamStatistics: { goals: 0, shots: 0, corners: 0, freekicks: 0, penalties: 0, fouls: 0 },
    iterationLog: [],
  };
}

function createTeam(teamID: number, name: string, goalkeeperY: number): Team {
  const topSide = goalkeeperY === 0;

  const ys = topSide
    ? [0, 80, 80, 80, 80, 200, 200, 200, 320, 400, 400]
    : [600, 520, 520, 520, 520, 400, 400, 400, 280, 400, 400];

  const positions = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'LW', 'ST', 'RW'];

  return {
    name,
    description: '',
    primaryColour: '',
    secondaryColour: '',
    awayColour: '',
    rating: 80,
    intent: 'none',
    teamID,
    players: positions.map((position, index) =>
      createPlayer(teamID * 10 - 9 + index, position, [
        [340, 80, 230, 420, 600, 340, 240, 440, 100, 340, 580][index] ?? 340,
        ys[index] ?? 0,
      ]),
    ),
  };
}

function createPlayer(playerID: number, position: string, originPOS: [number, number]): Player {
  return {
    name: `${position} ${playerID}`,
    shirtNumber: playerID,
    position,
    rating: '80',
    skill: { passing: 1, shooting: 1, tackling: 1, saving: 1, agility: 1, strength: 1, penalty_taking: 1, jumping: 1 },
    currentPOS: originPOS,
    fitness: 100,
    injured: false,
    playerID,
    originPOS,
    intentPOS: [...originPOS],
    action: 'none',
    offside: false,
    hasBall: false,
    stats: { goals: 0, shots: { total: 0, off: 0 }, cards: { yellow: 0, red: 0 }, passes: { total: 0, off: 0 }, tackles: { total: 0, off: 0 } },
  };
}
