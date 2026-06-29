// example implementation application
import { readFile } from 'fs';

import {
  advanceMatch,
  createMatchSession,
  startSecondHalfForSession,
} from '../app/matchRuntime.js';
import type { MatchSession } from '../app/matchRuntime.js';
import type { MatchDetails, PitchDetails, Team } from '../lib/types.js';

let nextIteration: MatchDetails;

async function init(): Promise<void> {
  await gameOfTenIterations();
}

async function gameOfTenIterations(): Promise<MatchDetails> {
  const t1location = './team1.json';

  const t2location = './team2.json';

  const plocation = './pitch.json';

  const session = await initGame(t1location, t2location, plocation);

  nextIteration = advanceMatch(session, { iterations: 5 }) as MatchDetails;
  nextIteration = startSecondHalfForSession(session) as MatchDetails;
  nextIteration = advanceMatch(session, { iterations: 5 }) as MatchDetails;

  return nextIteration;
}

async function initGame(t1: string, t2: string, p: string): Promise<MatchSession> {
  const team1 = (await readDataFile(t1)) as Team;

  const team2 = (await readDataFile(t2)) as Team;

  const pitch = (await readDataFile(p)) as PitchDetails;

  return createMatchSession({ team1, team2, pitch });
}

function readDataFile(filePath: string): Promise<unknown> {
  return new Promise(function (resolve, reject) {
    readFile(filePath, 'utf8', function (err, data) {
      if (err) {
        reject(err);
      } else {
        // Resolve the result of JSON.parse directly.
        // It's safe to resolve 'any' into a Promise typed as 'unknown'.
        resolve(JSON.parse(data));
      }
    });
  });
}

export { init };
