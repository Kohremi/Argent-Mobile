# AGENTS.md

Orientation for any agent working in this repository. Read this before making
changes; it explains how the game is structured and where things live so you
can make correct edits without re-deriving the architecture each time.

> This file is the architectural source of truth. [README.md](README.md) is
> user-facing and has drifted in places (e.g. it lists the Mancers pack as a
> stub — it is now substantially implemented). When the two disagree, trust the
> code, then update whichever doc is wrong.

---

## 1. What this is

A web implementation of **Argent: The Consortium** (Level 99 Games) — a
worker-placement board game. Local hot-seat (2–6 players, one browser); no
online play. Any seat can be filled by a human or by an AI bot personality
(see §4a).

**Stack:** React 18 + TypeScript (strict) + Vite + Tailwind + Zustand. Tests in
Vitest. No backend.

## 2. Commands

```sh
npm run dev        # Vite dev server (http://localhost:5173)
npm run typecheck  # tsc --noEmit  — run this after any change
npm run test       # vitest run    — full suite (~910 tests, runs in a few seconds)
npm run build      # typecheck + production build
```

After any change, run **`npm run typecheck` and `npm run test`** before
considering the work done. The engine suite ([src/game/engine.test.ts](src/game/engine.test.ts))
is the safety net for game-logic changes.

**Environment note:** primary shell is PowerShell on Windows. A Bash tool is
also available for POSIX scripts. Prefer the dedicated file/search tools over
shell `cat`/`grep`/`find`.

## 3. The four architectural rules

These are non-negotiable; they're what keep the codebase scalable across the
real game's enormous card pool and its five expansions.

1. **Content packs are first-class data.** Mages, rooms, spells, vault cards,
   supporters, voters, candidates, and bell-tower offerings are plain data in
   [src/content/packs/](src/content/packs/). Adding an expansion is a new pack
   file — no engine changes.
2. **Effects are functions in a registry.** Cards and rooms reference behavior
   by an `effectId` string; implementations live in
   [src/game/effects/](src/game/effects/) and self-register via
   `registerEffect(id, fn)`. There is **no giant switch statement** on card ids.
3. **The engine is pure.** [src/game/engine.ts](src/game/engine.ts) is
   `applyAction(state, action) => newState` — no React, no DOM, no I/O, no
   `Date.now()`, no `Math.random`. This is what makes it unit-testable and
   replayable.
4. **Rooms and cards are data, not components.** Generic React renderers read
   slot types, costs, and descriptions from the data. New rooms/cards are
   entries, not new components.

If a change tempts you to violate one of these (e.g. `if (room.id === ...)` in
the engine, or `Math.random()` anywhere in `src/game/`), stop and find the
data-driven / registry-driven way to do it. The one sanctioned exception is
small **UI** special-cases keyed on room id/structure in the rendering layer
(see `isPoolRoom`, Astronomy Tower track) — never in the engine.

## 4. Directory map

