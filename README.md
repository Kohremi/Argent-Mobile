# Argent

A web-based implementation of **Argent: The Consortium** (Level 99 Games),
built for local hot-seat play — 2–6 players in one browser, no online play.
Every seat is a human or an AI bot, so a table can be any mix, including all-bot
games that run headless to completion.

Built with **React + TypeScript (strict) + Vite + Tailwind + Zustand**. No
backend; the game engine is a pure reducer.

## Status

Feature-complete for the planned scope. The base game, **four expansion packs**,
and **six alternate-mode scenarios** are implemented and playable end-to-end —
candidate draft, mage draft, placement / resolution across all rounds, the full
Consortium voter scoring, and final scoring. **1,100+ Vitest specs** cover the
phase machine, placement, casting, reactions, research, vault/supporter play,
scoring, the four AI bots, every scenario, cross-module games, and a seeded
board-invariant fuzzer that plays full all-bot games with every pack active.

Four AI personalities can fill any seat: **Klank** (greedy heuristics),
**Malfoy** (grab Mana, then research toward big spells), **Thickhide**
(randomised with a few instincts), and **DarthPotter** (win-optimising — reads
the revealed voters and steers toward criteria it can flip).

Every spell-book level across all packs resolves through a registered effect —
including the reaction-timing levels, which fire from reaction windows rather
than a cast-time effect — so there are no placeholder spells.

## Getting started

Requires Node.js 18+.

```sh
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
npm run build      # typecheck + production build
```

## Scenarios

Scenarios are alternate **5-round game modes** that layer a persistent rule
change plus a per-round twist onto the normal game. They're selected
independently of content packs on the setup screen, and compose with them (a
scenario *and* an expansion pack can both be active). The engine never switches
on a scenario id — every mechanic is a typed behaviour flag read at a fixed hook
(see [docs/scenarios.md](docs/scenarios.md)).

| #  | Scenario               | The twist                                                                                                   |
| -- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1  | **Dimensional Rift**   | Every empty room flips to its other side each round; each round warps time differently (fast-action costs, extra actions, shadow-first resolution, a voluntary-pass final round). |
| 2  | **Talismans of Magic** | Each mage starts with their school's Synthesis Treasure (requires Mancers); rounds reward the Vault and research. |
| 3  | **The Well of Souls**  | When casting, sacrifice an office Mage to the Infirmary to cut a Spell's cost by up to 3; rounds loosen casting and grant research. |
| 4  | **Key to the University** | A victory-point game — most Influence wins. The Influence voters are removed and every voter grants IP (7, or 4 each when tied) instead of a vote. |
| 5  | **Political Struggle** | Voters split into two factions; spend a Mark to add a Support Marker to a faction instead. The faction with more support has each of its voters count **double** at the election. |
| 6  | **Assassins**          | Spend a Mark to place a **Hit** on a face-down voter instead; a voter struck 3 times is assassinated — discarded and replaced. A round-3 action sends a Mage to the Infirmary to strike twice. |

## Content packs

