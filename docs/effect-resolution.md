# Effect Resolution Design

**Status:** historical design proposal — **now implemented, with changes.**
This is the original pre-implementation write-up, kept for the rationale behind
the resolution model. The system it describes is fully built and is the heart
of the engine, but several shapes drifted during implementation — **trust the
code and AGENTS.md over the exact signatures below.**

Key differences from what shipped:

- `EffectResult` is a single discriminated union
  (`{ kind: 'done' | 'pause' | 'open-reaction', … }`), not the combinable
  `{ patch?, openReactionWindow?, pending? }` sketched here.
- Multi-step effects thread state via `resumeContext` / `resumeAnswer` on the
  `EffectContext` (continuations as data, not closures).
- Open prompts live on `GameState.pendingResolutionStack`; reaction windows on
  `GameState.activeReactionWindows`.

For the current model see **AGENTS.md §6–7**,
[src/game/types.ts](../src/game/types.ts) (the "Effect resolution" types), and
[src/game/engine.ts](../src/game/engine.ts). The original proposal follows.

---

This document proposes how Argent's card, room, and ability effects should
resolve, with particular attention to mid-resolution player input
(target-picks, OR-choices) and reaction windows.

## TL;DR

- **Synchronous reducer, never promises.** Effects return either a complete
  `GameStatePatch` *or* a `PendingResolution` describing what input is needed.
  The engine pauses; the UI prompts; the active responder dispatches a
  `RESOLVE_PENDING` action; the engine resumes.
- **Pending resolutions form a stack** (LIFO) so reaction windows and
  composed effects nest cleanly.
- **Continuations are data, not closures.** Each pending resolution names a
  `resumeEffectId` (registered effect) plus a serializable context blob, so
  saved games can be reloaded mid-prompt.
- **Reaction windows** are modeled as a queue of "ask the next non-active
  player" prompts that fires automatically when an effect declares it opens
  one. Each prompt resolves to react-or-pass; reacting can push more
  resolutions onto the stack.

## 1. Sync vs. async-with-choices — recommendation

**Recommendation: synchronous reducer with explicit pending state.**

Reasons:

1. **Engine purity.** `applyAction(state, action) => state` keeps unit tests
   trivial and lets us replay any game from `(rngSeed, action[])`. Promises
   would force the reducer to be async and the store to deal with
   pending-future state, which is a worse correctness model than just adding
   a `pendingResolution` field that the engine reads on the next tick.
2. **Save/load.** A game in the middle of a Vault pick must be resumable
   from cold. The full game state must encode "we're waiting on player X to
   pick a card" — that's a value in `state`, not a stack frame in JS.
3. **Multi-step UI.** Rendering a turn that has multiple sequential choices
   is just rendering the head of the pending stack. The UI doesn't have to
   know anything about the effect graph.

The cost: effects are fragmented across multiple registered functions
(initial step + one resume function per branch). The pattern below keeps
that manageable.

## 2. PendingResolution model

### Stack, not single

The current `GameState.pendingResolution: PendingResolution | null` should
become a stack:

```ts
pendingResolutionStack: PendingResolution[];  // top = current prompt
```

`null`-singular doesn't compose: a Wound spell (Vault pick → reaction
window → counter-spell → reaction window) needs nesting. A stack handles
this naturally — each new prompt pushes; resolution pops and may push more.