```
src/
  game/                      # THE PURE ENGINE — no React/DOM/IO
    types.ts                 # all shared types: GameState, GameAction, GamePhase,
                             #   EffectContext/Result, prompts, rooms, cards (~1600 lines)
    engine.ts                # applyAction reducer + phase machine + resolution "pumps" (~3100 lines)
    actions.ts               # validateAction hook (currently a no-op stub; per-action
                             #   legality checks live inline in the engine handlers)
    setup.ts                 # buildInitialState + per-round refresh
    scoring.ts               # mid-game + final Consortium scoring
    effects/
      registry.ts            # registerEffect / getEffect / hasEffect (the Map)
      index.ts               # re-exports registry + side-effect-imports every pack's effects
      helpers.ts             # shared primitives: wound/banish/move/shadow, target builders,
                             #   reaction-option builder, immunity checks, etc.
      base.ts                # base-pack effect impls   (~21k lines, 300+ effects)
      mancers.ts             # Mancers expansion effects (~4k lines, 70+ effects)
      knights.ts/ascension.ts/promo.ts  # still empty stubs
    ai/                      # AI bot personalities — pure decision policies (§4a)
      types.ts               # BotPersonality contract
      index.ts               # registry + setup picker options
      klank.ts               # greedy tiered cascade
      thickhide.ts           # mostly-random with a few instincts
      malfoy.ts              # grab Mana, then research toward big spells
  content/
    types.ts                 # ContentPack interface
    registry.ts              # registerPack + getPack/requirePack/listPacks (eager)
    packs/
      base.ts                # base pack data (rooms, mages, spells, vault, supporters, voters…)
      mancers.ts             # Mancers data
      knights.ts/ascension.ts/promo.ts  # stubs (empty arrays)
  store/                     # Zustand — the React<->engine boundary
    gameStore.ts             # holds GameState; dispatch = applyAction
    uiStore.ts               # presentation-only state (selection, toasts, FX, drawers)
    setupStore.ts            # pre-game setup form state
  components/                # React UI (reads engine state, dispatches actions)
    Setup/SetupScreen.tsx    # 2–6 player setup + pack toggles
    GameScreen.tsx           # main in-game layout (TopBar, board, dock, rails, prompts)
    Board/
      CampusBoard.tsx        # grid layout of rooms
      RoomScene.tsx          # one room card: slots, occupants, placement interactions
      MageToken.tsx, TableauShelf.tsx
    Prompts/
      PromptDirector.tsx     # routes top-of-pending-stack to a visual interaction
      usePromptTargets.ts    # exposes current prompt's eligible mages/spaces to the board
      promptHelpers.ts
    Player/ Council/ HUD/ Modals/ Cards/ FX/
    DebugControls.tsx        # full engine console (used for draft phases + debug drawer)
    icons.tsx
  utils/
    rng.ts                   # seeded mulberry32 — the ONLY randomness source
    uiSelectors.ts           # derived view-model helpers (eligible slots, pool detection, hues)
    helpers.ts
  hooks/
    useKlankDriver.ts        # drives bot seats in the React layer (paces dispatch)
docs/
  UI_DESIGN.md               # design-system + UI architecture spec
  effect-resolution.md       # ORIGINAL design proposal (historical; shapes have since changed)
  argent_data/*.tsv          # extracted card/room/voter data from the physical game
```

## 4a. AI bots

Any seat can be played by a bot. A `BotPersonality`
([src/game/ai/types.ts](src/game/ai/types.ts)) is a pair of **pure** decision
functions — `chooseErrandsAction(state, playerId)` and
`answerPendingResolution(state, pending)` — that read engine truth and return a
legal `GameAction` / `ResolutionAnswer`. They enumerate legality with the same
dry-run selectors the human UI uses
([src/utils/uiSelectors.ts](src/utils/uiSelectors.ts)), so a bot can never
attempt an illegal move, and they seed any randomness from the state so a given
state always yields the same choice (reproducible, testable).

Personalities self-register in [src/game/ai/index.ts](src/game/ai/index.ts)
(and appear in the setup per-seat picker):

- **Klank** — greedy tiered cascade (research → disrupt an opponent → value
  seats → any placement → Bell Tower).
- **Thickhide** — mostly random with a few instincts (Merit budgeting,
  opponent-only harmful targeting).
- **Malfoy** — grab the best Mana seat once per round, then pivot to Research
  for big spells; all trumped by casting disruptive spells on opponents.

Shared rules they all honor: only ever aim harmful effects at opponents, and
never occupy more Merit seats than Merit Badges held this round.
[src/hooks/useKlankDriver.ts](src/hooks/useKlankDriver.ts) paces a bot seat's
dispatch in the React layer. Each personality has unit tests plus a headless
all-bot game that must run to completion ([src/game/ai/](src/game/ai/)).

## 5. Core data model

`GameState` ([src/game/types.ts](src/game/types.ts)) is the single source of
truth. Notable fields:

- `players`, `rooms` (+ `roomLayout` grid for adjacency-aware spells), `voters`,
  the deck/tableau pairs (`spellDeck`/`spellTableau`, `vaultDeck`/`vaultTableau`,
  `supporterDeck`/`supporterTableau`), `bellTower`, `legendarySpells`.