| Pack ID       | Name                       | Contents                                                                                                                                            |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`        | Argent: The Consortium     | The playable core. 12 candidates, 15 rooms (A/B sides), 26 spell books + 17 legendary, 26 vault cards, 36 supporters, 18 voters, 5 bell-tower offerings. |
| `mancers`     | Mancers of the University  | Adds the Technomancy department: the orange Technomancer mage, 2 leaders, 6 rooms (Laboratory, Research Archive, Golem Lab, University Tavern, Atelier, Synthesis Workshop), 11 spell books + 3 legendary, 22 vault cards, 13 supporters, 1 voter. |
| `archmage`    | The Archmage's Staff       | Adds the Archmage's Staff room — its centre slot grants control of the one-of-a-kind legendary Staff at round end, and a Mage placed there loses all its powers. 2 vault cards, 1 voter. |
| `renovation`  | Bell Tower Renovation      | Adds 16 more powerful Bell-Tower offerings; each round a fresh random hand sized to the player count is dealt, so the offerings change every round. |
| `summerbreak` | Summer Break               | Changes the rules as rounds progress: start with two Mages, a guaranteed Dormitory, a 6th round, and a new round-end scenario each round (Students Return / Summer Study Credits / Opening Ceremony). 6 vault cards, 6 supporters. |

Packs are toggled per game on the setup screen. The base pack is required; the
others combine freely (and with any scenario).

## Architecture

Four non-negotiable rules drive the layout:

1. **Content packs are first-class data.** Mages, rooms, spells, vault cards,
   supporters, voters, candidates, and bell-tower offerings live in
   [`src/content/packs/`](src/content/packs/). Adding an expansion is a new pack
   file (plus its effects); rule-changing expansions add **generic,
   pack-agnostic engine hooks** — the engine never switches on a pack id.
2. **Effects are functions in a registry.** Cards and rooms reference effects by
   ID; implementations live in [`src/game/effects/`](src/game/effects/) and
   self-register via `registerEffect(id, fn)`. No giant switch statement.
3. **The engine is pure.** [`src/game/engine.ts`](src/game/engine.ts) is
   `(state, action) => newState` — no React, no DOM, no I/O, no `Math.random`.
   Unit-testable in isolation.
4. **Rooms / cards / scenarios are data, not components.** A generic renderer
   reads slot types and costs from data; new rooms, cards, and scenarios are
   entries, not new components or `if (id === …)` branches.

### Scenarios are data too

A scenario is a `Scenario` object (in
[`src/content/scenarios.ts`](src/content/scenarios.ts)) whose persistent and
per-round rules are typed behaviour flags. The engine reads those flags at a
small set of fixed hook points — the same "no switch on id" discipline as packs,
which is what lets a scenario and a pack both be active and both fire their
round-end rewards. Round-end rewards reuse the same pump as a pack's
`roundEndScenarios`. Full guide: [docs/scenarios.md](docs/scenarios.md).

### Resolution model

Effects return one of three results: `done` (apply a patch), `pause` (push a
`PendingResolution` prompt and wait for the player's answer), or `open-reaction`
(open a reaction window with a list of responders). Prompts stack LIFO. Reaction
windows queue responders in turn order, and multi-mage spells (Plague, Fireball,
…) batch every affected mage into a single window so each affected player gets
one reaction across the entire cast.

Multi-step effects (e.g. "wound a mage, then place one of yours on that slot")
thread state via `resumeContext` between pauses — serializable continuations,
never JS closures — so each step runs against fresh state and never holds stale
captures.

### Folder layout

```
src/
  game/
    types.ts                  # all shared types (state, actions, prompts, scenarios)
    engine.ts                 # pure reducer + phase machine + resolution pumps
    setup.ts                  # initial-state builder + round-setup refresh
    scoring.ts                # mid-game and final scoring (+ custom-scoring registry)
    boardInvariant.ts         # location ↔ slot occupancy invariant + fuzz guard
    effects/
      index.ts                # effect registry + side-effect imports
      helpers.ts              # shared helpers (wound, banish, move, gain-mark, etc.)
      base.ts                 # base-pack effects
      mancers.ts archmage.ts renovation.ts summerbreak.ts   # expansion-pack effects
      talismans.ts wellofsouls.ts keytotheuniversity.ts \
        politicalstruggle.ts assassins.ts                   # scenario effects
    ai/                       # AI bot personalities (pure decision policies)
      types.ts index.ts common.ts
      klank.ts | malfoy.ts | thickhide.ts | darthpotter.ts
  content/
    types.ts                  # ContentPack interface
    packs/                    # base, mancers, archmage, renovation, summerbreak
    scenarios.ts              # Scenario registry (the 6 alternate game modes)
    registry.ts               # pack registration + lookup (eager)
  components/                 # React UI (reads engine state, dispatches actions)
    Setup/SetupScreen.tsx     # 2–6 player setup + pack/bot/scenario pickers
    GameScreen.tsx            # main in-game layout (board + dock + rails + prompts)
    Board/ Prompts/ Player/ Council/ HUD/ Modals/ Cards/ FX/
    DebugControls.tsx         # full engine console (draft phases + debug drawer)
  store/                      # Zustand store (game state, UI state, setup state)
  utils/                      # seeded RNG, view-model selectors, helpers
```

> [AGENTS.md](AGENTS.md) is the deeper architectural guide — read it before
> making engine or effect changes.

## What's working

- **Full round loop:** round-setup → errands → resolution → mid-game scoring →
  next round, then final scoring after the last round (5, or 6 with Summer
  Break; always 5 under a scenario).
- **Setup:** candidate draft with starting-spell preview, snake-order mage draft
  (or Summer Break's "start with two Mages" + per-round hand-outs), and initial
  mark placement.
- **Placement:** regular / merit / shadow / wound slots, per-room caps, instant
  rooms (Guilds), the Infirmary (can't place directly; wounded mages return
  there), room-lock and merit-cost rules, random or fixed grid layouts.
- **Mage powers:** Sorcery (Ars Magna), Planar Studies (fast-action placement),
  Divinity, Natural Magick, Mysticism, Technomancy, and the off-white neutrals.
- **Spells:** cost + exhaustion + research (L1 INT, L2/L3 WIS); reaction spells
  fire from reaction windows.
- **Vault cards & supporters:** purchase (gold + Auric Catalyst reaction), play
  treasures/consumables, secret + passive supporters, department mana-discount
  supporters, and the White Ash wild-department choice at endgame.
- **Bell Tower:** per-round refresh, plus Renovation's random per-round hand;
  Tardy / Stop Time react to the last claim.
- **Voters:** drawn from the base pool (always-face-up + face-down), per-voter
  resolution with marks-then-IP tiebreakers, mid-round reveal, and full endgame
  Consortium scoring (departments / diversity / spells / supporters / Archmage's
  Staff / custom criteria via a scoring registry).
- **Scenarios:** all six alternate modes (see above), composable with packs.
- **AI bots:** four pluggable personalities, chosen per seat; all-bot tables run
  headless to completion.
- **Determinism:** every game is reproducible from its seed; a board-invariant
  fuzzer plays full all-bot games — base-only and with every pack active —
  asserting location ↔ occupancy never desyncs after any action.

## Determinism

All randomness routes through [`src/utils/rng.ts`](src/utils/rng.ts) (seeded
mulberry32) operating on `state.rng`; all ids come from `state.nextSequenceId`.
Games started with the same seed produce the same shuffles — required for
reproducible bug reports and engine tests. **Never call `Math.random` or
`Date.now` from engine code.**

## Conventions

- `TODO:` — a rule or detail to revisit. `// EXPANSION:` — a spot where
  expansion content interacts with base rules in a non-obvious way.
- Every content-bearing entity carries `sourcePackId` so the UI can badge
  expansion content and the engine can validate against the active pack list.
- New effects: pick an ID following `<pack>.<category>.<card>.<level?>` (e.g.
  `base.spell.burn.l1`), reference it from the content data, then add a
  `registerEffect(id, …)` call in the matching effects module. The engine
  throws "effect not registered" until it's wired.
- After any change, run `npm run typecheck` and `npm run test`.