(The `pendingResolution: PendingResolution | null` stub stays for now;
it'll move to `pendingResolutionStack` when this design lands.)

### Shape

```ts
export interface PendingResolution {
  /** Ascending counter so logs / UI can identify this prompt uniquely. */
  id: string;

  /** Player who must respond. May not be the active player (reactions). */
  responderId: PlayerId;

  /** Discriminated union — see `PendingPrompt` below. */
  prompt: PendingPrompt;

  /**
   * Effect to invoke once the answer is received. The answer is passed via
   * EffectContext.choices. `context` carries any in-flight data the resume
   * effect needs (target ids, accumulated picks, etc.).
   */
  resume: {
    effectId: EffectId;
    context: SerializableContext;
  };

  /** Source card / mage / ability that triggered this prompt — for the UI. */
  source: ResolutionSource;

  /**
   * Per-rulebook deadlines: a reaction window auto-passes after some time;
   * a forced choice has no deadline. Optional for now (UI manages timeout).
   */
  deadlineMs?: number;
}

export type PendingPrompt =
  | { kind: 'choose-from-options'; options: PromptOption[] }
  | { kind: 'choose-target-mage'; eligibleMageIds: OwnedMageId[] }
  | { kind: 'choose-target-player'; eligiblePlayerIds: PlayerId[] }
  | { kind: 'choose-vault-card'; eligibleVaultCardIds: VaultCardId[] }
  | { kind: 'choose-spell-card'; eligibleSpellCardIds: SpellCardId[] }
  | { kind: 'choose-spell-level'; spellCardId: SpellCardId; levels: (1|2|3)[] }
  | { kind: 'choose-voter'; eligibleVoterIds: ConsortiumVoterId[] }
  | { kind: 'choose-room'; eligibleRoomIds: RoomId[] }
  | { kind: 'reaction-window'; reactableEffectId: EffectId; canReactWith: ReactableSource[] }
  | { kind: 'confirm'; message: string };

export interface PromptOption {
  id: string;          // stable answer id
  label: string;       // UI text
  data?: unknown;      // free-form payload returned in the answer
  available: boolean;  // false renders the option disabled with `unavailableReason`
  unavailableReason?: string;
}

/** Anything a player can dispatch to satisfy the prompt's input contract. */
export type ResolutionAnswer =
  | { kind: 'option'; optionId: string }
  | { kind: 'mage'; mageId: OwnedMageId }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'vault-card'; vaultCardId: VaultCardId }
  | { kind: 'spell-card'; spellCardId: SpellCardId; level?: 1|2|3 }
  | { kind: 'voter'; voterId: ConsortiumVoterId }
  | { kind: 'room'; roomId: RoomId }
  | { kind: 'react'; sourceCardId: string; payload?: unknown }
  | { kind: 'pass' }
  | { kind: 'cancel' };  // used when an effect is interruptible

export interface ResolutionSource {
  kind: 'spell' | 'mage-ability' | 'room' | 'supporter' | 'vault-card' | 'system';
  id: string;
  /** Free-form for UI tooltips. */
  description: string;
}
```

`SerializableContext` is anything `JSON.stringify`-able. No functions, no
class instances. This is the constraint that makes save/load work.

### Resolution flow (reducer-side)

```ts
case 'RESOLVE_PENDING': {
  const top = peek(state.pendingResolutionStack);
  if (!top) throw new Error('RESOLVE_PENDING: no pending resolution');
  if (top.responderId !== action.playerId) throw new Error('wrong responder');

  validateAnswer(top.prompt, action.answer);

  // Pop the resolution we're answering.
  const popped = { ...state, pendingResolutionStack: drop(state.pendingResolutionStack) };

  // Invoke the resume effect. It receives the answer in ctx.choices and the
  // effect's accumulated context in ctx.sourceCardId / ctx.choices.context.
  const resume = getEffect(top.resume.effectId);
  const result = resume({ state: popped, playerId: top.responderId, choices: { answer: action.answer, context: top.resume.context } });

  return applyEffectResult(popped, result);
}
```

`applyEffectResult` is shared between `RESOLVE_PENDING` and direct effect
invocations (e.g., from `PLACE_WORKER`):

```ts
function applyEffectResult(state: GameState, result: EffectResult): GameState {
  let updated = mergePatch(state, result.patch ?? {});
  if (result.openReactionWindow) {
    updated = openReactionWindow(updated, result.openReactionWindow);
  }
  if (result.pending) {
    updated = pushPending(updated, result.pending);
  }
  return updated;
}
```

## 3. Reaction window model

### Rulebook-resolved rules (p.11)

These are no longer open questions:

- **Reactions trigger *after* the action resolves**, not before. There is no
  counter-spell / cancellation in base Argent. Reactions respond to
  *consequences*, so the engine applies the action's patch first and only
  then opens the reaction window. (Effects that need cancellable behavior
  for some future expansion can model it via compensating patches in the
  reaction effect, but base content does not need rollback.)
- **Each player may react at most once per specific action.** Tracked on
  the `ReactionWindow` via `reactedPlayerIds`. Once a player reacts, they
  are skipped if the window asks for them again.
- **Reactions occur in turn order starting from the triggering player.**
  Build the responder queue clockwise from the current player; the
  triggering player themselves is excluded.
- **Reactions cannot be reacted to.** The engine sets
  `EffectContext.allowReactions = false` while resolving a reaction
  effect, and refuses to open a new reaction window during that
  resolution.
- **The Mysticism Mage's "place after spell" ability triggers *after*
  reactions resolve.** Implement as the `afterResume` continuation on the
  reaction window — when the queue drains, the engine invokes
  `afterResume`, which is the post-reaction effect (e.g.,
  `base.spell.burn.l1.complete` runs the Mysticism follow-up if the
  caster's Mage is grey).

### Mechanics

A reaction window is a queue of "ask player X to react or pass" prompts.
The original effect's `patch` is applied *before* the window opens. The
window owns a `pendingResponderIds` queue and an `afterResume`
continuation invoked when the queue drains.

```
state.activeReactionWindows.top  ← current open window (LIFO)
  pendingResponderIds: [B, C, D]
  reactedPlayerIds: []
  afterResume: { effectId: 'base.spell.burn.l1.complete', context: {} }

state.pendingResolutionStack.top
  reaction-window prompt for B  ← current responder
```

Cycle:
1. Engine pops B's prompt; B answers `reaction-passed` or `reaction-played`.
2. On `reaction-passed`: drop B from `pendingResponderIds`, push the next
   responder's prompt (C). If queue empty, pop the window and invoke
   `afterResume`.
3. On `reaction-played`: invoke the reaction effect with
   `allowReactions = false`; apply its patch; mark B in
   `reactedPlayerIds`; drop B from `pendingResponderIds`; push C's
   prompt or invoke `afterResume`.

Reactions cannot themselves be reacted to, so a reaction effect's
`open-reaction` result is rejected (or simply ignored) by the engine
while `allowReactions === false`.

```ts
export interface ReactionWindow {
  id: ReactionWindowId;
  triggerEvent: ReactionTriggerEvent;
  pendingResponderIds: PlayerId[];   // queue, drained in turn order
  reactedPlayerIds: PlayerId[];      // each player reacts at most once
  afterResume: ResumeContinuation;   // runs when queue drains
  source: ResolutionSource;
}
```

### Future-proofing for expansions

Some expansion content (Mancers? Knights?) may introduce true cancellation
or pre-resolution interrupts. The current engine doesn't support that, but
the design leaves room: a future "interrupt window" type would open
*before* the action's patch applies, with a similar queue model. We won't
add it until expansion content actually requires it.

## 4. Refined Effect signature

```ts
export interface EffectContext {
  state: GameState;
  playerId: PlayerId;
  /** Active card / room / ability — used by effects that need their own id. */
  source?: ResolutionSource;
  /**
   * For initial invocations, the player's pre-action choices (e.g., chosen
   * spell level). For resume invocations, includes `{ answer, context }`
   * from the resolved PendingResolution.
   */
  choices?: unknown;
}

export interface EffectResult {
  /** State diff to apply unconditionally. */
  patch?: GameStatePatch;
  /** If set, the engine opens a reaction window before the patch finalizes. */
  openReactionWindow?: ReactionWindow;
  /** If set, pause the engine and await player input. */
  pending?: PendingResolution;
}

export type Effect = (ctx: EffectContext) => EffectResult;
```

A single effect entry can declare any combination of {patch, reaction
window, pending}. Composing effects = chain them via `pending.resume`.

### Conventions

- An effect that needs no input returns `{ patch }`.
- An effect that needs input returns `{ pending }` with the prompt + a
  `resumeEffectId`. The resume effect typically returns `{ patch }`, or
  another `{ pending }` if it needs more input.
- An effect that triggers a reaction returns `{ patch, openReactionWindow }`.
  The patch is applied speculatively; if a reaction overrides it (e.g.,
  Counter-spell), the reaction effect can emit a "rollback" or compensating
  patch via its own `patch` field. (Argent doesn't have true rollbacks —
  reactions usually replace or modify, not undo. Flagged in Open Questions.)

## 5. Worked examples

### Example A — Library slot 2 ("Gain 1 INT or 1 WIS or 1 Research")

Effect ids:
- `base.room.library.slot2` — initial
- `base.room.library.slot2.apply` — resume

```ts
registerEffect('base.room.library.slot2', (ctx) => ({
  pending: {
    id: nextPromptId(),
    responderId: ctx.playerId,
    prompt: {
      kind: 'choose-from-options',
      options: [
        { id: 'int', label: 'Gain 1 INT', available: true },
        { id: 'wis', label: 'Gain 1 WIS', available: true },
        { id: 'research', label: 'Gain 1 Research (use immediately)', available: true },
      ],
    },
    resume: { effectId: 'base.room.library.slot2.apply', context: {} },
    source: { kind: 'room', id: 'base.room.library', description: 'Library — slot 2' },
  },
}));

registerEffect('base.room.library.slot2.apply', (ctx) => {
  const choice = (ctx.choices as { answer: ResolutionAnswer }).answer;
  if (choice.kind !== 'option') throw new Error('expected option answer');
  switch (choice.optionId) {
    case 'int':      return { patch: addResources(ctx, { intelligence: 1 }) };
    case 'wis':      return { patch: addResources(ctx, { wisdom: 1 }) };
    case 'research': return { pending: askWhereToSpendResearch(ctx) };  // chains
    default: throw new Error(`unknown option ${choice.optionId}`);
  }
});
```

### Example B — Casting a Wound spell

Caster targets a Mage, then opponents may react, then the wound applies.
If the caster is a Mysticism (grey) Mage, they then get to place a mage as
a follow-up.

Effect chain:
1. `base.spell.wound.cast` — pays cost; pushes `choose-target-mage` pending.
2. `base.spell.wound.target-chosen` — opens reaction window targeting all
   non-active players in clockwise order; resume = `apply-wound`.
3. `base.spell.wound.apply` — applies the wound patch; if caster's Mage is
   grey, pushes follow-up `choose-action-space` pending.
4. `base.spell.wound.followup-place` — applies placement.

Each player's reaction prompt has `prompt.kind === 'reaction-window'` with
`canReactWith` listing valid reaction-timing Supporter cards / Spells the
player owns. They answer `{ kind: 'react', sourceCardId, payload }` or
`{ kind: 'pass' }`. A `react` answer pushes the reactor's effect (e.g., a
Counter-spell) onto the stack; that effect can patch state to negate the
incoming wound (e.g., by adding a flag to context that
`base.spell.wound.apply` checks before applying its patch).

### Example C — Vault room resolution (3 sequential picks)

When the resolution phase reaches the Vault, occupied slots resolve in
slot order (1st pick / 2nd pick / 3rd pick), each picked by a different
player. The room's resolution is itself a chain of pending resolutions:

1. Engine enters resolution; finds occupied Vault slot 1 (Player A).
2. Effect `base.room.vault.pick` returns `pending: choose-vault-card` with
   eligible = `state.vaultTableau`. Resume = `base.room.vault.pay-and-take`.
3. Player A answers; resume effect deducts gold, moves card to A's office,
   removes it from tableau. `pending: pick-card` for Player B (slot 2) is
   pushed (or, equivalently, the resolution-step engine call advances the
   `pendingSpaceIndex` and the next ADVANCE_PHASE invokes the next slot).
4. Repeat for slot 3.

Two equivalent encodings:
- **Effect-chained:** each pick effect explicitly pushes the next pick.
- **Phase-driven:** the resolution phase machine advances per slot and
  invokes each slot's effect independently.

I'd recommend phase-driven for room resolution because it keeps the
resolution-phase pointer (`pendingRoomIndex` / `pendingSpaceIndex`) as the
single source of truth. The room's per-slot effect stays small (just the
choose-card prompt + apply patch).