- `phase: GamePhase` — discriminated union; drives the whole game loop.
- `pendingResolutionStack: PendingResolution[]` — **LIFO** stack of open player
  prompts. The engine refuses `ADVANCE_PHASE` while any prompt is open.
- `activeReactionWindows: ReactionWindow[]` — open reaction windows, each owning
  a queue of responder prompts.
- Several **drain queues** that the engine "pumps" when the stack goes idle:
  `researchQueue`, `pendingPlaceChain`, `pendingMysticismPostCast`,
  `pendingTechnomancyTrigger`, `pendingRevivalChecks`, `pendingContractResearch`,
  `pendingBellTowerLastEvent`. (See §7.)
- `activeBuffs: ActiveBuff[]` — immunities, shadow-on-place, energy-drain, etc.
- `rng: RngState` + `rngSeed` — deterministic randomness state.
- `nextSequenceId` — single monotonic counter for **all** deterministic ids
  (resolution ids, reaction-window ids, log ids) and influence arrival order.
  Never generate ids any other way.

`GameStatePatch = Partial<GameState>`. Effects return patches; the engine
shallow-merges them.

## 6. The effect system

This is the heart of the codebase and where most card/room work happens.

### Effect IDs

Format: `<pack>.<category>.<card>[.<level/slot>]`, e.g.
`base.spell.burn.l1`, `base.room.library.slot-2`,
`mancers.room.golem-lab-a.slot-2`, `base.vault.phase-steppers.react`.

Data entries (in `content/packs/`) reference an `effectId`; the implementation
lives in `game/effects/<pack>.ts` and calls `registerEffect(id, fn)` at module
load. If a card names an effectId that nobody registered, the engine throws
`Effect "<id>" is not registered` when it's triggered. That's the intended
"not yet wired" state — the card still shows its text in the UI.

### Effect signature

```ts
type Effect = (ctx: EffectContext) => EffectResult;

interface EffectContext {
  state: GameState;
  source: ResolutionSource;        // what triggered this (card/room/mage/system)
  triggeringPlayerId: PlayerId;
  resumeContext?: SerializableContext;  // data threaded from a prior pause (see below)
  resumeAnswer?: ResolutionAnswer;      // the player's answer to the prompt we paused on
  allowReactions: boolean;              // false while resolving a reaction (reactions can't be reacted to)
}

type EffectResult =
  | { kind: 'done';          patch: GameStatePatch }
  | { kind: 'pause';         patch?; pending: PendingResolutionInput }   // need player input
  | { kind: 'open-reaction'; patch?; window:  ReactionWindowInput }      // apply, then open reaction window
```

Effects are **pure**: same context in → same result out. They never mutate
`state`; they describe a patch. The engine assigns ids (so effects return
`*Input` shapes without ids).

### Multi-step effects = continuations, NOT closures

A multi-step effect ("wound a mage, then place one of yours on its slot") is
split across multiple registered effects. Step 1 returns `pause` with a
`pending` whose `resume.effectId` names the next step and whose
`resume.context` carries the in-flight data. The engine surfaces the prompt;
when the player answers, it invokes the resume effect with `resumeContext` +
`resumeAnswer` against **fresh state**.

This is deliberate: continuations are serializable data, never JS closures, so
a game can be saved/replayed mid-prompt and each step runs against current
state (no stale captures). Thread state through `resumeContext`, never through a
closed-over variable.

`PendingPrompt` kinds and their matching `ResolutionAnswer` kinds are the
prompt vocabulary (`choose-target-mage`/`mage-chosen`,
`choose-target-action-space`/`space-chosen`, `choose-from-options`/
`option-chosen`, `reaction-window`/`reaction-played`|`reaction-passed`, etc.).
See [src/game/types.ts](src/game/types.ts) §"Effect resolution".

### helpers.ts is shared infrastructure

