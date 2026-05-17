# Argent

Web-based implementation of **Argent: The Consortium** (Level 99 Games), built
for local hot-seat play (2–6 players, same browser). No online play, no AI.

Built with React + TypeScript + Vite + Tailwind + Zustand.

## Status

The base pack is playable end-to-end: candidate draft, mage draft, all 5
rounds of placement / resolution, voter scoring, and final game scoring.
303+ engine tests cover phase machine, placement, casting, reactions,
research, vault buying, supporter play, scoring, and edge cases.

Known gaps (in active iteration): a handful of spells, supporters, and
vault cards still have placeholder effects. They show their card text but
their action throws "effect not yet registered" when triggered. The
expansion packs (Mancers, Knights, Ascension, Promo) are stubs.

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
   pack file — no engine changes.
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
  components/
    Setup/SetupScreen.tsx     # 2–6 player setup + pack toggles
    DebugControls.tsx         # the main game UI (board + prompts + HUD)
    icons.tsx                 # shared SVG icons
  game/
    types.ts                  # all shared types (state, actions, prompts)
    engine.ts                 # pure reducer + phase machine + resolution pumps
    actions.ts                # action validators
    setup.ts                  # initial-state builder + round-setup refresh
    scoring.ts                # mid-game and final scoring
    effects/
      index.ts                # effect registry
      helpers.ts              # shared helpers (wound, banish, move, etc.)
      base.ts                 # base-pack effect implementations
      mancers.ts | knights.ts | ascension.ts | promo.ts  # expansion stubs
  content/
    types.ts                  # ContentPack interface
    packs/                    # base, mancers, knights, ascension, promo
    registry.ts               # pack registration + lookup
  store/                      # Zustand store (game state, setup state)
  utils/                      # seeded RNG, helpers
```

## Content packs

| Pack ID     | Name                              | Status                                                        |
| ----------- | --------------------------------- | ------------------------------------------------------------- |
| `base`      | Argent: The Consortium            | Playable. 14 candidates, 8 rooms (A/B), 25+ spell books + 6 legendary, 26 vault cards, 36 supporters, 18 voters, 3 bell tower offerings. |
| `mancers`   | Mancers of the University         | Empty                                                         |
| `knights`   | Saturday Knight Special           | Empty                                                         |
| `ascension` | Era of Ascension                  | Empty                                                         |
| `promo`     | Promo & Kickstarter               | Empty                                                         |

Packs are toggled per-game on the setup screen. The base pack is required.

## What's working

- Full round loop: round-setup → errands → resolution → mid-game scoring
  → next round, with final scoring after round 5.
- Candidate draft with 2 leaders per department and per-candidate
  starting spell preview.
- Snake-order mage draft with the full base mage roster.
- Placement: regular / merit / shadow / wound slots, per-room caps,
  instant rooms (Guilds), Infirmary (cannot place directly; wounded
  mages return there), room-lock and merit-cost rules.
- Mage powers: Sorcery (Ars Magna — wound an opposing mage to take its
  slot), Planar Studies (fast-action placement), Divinity, Natural
  Magick, Mysticism, and the off-white neutrals.
- Spells: cost + exhaustion + research (L1 INT, L2/L3 WIS), reaction
  spells fire from reaction windows. Most base-pack spells are wired;
  the unwired ones surface their card text but throw on cast.
- Vault cards: purchase (gold cost + Auric Catalyst reaction), play
  treasures and consumables, exhaustion + round-end refresh, vault
  tableau auto-refills to 3 on draft/buy/remove.
- Supporters: draft, play, secret supporters, wild-department choice
  (White Ash) at endgame.
- Bell Tower offerings (Gain IP, First Player Token, Gold or Mana) with
  per-round refresh. Tardy and Stop Time (Temporal Calculus L2) react to
  the last claim and let opponents place a Mage without using Mage
  powers — Stop Time chains two placements through `pendingPlaceChain`.
- Voter system: 12 voters (2 always-face-up + 10 face-down), per-voter
  resolution with marks-then-IP tiebreakers, mid-round voter reveal,
  and full endgame Consortium vote scoring (department / sorcery /
  diversity / spells / supporters / etc.).
- Influence track: arrival-sequence tiebreaker, +1 MB per 7 IP
  threshold crossed.
- Reactions: Phase Steppers, Invisibility Cloak, Shield Potion, Ancient
  Armor, Mystic Amulet, Auric Catalyst — all fire from the correct
  trigger events (wound / banish / move / shadow / gold-payment-pending /
  bell-tower-last-claimed).
- Determinism: every game is reproducible from its seed; 303+ Vitest
  specs run in under 2 s.

## Known incomplete

- A handful of spells, supporters, and vault cards still have placeholder
  effects (no `registerEffect` call — casting them throws). Card text is
  shown in the UI so unwired cards are visible.
- All expansion packs (Mancers, Knights, Ascension, Promo) are stubs.

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