## 6. Open questions / risks

1. ~~**Rollback / negation.**~~ **Resolved.** Base Argent reactions trigger
   *after* the action resolves and respond to consequences, not the action
   itself. No rollback needed; the engine applies the patch then opens the
   reaction window. Future expansion content with true cancellation can
   add an "interrupt window" type without breaking the existing design.

2. **Continuation serialization vs. ergonomics.** Data continuations
   (effectId + context) are serializable but force every branch to be its
   own registered effect. Closures are easier to write but break save/load
   and replay. Decision: stick with data continuations; provide a builder
   helper that reduces boilerplate.

3. **Multiple simultaneous prompts?** Strictly LIFO stack means only one
   active prompt at a time. Argent doesn't really have parallel decisions
   — even reaction windows are sequential by turn order — so a stack
   suffices. If we ever add a "all players bid simultaneously" mechanic
   (Mancers? Knights?), we'd need a parallel-prompt model.

4. **Cancellable prompts.** Some choices are committed (e.g., placement
   cost paid) before the prompt opens; `{ kind: 'cancel' }` would need a
   compensating effect to refund. Defer until we hit a real case; for now,
   assume no `cancel` answers.

5. **Auto-resolution.** A prompt with one `available: true` option could
   be auto-resolved by the engine without a UI round-trip. Convenient but
   could surprise reactors who wanted a chance to interject. Default: don't
   auto-resolve. Effects can opt in by returning the patch directly when
   they detect a single forced choice.

