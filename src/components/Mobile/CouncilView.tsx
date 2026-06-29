import { getScenario } from '../../content/scenarios';
import type { ConsortiumVoter, GameState } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { FactionSection, VoterRow } from '../Council/CouncilTower';

/**
 * The Consortium for the mobile shell, laid out in two columns. Each column is
 * headed by a face-up voter (the leaders), with the sealed voters dealt out
 * beneath — which lines up naturally with Political Struggle's two factions
 * (rendered as the two FactionSection columns when that scenario is active).
 */

function TwoColumns({ state }: { state: GameState }) {
  const headers = state.voters.filter((v) => v.isAlwaysFaceUp);
  const others = state.voters.filter((v) => !v.isAlwaysFaceUp);
  const cols: ConsortiumVoter[][] = [[], []];
  // A face-up leader heads each column…
  headers.forEach((v, i) => cols[i % 2]!.push(v));
  // …then the sealed voters fill the shorter column each time, so the two
  // columns stay balanced even when a scenario leaves an odd number of leaders.
  // (Key to the University removes the Most-Influence leader, so a single leader
  // would otherwise skew the columns to 7/5 instead of an even 6/6.)
  others.forEach((v) => {
    const target = cols[0]!.length <= cols[1]!.length ? 0 : 1;
    cols[target]!.push(v);
  });

  return (
    <div className="grid grid-cols-2 items-start gap-2">
      {cols.map((col, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          {col.map((v) => (
            <VoterRow key={v.id} state={state} voter={v} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CouncilView() {
  const state = useGameStore((s) => s.state);
  if (!state || state.voters.length === 0) {
    return <div className="p-4 text-sm italic text-white/45">No voters in play.</div>;
  }

  // Political Struggle splits voters into two colored factions — those become
  // the two columns directly.
  const scenario = state.scenarioId ? getScenario(state.scenarioId) : undefined;
  const groups = scenario?.supportGroups?.groups;
  const factioned = !!(state.voterGroups && groups);

  return (
    // No header row here — the bottom tab already reads "Council", and dropping
    // it lets all twelve voter tiles fit on screen without a scrollbar.
    <div className="h-full overflow-y-auto p-2">
      {factioned ? (
        <div className="grid grid-cols-2 items-start gap-2">
          {groups!.map((g) => (
            <FactionSection key={g.id} state={state} group={g} />
          ))}
        </div>
      ) : (
        <TwoColumns state={state} />
      )}
    </div>
  );
}
