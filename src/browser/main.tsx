import { StrictMode, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import { applyTacticalPreset } from '../adapters/tactics/tacticalPresets.js';
import {
  advanceMatch,
  createMatchSession,
  getMatchSnapshot,
  updateMatchSession,
} from '../app/matchRuntime.js';
import type { MatchSession, MatchSnapshot } from '../app/matchRuntime.js';
import {
  getPlayerInvolvement,
  getPossessionContext,
  getRecentEvents,
  getScoreboard,
  getShapeSummary,
  getTeamThreatSummary,
} from '../adapters/assistant/readTools.js';
import pitch from '../init_config/pitch.json' with { type: 'json' };
import team1 from '../init_config/team1.json' with { type: 'json' };
import team2 from '../init_config/team2.json' with { type: 'json' };
import type { MatchDetails, PitchDetails, Team } from '../lib/types.js';

import './styles.css';

interface PrototypeState {
  session: MatchSession;
  snapshot: MatchSnapshot;
  assistantMessage: string;
  lastPreset: string;
}

const chunkSize = 5;

function createInitialState(): PrototypeState {
  const session = createMatchSession({
    pitch: pitch as PitchDetails,
    seed: 20260229,
    team1: structuredClone(team1) as unknown as Team,
    team2: structuredClone(team2) as unknown as Team,
  });

  return {
    session,
    snapshot: getMatchSnapshot(session),
    assistantMessage:
      'Ask the staff for grounded diagnostics, then apply an engine-validated tactical preset.',
    lastPreset: 'None yet',
  };
}

function App(): ReactElement {
  const [state, setState] = useState(createInitialState);

  const diagnostics = useMemo(() => buildDiagnostics(state.snapshot), [state.snapshot]);

  function advanceChunk(): void {
    setState((current) => ({
      ...current,
      snapshot: advanceMatch(current.session, { iterations: chunkSize }),
      assistantMessage: `Advanced ${chunkSize} engine iterations. Recent event feed and player positions are refreshed from match state.`,
    }));
  }

  function resetMatch(): void {
    setState(createInitialState());
  }

  function explainStriker(): void {
    const striker =
      state.snapshot.kickOffTeam.players.find((player) => player.position === 'ST') ??
      state.snapshot.kickOffTeam.players[10];
    const involvement = getPlayerInvolvement(state.snapshot as MatchDetails, striker.playerID);

    if (!involvement) return;

    const distance = involvement.distanceToBall?.toFixed(1) ?? 'unknown';
    const passAttempts = involvement.stats.passes.total;
    const shots = involvement.stats.shots.total;

    setState((current) => ({
      ...current,
      assistantMessage: `${involvement.name} is ${distance} units from the ball, has ${passAttempts} pass attempt(s), ${shots} shot(s), action '${involvement.action}', and fitness ${involvement.fitness}. This answer is generated from read-tool facts, not free-form state guessing.`,
    }));
  }

  function explainOpponentThreat(): void {
    const threat = getTeamThreatSummary(
      state.snapshot as MatchDetails,
      state.snapshot.secondTeam.teamID,
    );

    if (!threat) return;

    setState((current) => ({
      ...current,
      assistantMessage: `${threat.name} threat: ${threat.attackingShape.playersAheadOfBall} player(s) ahead of the ball, ${threat.attackingShape.playersInFinalThird} in the final third, ${threat.production.shots} shot(s), and nearest pressure from ${threat.ballDistance.nearestPlayer?.playerName ?? 'n/a'} at ${threat.ballDistance.nearestPlayer?.distance.toFixed(1) ?? 'n/a'} units.`,
    }));
  }

  function makeCompact(): void {
    setState((current) => {
      const update = updateMatchSession(current.session, (matchDetails) =>
        applyTacticalPreset(matchDetails, matchDetails.kickOffTeam.teamID, 'moreCompact'),
      );

      return {
        ...current,
        snapshot: update.snapshot,
        lastPreset: update.result.explanation,
        assistantMessage: `${update.result.explanation} The assistant changed only engine fields reported in the preset diff.`,
      };
    });
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Browser-first vertical slice</p>
          <h1>Agentic Football Manager Prototype</h1>
          <p>
            Inspired by the upstream footballsim-demo telemetry dashboard, this UI keeps the local
            engine adapters as the source of truth while adding a coaching-staff panel.
          </p>
        </div>
        <div className="score-card">
          <span>{diagnostics.score.teams.kickOff.name}</span>
          <strong>
            {diagnostics.score.teams.kickOff.goals} - {diagnostics.score.teams.second.goals}
          </strong>
          <span>{diagnostics.score.teams.second.name}</span>
          <small>
            Half {diagnostics.score.half} · Seed {state.session.seed}
          </small>
        </div>
      </header>

      <section className="controls">
        <button
          type="button"
          onClick={advanceChunk}
        >
          Simulate next {chunkSize}
        </button>
        <button
          type="button"
          onClick={explainStriker}
        >
          Why is our striker not involved?
        </button>
        <button
          type="button"
          onClick={explainOpponentThreat}
        >
          How are they hurting us?
        </button>
        <button
          type="button"
          onClick={makeCompact}
        >
          Make us more compact
        </button>
        <button
          type="button"
          onClick={resetMatch}
        >
          Reset deterministic match
        </button>
      </section>

      <section className="dashboard">
        <Pitch snapshot={state.snapshot} />
        <aside className="panel assistant">
          <h2>Coaching staff</h2>
          <p>{state.assistantMessage}</p>
          <h3>Last tactical preset</h3>
          <p>{state.lastPreset}</p>
        </aside>
        <aside className="panel">
          <h2>Telemetry</h2>
          <dl>
            <dt>Ball</dt>
            <dd>{diagnostics.possession.ball.position.join(', ')}</dd>
            <dt>Possession</dt>
            <dd>{diagnostics.possession.possessingTeam?.name ?? 'Loose ball'}</dd>
            <dt>Our shape spread</dt>
            <dd>
              {diagnostics.shape.verticalSpread.current.toFixed(1)} vertical /{' '}
              {diagnostics.shape.horizontalSpread.current.toFixed(1)} horizontal
            </dd>
          </dl>
        </aside>
        <aside className="panel events">
          <h2>Recent engine events</h2>
          <ol>
            {diagnostics.events.events.map((event) => (
              <li key={event.index}>{event.message}</li>
            ))}
          </ol>
        </aside>
      </section>
    </main>
  );
}

function Pitch({ snapshot }: { snapshot: MatchSnapshot }): ReactElement {
  const width = snapshot.pitchSize[0] ?? 1;
  const height = snapshot.pitchSize[1] ?? 1;
  const players = [
    ...snapshot.kickOffTeam.players.map((player) => ({ player, side: 'home' })),
    ...snapshot.secondTeam.players.map((player) => ({ player, side: 'away' })),
  ];

  return (
    <section
      className="pitch"
      aria-label="Match pitch"
    >
      {players.map(({ player, side }) => {
        if (player.currentPOS[0] === 'NP') return null;

        return (
          <span
            className={`player ${side}`}
            key={player.playerID}
            style={{
              left: `${(Number(player.currentPOS[0]) / width) * 100}%`,
              top: `${(Number(player.currentPOS[1]) / height) * 100}%`,
            }}
            title={`${player.name} (${player.position})`}
          >
            {player.position}
          </span>
        );
      })}
      <span
        className="ball"
        style={{
          left: `${((snapshot.ball.position[0] ?? 0) / width) * 100}%`,
          top: `${((snapshot.ball.position[1] ?? 0) / height) * 100}%`,
        }}
      />
    </section>
  );
}

function buildDiagnostics(snapshot: MatchSnapshot) {
  const mutableSnapshot = snapshot as MatchDetails;

  return {
    events: getRecentEvents(mutableSnapshot, 8),
    possession: getPossessionContext(mutableSnapshot),
    score: getScoreboard(mutableSnapshot),
    shape: getShapeSummary(mutableSnapshot, snapshot.kickOffTeam.teamID) ?? {
      horizontalSpread: { current: 0, intent: 0 },
      verticalSpread: { current: 0, intent: 0 },
    },
  };
}

createRoot(document.querySelector('#root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
