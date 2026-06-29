import { expect, it, describe } from 'vitest';

import {
  advanceMatch,
  createMatchSession,
  getMatchSnapshot,
  startSecondHalfForSession,
} from '../app/matchRuntime.js';
import { readFile } from '../lib/fileReader.js';
import type { MatchDetails, PitchDetails, Team } from '../lib/types.js';

async function readInput<T>(filePath: string): Promise<T> {
  return (await readFile(filePath)) as T;
}

async function createTestSession() {
  const [team1, team2, pitch] = await Promise.all([
    readInput<Team>('./src/init_config/team1.json'),
    readInput<Team>('./src/init_config/team2.json'),
    readInput<PitchDetails>('./src/init_config/pitch.json'),
  ]);

  return createMatchSession({ team1, team2, pitch, seed: 12345 });
}

describe('match runtime adapter', function () {
  it('creates a session and returns cloned snapshots', async () => {
    const session = await createTestSession();

    const snapshot = getMatchSnapshot(session) as MatchDetails;

    const originalHalf = snapshot.half;

    snapshot.half = 99;

    expect(getMatchSnapshot(session).half).to.equal(originalHalf);
  });

  it('advances and starts the second half through engine facade methods', async () => {
    const session = await createTestSession();

    const advanced = advanceMatch(session, { iterations: 2 });

    const secondHalf = startSecondHalfForSession(session);

    expect(advanced.iterationLog).to.be.an('array');
    expect(secondHalf.half).to.equal(2);
  });

  it('rejects invalid iteration counts', async () => {
    const session = await createTestSession();

    expect(() => advanceMatch(session, { iterations: -1 })).to.throw(
      'iterations must be a non-negative integer',
    );
  });
});