Before writing a harmful-effect or placement effect, check
[src/game/effects/helpers.ts](src/game/effects/helpers.ts). It owns the
canonical primitives: `woundMage`, banish/move/shadow placement, target
builders (`buildBurnTargets`, `buildSpellMoveTargets`, `buildSpellShadowTargets`,
`buildHarmfulMageTargets`), immunity/lock/power checks (`isMageImmuneByBuff`,
`isRoomLocked`, `magesLosePowers`), and `buildReactionOptionsFor` (decides which
reactions each player is offered for a trigger event). Centralizing here means a
rule fix (e.g. "no shadowing in noShadowSlots rooms") lands in one place and
every dependent effect inherits it.

## 7. Resolution model: the stack and the pumps

- **Prompts stack LIFO.** Composed effects and reaction windows nest naturally.
  The UI renders the top of `pendingResolutionStack`.
- **Reaction windows** queue responders in turn order starting clockwise from
  the triggering player (who is excluded). Each player reacts at most once per
  action; reactions cannot themselves be reacted to (`allowReactions=false`).
  Per the rulebook, reactions fire **after** the action resolves (respond to
  consequences; no counter-spell/rollback in base Argent).
- **Batch spells** (Plague, Fireball, Tsunami, …) put every affected mage into a
  single window so each affected player gets one reaction across the whole cast.
- **Drain queues / "pumps":** several mechanics defer work until the resolution
  stack is idle, then surface one item at a time — research grants, Stop/Slow
  Time placement chains, Mysticism post-cast placement, Technomancy
  post-placement triggers, Revival checks, bell-tower-last-claimed reactions.
  Look for `drain*IfIdle` functions in [src/game/engine.ts](src/game/engine.ts).
  When adding an effect that "grants N of X to surface later," prefer pushing
  onto the appropriate queue rather than nesting N prompts inline.

### Rule: instant-room rewards — placement vs. move

Instant rooms (Guilds, Great Hall, Golem Lab, …) fire their slot reward when a
Mage is **placed** there from the office. **Moving an already-placed Mage into a
slot NEVER claims an instant-room reward** — only a fresh placement does. So:

