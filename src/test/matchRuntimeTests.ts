import { expect, it, describe } from 'vitest';

import {
  advanceMatch,
  createMatchSession,
  getMatchSnapshot,
  startSecondHalfForSession,
} from '../app/matchRuntime.js';
import type { MatchSnapshot } from '../app/matchRuntime.js';
import { readFile } from '../lib/fileReader.js';
import type { MatchDetails, PitchDetails, Team } from '../lib/types.js';

async function readInput<T>(filePath: string): Promise<T> {
  return (await readFile(filePath)) as T;
}

async function readInputSet() {
  const [team1, team2, pitch] = await Promise.all([
    readInput<Team>('./src/init_config/team1.json'),
    readInput<Team>('./src/init_config/team2.json'),
    readInput<PitchDetails>('./src/init_config/pitch.json'),
  ]);

  return { pitch, team1, team2 };
}

async function createTestSession() {
  return createMatchSession({ ...(await readInputSet()), seed: 12345 });
}

describe('match runtime adapter', function () {
  it('returns clone-isolated snapshots with a readonly snapshot contract', async () => {
    const session = await createTestSession();

    const snapshot: MatchSnapshot = getMatchSnapshot(session);

    const mutableSnapshot = structuredClone(snapshot) as MatchDetails;

    const originalHalf = snapshot.half;

    // @ts-expect-error MatchSnapshot fields are readonly for callers.
    snapshot.half = 99;
    mutableSnapshot.half = 99;

    expect(getMatchSnapshot(session).half).to.equal(originalHalf);
  });

  it('advances and starts the second half through engine facade methods', async () => {
    const session = await createTestSession();

    const beforeAdvance = getMatchSnapshot(session);

    const advanced = advanceMatch(session, { iterations: 2 });

    const secondHalf = startSecondHalfForSession(session);

    expect(advanced.iterationLog).not.to.eql(beforeAdvance.iterationLog);
    expect(secondHalf.half).to.equal(beforeAdvance.half + 1);
    expect(secondHalf.iterationLog).to.eql([
      `Second Half Started: ${beforeAdvance.secondTeam.name} to kick offs`,
    ]);
  });

  it('keeps seeded session progression isolated across interleaved sessions', async () => {
    const uninterrupted = await createTestSession();

    const interleaved = await createTestSession();

    const noise = createMatchSession({
      ...(await readInputSet()),
      seed: 54321,
    });

    const uninterruptedSnapshot = advanceMatch(uninterrupted, { iterations: 2 });

    advanceMatch(interleaved, { iterations: 1 });
    advanceMatch(noise, { iterations: 1 });
    const interleavedSnapshot = advanceMatch(interleaved, { iterations: 1 });

    expect(interleavedSnapshot).to.eql(uninterruptedSnapshot);
  });

  it('rejects invalid iteration counts', async () => {
    const session = await createTestSession();

    expect(() => advanceMatch(session, { iterations: -1 })).to.throw(
      'iterations must be a non-negative integer',
    );
  });
});