6. ~~**Reaction limits.**~~ **Resolved (rulebook p.11).** One reaction per
   player per action. Tracked on `ReactionWindow.reactedPlayerIds`.

7. **Replay log fidelity.** With data continuations, replaying =
   re-dispatching the original action sequence (`PLACE_WORKER`,
   `RESOLVE_PENDING`, …). Prompt IDs must be deterministic so the replay
   can match answers to prompts. Solution: IDs derive from
   `state.nextSequenceId`, which is part of the deterministic state.

8. **Undo.** Out of scope for hot-seat play, but worth noting that an
   action log + deterministic engine gets us most of the way there for free.

## Acceptance criteria for the implementation prompt

When this design is implemented, the following should hold:

- [ ] `PendingResolution` and `ResolutionAnswer` are concrete types in
      `src/game/types.ts`, replacing the current `unknown` stub.
- [ ] `GameState.pendingResolutionStack: PendingResolution[]` replaces
      `pendingResolution`.
- [ ] `RESOLVE_PENDING` is a real action handler in the engine, not a stub.
- [ ] At least one effect (Library slot 2 is a good first target) is
      registered end-to-end with prompt → answer → patch.
- [ ] One reaction-window effect (Wound spell) is registered with the full
      reaction queue flow.
- [ ] Engine tests cover: simple choice prompt, nested prompts, reaction
      window with one reactor and one passer, save-and-restore mid-prompt.