- **Placements** claim the reward: the engine's `PLACE_WORKER` reward prompt
  (`pushResolutionChoicePrompt`) and the effect-side equivalent
  `patchWithMaybeInstantReward` (Tardy/Stop Time, shadow placements, Ars Magna
  takeover, Natural Magick B's *seizing* Mage, …).
- **Moves** claim nothing: route every relocation through
  `moveMageToSpace` ([helpers.ts](src/game/effects/helpers.ts)), which by
  construction produces no reward prompt. Gust of Wind, Paralocation, Cut Plane /
  Fade, the Infirmary-move spells, and Natural Magick B's *displaced opponent*
  all inherit the rule for free.

When writing a new effect that lands a Mage on a slot, decide which it is: if the
Mage is already on the board, it's a move (use `moveMageToSpace`, no reward); if
it's a fresh placement from the office, claim the reward via
`patchWithMaybeInstantReward`.

## 8. Phase machine

`GamePhase` is a discriminated union; `applyAction` + `ADVANCE_PHASE` walk it:

```
setup → candidate-draft → mage-draft-first-choice (2p only) → mage-draft
      → initial-mark-placement → round-setup
      → [ errands → resolution → mid-game-scoring ] × 5 rounds
      → final-scoring → complete
```

- **errands**: players take turns spending one Action (+ optional Fast Action,
  + any bonus actions from Flare/Dazzle/Bend Time) placing mages / casting /
  buying / playing cards / claiming bell-tower offerings.
- **resolution**: rooms resolve in order; each occupied slot's effect fires
  (base occupant before shadow occupant). Pointers `pendingRoomIndex` /
  `pendingSpaceIndex` / `pendingSlotPosition` track progress.
- Room locks clear at resolution start; most round-scoped buffs expire here.

## 9. Adding content (the common task)

### A new spell / vault card / supporter

1. Add the data entry to the relevant array in
   [src/content/packs/&lt;pack&gt;.ts](src/content/packs/) with a fresh
   `effectId` following the naming convention. Include `sourcePackId`,
   human-readable `name`/`description`, costs, levels, timing.
2. Implement and `registerEffect(id, fn)` in
   [src/game/effects/&lt;pack&gt;.ts](src/game/effects/). Reuse helpers.ts
   primitives. For multi-step effects, register each step and chain via
   `pending.resume.effectId`.
3. Add a test in [src/game/engine.test.ts](src/game/engine.test.ts) covering the
   happy path + key edge cases (immunity, empty target set, reactions).
4. `npm run typecheck && npm run test`.

The UI generally needs **no** changes — generic renderers read the data. Touch
components only for genuinely novel presentation.

### A new room

Rooms are data in the pack file: `Room` with `actionSpaces: ActionSpace[]`, each
slot carrying a `slotType` (`regular` / `merit` / `shadow` / `shadow-merit` /
`wound`), optional `costToActivate`, `description`, and an `effectId`. Useful
room flags: `isInstantRoom`, `cannotBePlacedInDirectly` (Infirmary),
`cannotBeLocked`, `maxMagesPerPlayerPerRound`, `noShadowSlots` (no shadow
positions — Great Hall, Golem Lab). The board renders pool rooms (many
identical slots, e.g. Great Hall) and the Infirmary as growing tile rows; see
`isPoolRoom` / `visibleRoomSpaces` in [src/utils/uiSelectors.ts](src/utils/uiSelectors.ts).

### A new expansion pack

Create `src/content/packs/<id>.ts` exporting a `ContentPack`, register it in
[src/content/registry.ts](src/content/registry.ts), create
`src/game/effects/<id>.ts`, and side-effect-import it in
[src/game/effects/index.ts](src/game/effects/index.ts). No engine edits.

## 10. UI layer

- **gameStore** holds `GameState`; `dispatch(action)` = `applyAction`. The UI
  never mutates state directly (except the debug `patchState` escape hatch).
- **uiStore** holds presentation-only state (selected mage, toasts, room FX,
  drawer open). `tryDispatch` wraps dispatch: clears selection on success,
  turns engine rejections into a toast instead of throwing.
- **PromptDirector** routes the top pending resolution to a visual interaction;
  targeting prompts light up the board/dock via **usePromptTargets**.
- The main in-game board is **CampusBoard → RoomScene**. **DebugControls** is
  the full engine console — used for the pre-campus draft phases
  ([src/App.tsx](src/App.tsx)) and as a debug drawer inside the game.
- Reference [docs/UI_DESIGN.md](docs/UI_DESIGN.md) for the design system.

## 11. Determinism (hard rule)

Every game must be reproducible from `(rngSeed, action[])`. Therefore:

- **All randomness** routes through [src/utils/rng.ts](src/utils/rng.ts)
  (seeded mulberry32) operating on `state.rng`. **Never call `Math.random()` in
  `src/game/`.**
- **All ids** come from `state.nextSequenceId`. No `Date.now()`, no `uuid`, no
  counters outside state. (UI-only ephemeral ids like `roomFx` may use
  `Date.now()` since they never enter game state.)

## 12. Conventions

- `TODO:` — a rule/detail to revisit. `// EXPANSION:` — a spot where expansion
  content interacts with base rules non-obviously.
- Every content entity carries `sourcePackId` so the UI can badge it and the
  engine can validate against the active pack list.
- Match the surrounding code's comment density and idiom — engine and effect
  files are heavily commented with the *why* (rulebook citations, edge-case
  rationale). Keep that up when you change behavior.
- Prefer fixing a rule once in `helpers.ts` (or a shared builder) over patching
  each call site.

## 13. Status (as of this writing)

- **base** pack: playable end-to-end (draft → 5 rounds → scoring). 300+ effects
  wired; a handful of cards still surface text but throw on trigger.
- **mancers** pack: substantially implemented (70+ effects: Golem Lab,
  University Tavern, Technomancy, Black Chronicle, Eternal Engine, treasures…).
- **knights / ascension / promo**: empty stubs (data arrays + effect modules
  exist but are empty).
- **AI bots**: Klank, Thickhide, and Malfoy ([src/game/ai/](src/game/ai/)) can
  fill any seat; all-bot tables run to completion (§4a).
- ~910 Vitest specs pass; the bulk live in
  [src/game/engine.test.ts](src/game/engine.test.ts).
