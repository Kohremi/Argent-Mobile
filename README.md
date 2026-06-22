# Argent

Web-based implementation of **Argent: The Consortium** (Level 99 Games), built
for local hot-seat play (2–6 players, same browser). No online play; each seat
is either a human or an AI bot (Klank, Malfoy, Thickhide, or DarthPotter).

Built with React + TypeScript + Vite + Tailwind + Zustand.

## Status

Nearing completion. The base game plus **four expansions** are implemented and
playable end-to-end — candidate draft, mage draft, placement / resolution over
all rounds, voter scoring, and final scoring. ~990 tests cover the phase
machine, placement, casting, reactions, research, vault buying, supporter play,
scoring, the AI bots, cross-module games, and edge cases.

Any seat can be filled by an AI bot — **Klank** (greedy heuristics), **Malfoy**
(grab Mana, then research toward big spells), **Thickhide** (randomised with a
few instincts), and **DarthPotter** (win-optimizing: reads the revealed voters
and steers toward the resource criteria it can actually flip) — so a table can
be any mix of humans and bots, including all-bot games that run headless to
completion.

The only notable gap is a small set of base spell books with placeholder
levels (see [Known incomplete](#known-incomplete)).

## Getting started

Requires Node.js 18+.

```sh
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
npm run build      # typecheck + production build
```

## Architecture

Four non-negotiable rules drive the layout:

1. **Content packs are first-class.** Mages, rooms, spells, vault cards,
   supporters, voters, candidates, and bell tower offerings live in
   [`src/content/packs/`](src/content/packs/). Adding an expansion is a new
   pack file (plus its effects); rule-changing expansions add **generic,
   pack-agnostic engine hooks** — the engine never switches on a pack id.
2. **Effects are functions in a registry.** Cards and rooms reference
   effects by ID; implementations live in
   [`src/game/effects/`](src/game/effects/) and self-register via
   `registerEffect(id, fn)`. No giant switch statement.
3. **The engine is pure.** [`src/game/engine.ts`](src/game/engine.ts) is
   `(state, action) => newState` — no React, no DOM, no I/O. Unit-testable
   in isolation.
4. **Rooms / cards are data, not components.** A generic renderer reads
   slot types and costs from data; new rooms and cards are entries, not
   new components.

### Resolution model

Effects return one of three results: `done` (apply patch), `pause` (push a
PendingResolution prompt and wait for the player's answer), or
`open-reaction` (open a reaction window with a list of responders).
Prompts stack LIFO. Reaction windows queue responders in turn order, and
multi-mage spells (Plague, Fireball, etc.) batch every affected mage into
a single window so each affected player gets one reaction across the
entire cast.

Multi-step effects (e.g. "wound a mage, then place one of yours on that
slot") thread state via `resumeContext` between pauses, so each step
runs against a fresh state and never holds stale closures.

### Folder layout

```
src/
  game/
    types.ts                  # all shared types (state, actions, prompts)
    engine.ts                 # pure reducer + phase machine + resolution pumps
    actions.ts                # action validators
    setup.ts                  # initial-state builder + round-setup refresh
    scoring.ts                # mid-game and final scoring (+ custom-scoring registry)
    boardInvariant.ts         # location ↔ slot occupancy invariant + fuzz guard
    effects/
      index.ts                # effect registry
      helpers.ts              # shared helpers (wound, banish, move, etc.)
      base.ts                 # base-pack effect implementations
      mancers.ts              # Mancers (Technomancy) effects
      archmage.ts             # Archmage's Staff effects + custom scoring
      renovation.ts           # Bell Tower Renovation effects
      summerbreak.ts          # Summer Break round-end scenarios + cards
    ai/                       # AI bot personalities (pure decision policies)
      types.ts                # BotPersonality interface
      index.ts                # personality registry + setup picker options
      klank.ts | malfoy.ts | thickhide.ts | darthpotter.ts
  content/
    types.ts                  # ContentPack interface
    packs/                    # base, mancers, archmage, renovation, summerbreak
    registry.ts               # pack registration + lookup
  components/                 # React UI (reads engine state, dispatches actions)
    Setup/SetupScreen.tsx     # 2–6 player setup + pack/bot toggles
    GameScreen.tsx            # main in-game layout (board + dock + rails + prompts)
    Board/ Prompts/ Player/ Council/ HUD/ Modals/ Cards/ FX/
    DebugControls.tsx         # full engine console (draft phases + debug drawer)
    icons.tsx                 # shared SVG icons
  hooks/useKlankDriver.ts     # paces AI-bot dispatch in the React layer
  store/                      # Zustand store (game state, UI state, setup state)
  utils/                      # seeded RNG, view-model selectors, helpers
```

## Content packs

| Pack ID       | Name                       | Status & contents                                                                                                                                            |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base`        | Argent: The Consortium     | Playable core. 12 candidates, 15 rooms (A/B), 26 spell books + 17 legendary, 26 vault cards, 36 supporters, 18 voters, 5 bell tower offerings.                |
| `mancers`     | Mancers of the University  | Implemented. Adds the Technomancy department: orange Technomancer mage, 2 leaders, 6 rooms (Laboratory, Research Archive, Golem Lab, University Tavern, Atelier, Synthesis Workshop), 11 spell books + 3 legendary, 22 vault cards, 13 supporters, 1 voter. |
| `archmage`    | The Archmage's Staff       | Implemented. Adds the Archmage's Staff room — its center slot grants control of the legendary Staff (a one-of-a-kind Treasure) at round end, and a Mage placed there loses all its powers. 2 vault cards, 1 voter. |
| `renovation`  | Bell Tower Renovation      | Implemented. Adds 16 more powerful Bell Tower offerings; each round a random hand sized to the player count is dealt, so the offerings change every round.     |
| `summerbreak` | Summer Break               | Content-complete. Changes the rules as rounds progress: start with two Mages, a guaranteed Dormitory, a 6th round, and a new round-end scenario each round (Students Return / Summer Study Credits / Opening Ceremony). 6 vault cards, 6 supporters. |

Packs are toggled per-game on the setup screen. The base pack is required; the
others can be combined freely.

## What's working

- Full round loop: round-setup → errands → resolution → mid-game scoring
  → next round, with final scoring after the last round (5, or 6 with
  Summer Break).
- Candidate draft with per-candidate starting-spell preview, snake-order
  mage draft (or Summer Break's "start with two Mages" + per-round
  hand-outs), and initial mark placement.
- Placement: regular / merit / shadow / wound slots, per-room caps,
  instant rooms (Guilds), Infirmary (cannot place directly; wounded
  mages return there), room-lock and merit-cost rules. A subset of rooms
  (8 / 10 / 12 by player count) is laid out per game in a random or fixed
  grid.
- Mage powers: Sorcery (Ars Magna — wound an opposing mage to take its
  slot), Planar Studies (fast-action placement), Divinity, Natural
  Magick, Mysticism, Technomancy, and the off-white neutrals.
- Spells: cost + exhaustion + research (L1 INT, L2/L3 WIS), reaction
  spells fire from reaction windows.
- Vault cards: purchase (gold cost + Auric Catalyst reaction), play
  treasures and consumables, exhaustion + round-end refresh, vault
  tableau auto-refills to 3 on draft/buy/remove.
- Supporters: draft, play, secret supporters, passive supporters,
  department mana-discount supporters (Summer Break), and the White Ash
  wild-department choice at endgame.
- Bell Tower offerings with per-round refresh (plus Renovation's random
  per-round hand). Tardy and Stop Time (Temporal Calculus L2) react to
  the last claim and let opponents place a Mage without using Mage
  powers — Stop Time chains two placements through `pendingPlaceChain`.
- Voter system: voters drawn from an 18-card base pool (2 always-face-up
  + face-down draw), per-voter resolution with marks-then-IP tiebreakers,
  mid-round voter reveal, and full endgame Consortium vote scoring
  (department / sorcery / diversity / spells / supporters / Archmage's
  Staff / etc.). Custom criteria register through a scoring registry.
- Influence track: arrival-sequence tiebreaker, +1 MB per 7 IP
  threshold crossed.
- Reactions: Phase Steppers, Invisibility Cloak, Shield Potion, Ancient
  Armor, Mystic Amulet, Auric Catalyst — all fire from the correct
  trigger events (wound / banish / move / shadow / gold-payment-pending /
  bell-tower-last-claimed).
- AI bots: four pluggable personalities (Klank, Malfoy, Thickhide,
  DarthPotter) that can play any seat via pure decision policies in
  `src/game/ai/`, chosen per-seat at setup. All-bot tables run headless
  to completion.
- Determinism: every game is reproducible from its seed. A seeded board
  invariant fuzzer plays full all-bot games — base-only and with every
  pack active — asserting location ↔ occupancy never desyncs after any
  action.

## Known incomplete

- A handful of base spell books still have placeholder levels — casting
  the unwired level throws "effect not registered". **Wrath of Heaven**
  and **Songs of Springtime** are unwired at every level; **Tome of
  Protection** (L3), **The Darkness Within** (L2), **Temporal Calculus,
  6th Ed.** (L2), and **Tardy** (L1) are missing a single level. The card
  text is shown in the UI so unwired cards remain visible.

## Determinism

All randomness routes through [`src/utils/rng.ts`](src/utils/rng.ts)
(seeded mulberry32). Games started with the same seed produce the same
shuffles, which is required for reproducible bug reports and engine
tests. **Never call `Math.random` from engine code.**

## Conventions

- `TODO:` — a rule or detail to revisit.
- `// EXPANSION:` — a place where expansion content interacts with base
  rules in a non-obvious way.
- Every content-bearing entity carries `sourcePackId` so the UI can badge
  expansion content and the engine can validate against the active pack
  list.
- New effects: pick an ID following `<pack>.<category>.<card>.<level?>`
  (e.g. `base.spell.burn.l1`), reference it from the content pack, then
  add a `registerEffect(id, ...)` call in the matching effects module.
  The engine throws "effect not registered" until you wire it up.
