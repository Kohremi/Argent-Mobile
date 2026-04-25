# Argent

Web-based implementation of **Argent: The Consortium** (Level 99 Games) with full
expansion support. Local hot-seat multiplayer (2–6 players, same browser); no
online play, no AI.

Built with React + TypeScript + Vite + Tailwind + Zustand.

## Status

Early scaffold. The setup screen, content-pack system, and engine plumbing are
in place. Action handlers, effects, and the real board UI are stubbed.

See [the next-step suggestion](#next-step) below.

## Getting started

Requires Node.js (18+).

```sh
npm install
npm run dev        # start the Vite dev server
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
npm run build      # typecheck + production build
```

## Architecture

Four non-negotiable rules drive the layout:

1. **Content packs are first-class.** All mages, rooms, spells, treasures,
   councils, and familiars live in [`src/content/packs/`](src/content/packs/).
   Adding an expansion means adding a new pack file — no engine changes.
2. **Effects are functions in a registry.** Cards and rooms reference effects
   by ID; effect implementations live in [`src/game/effects/`](src/game/effects/)
   and register themselves via `registerEffect(id, fn)`. No giant switch.
3. **The engine is pure.** [`src/game/engine.ts`](src/game/engine.ts) is
   `(state, action) => newState` — no React, no DOM, no I/O. Unit-testable in
   isolation.
4. **Rooms are data, not components.** A generic Room renderer reads action
   spaces and costs from data; new rooms are data entries, not new components.

### Folder layout

```
src/
  components/        # UI (Board, Player, Council, Cards, Setup, HUD, Modals)
  game/
    types.ts         # all shared types
    engine.ts        # pure reducer
    actions.ts       # action validators
    setup.ts         # initial-state builder
    scoring.ts       # mid- and end-game scoring
    effects/         # effect registry + per-pack effect modules
  content/
    types.ts         # ContentPack interface
    packs/           # base, mancers, knights, ascension, promo
    registry.ts      # pack registration + lookup
  store/             # Zustand stores (game state, setup screen state)
  utils/             # seeded RNG, helpers
  App.tsx
  main.tsx
```

## Content packs

| Pack ID     | Name                              | Status                              |
| ----------- | --------------------------------- | ----------------------------------- |
| `base`      | Argent: The Consortium            | Stub data: 4 mages, 4 rooms, 5 spells, 5 councils |
| `mancers`   | Mancers of the University         | Empty                               |
| `knights`   | Saturday Knight Special           | Empty                               |
| `ascension` | Era of Ascension                  | Empty                               |
| `promo`     | Promo & Kickstarter               | Empty                               |

Packs are toggled per-game on the setup screen. The base pack is required.

## What's working

- Setup screen with pack toggles, 2–6 player names, "Start Game".
- `initGame(config)` assembles content from active packs, seeds the RNG,
  shuffles decks, and produces a valid `GameState`.
- Placeholder game screen renders the assembled state (players, rooms,
  councils, active packs) so you can verify pack composition end-to-end.

## What's stubbed

- Action handlers (`PLACE_WORKER`, `CAST_SPELL`, `BUY_TREASURE`, `PASS_TURN`,
  `USE_ABILITY`) all throw "not yet implemented". `ADVANCE_PHASE` is a no-op.
- All card / room / mage effect functions (none registered yet).
- Mage draft, familiar assignment, starting-hand deal, market population.
- Council vote counts (all 0 pending rulebook lookup).
- Scoring resolution (mid-game and final).
- Action validation (`validateAction` is a no-op).
- Components in `Board/`, `Player/`, `Council/`, `Cards/`, `HUD/`, `Modals/`.

## Determinism

All randomness routes through [`src/utils/rng.ts`](src/utils/rng.ts) (seeded
mulberry32). Games started with the same seed produce the same shuffles, which
is required for reproducible bug reports and engine tests. **Never call
`Math.random` from engine code.**

## Conventions

- `TODO:` — a rule or detail to revisit.
- `// EXPANSION:` — a place where expansion content interacts with base rules
  in a non-obvious way.
- Every content-bearing entity carries `sourcePackId` so the UI can badge
  expansion content and the engine can validate against the active pack list.

## Next step

Implement the engine's phase machine first, before any room or card effects.
Flesh out `ADVANCE_PHASE` in [`src/game/engine.ts`](src/game/engine.ts) to walk
`setup → refresh → action → resolution → mid-scoring → next round / final-scoring → complete`,
and write a Vitest spec that drives a 5-round game forward through phase
transitions only. That gives a reliable spine to hang action handlers and
effect resolution on, and locks in the determinism story before content
complexity arrives.
