# Board-operation refactor — finalization to-dos

Status as of the `placeMageOnSlot` refactor (commits `83981af`, `dd7fe15`, `ecd3d61`).

The goal of the refactor is a single source of truth for every mage board
operation — **PLACE / MOVE / SHADOW / WOUND / BANISH** — so a mage's `location`
and the slot `occupant` / `shadowOccupant` can never desync, instant-room rewards
fire on **place** (never on **move**), summons count as places, and reactions
hang off the operations' trigger events.

This file tracks what's left to call the refactor *complete*.

---

## The taxonomy (the rule being encoded)

| Op | Meaning | Instant reward? | Trigger event |
|----|---------|-----------------|---------------|
| **PLACE** | mage enters a slot from *off* the board (office, or freshly minted: Living Image, golems) | yes (base; shadow only under Inversion) | none for own mage; shadow-over-opponent → `mage-shadowed` |
| **MOVE** | placed mage relocates slot→slot | **no** | `mage-moved` |
| **SHADOW** | a PLACE into the shadow position | (place rules) | `mage-shadowed` over an opponent |
| **WOUND / BANISH** | remove from board (→ infirmary / office) | n/a | `mage-wounded` / `mage-banished` |

Primitives return `{ patch, event? }`; the **top-level** effect wraps the event
in an `open-reaction` result (a helper cannot open a reaction window — see
`applyEffectResult` in `engine.ts`).

---

## Done (for reference)

- **`placeMageOnSlot(state, { mageId, ownerId, spaceId, asShadow })`** +
  `slotPositionHeldBy` — `src/game/effects/helpers.ts`. Clears the mage's current
  slot, sets `location`/`isShadowing`/clears `isWounded`, fills the destination,
  and **throws on an occupied destination** (callers fizzle first).
- **`findBoardInconsistency` / `assertBoardConsistent`** — `src/game/boardInvariant.ts`,
  with an all-bot test `src/game/boardInvariant.test.ts` (green to 240 seeds).
- Migrated onto the primitive: engine `PLACE_WORKER` base+shadow tails;
  `placeOfficeMageOnSpace` / `placeOfficeMageAsShadow` (→ Ars Magna, Paralocation,
  Mysticism post-cast, Stop/Slow Time, Natural-Magick-B); Living Image; golem
  summon; Artificier's Companion; Hourglass of Fate; Elixir of Life; the Mancers
  shadow-place spell; and the reaction repositions `applyReactionReposition`,
  Haunt (`the-darkness-within.l2.react`), Regrowth (`songs-of-springtime.l2.react`)
  with graceful fizzle on a blocked destination.

---

## Remaining to-dos

### 1. Migrate the batch / multi-mage ops onto the primitive  *(medium)*
These are currently atomic and consistent (the 240-seed invariant is green) but
still hand-roll `location`+occupancy, so they're outside the single source of truth:

- `applyRearrangement` — Tornado / Hurricane (Taming of the Storm L2/L3) — `src/game/effects/base.ts:20987`
- `swapTwoPlacedMagesPatch` — mage position swap (Beyond the Beyonds L2) — `base.ts:13075`
- `applyOwnershipSwap` — Possession (The Darkness Within L3) — `base.ts:18567`
- `flipRoomPatch` + `placeMageDirect` — Flux (Beyond the Beyonds L3 room-flip) — `base.ts:13241` / `base.ts:13213`

`placeMageDirect` in particular is a second place helper that should fold into
`placeMageOnSlot`. Rearrange/swap need a small "batch" wrapper that clears all
involved slots first, then places each (so an intermediate state never double-books
a slot). Add these cards to `boardInvariant.test.ts` coverage as they're migrated.

### 2. De-triplicate the instant-room trigger  *(small)*
The predicate `room.isInstantRoom && hasEffect(space.effectId)` is repeated:
- `engine.ts:1232` (shadow tail), `engine.ts:1485` (base tail)
- `base.ts:7939` (`patchWithMaybeInstantReward`)

Extract one `firesInstantReward(room, space)` predicate. It needs `hasEffect`
(from `effects/index`), so it can't live in `helpers.ts` without a cycle — put it
in `effects/index.ts` (or a tiny shared module) and import from both the engine and
`base.ts`. The prompt construction is already shared via
`buildResolutionChoicePromptInput`; only the predicate is duplicated.

### 3. Centralize the placement hooks (and resolve the shadow-Technomancy gap)  *(small, needs a rules call)*
`adventuringBPlacementHookPatch` and `technomancyOnPlacePatch` both live in
`helpers.ts:3057`, so `placeMageOnSlot` *could* apply them itself instead of every
wrapper re-adding them. **Blocker / decision:** `placeOfficeMageAsShadow` currently
does **not** fire Technomancy on a shadow placement, while base placements do.
Decide the intended rule (does placing an orange/Apprentice mage as a *shadow*
trigger Technomancy "upon placement"?) before folding the hooks in, so the move
doesn't silently change behavior. `suppressMagePowers` (Stop/Slow Time, Great Hall)
must remain honored.

### 4. Don't offer a reposition reaction with no legal destination  *(small, polish)*
When a reposition's only destination is occupied, the reaction now **fizzles** (no
board change, card not consumed). That's safe, but `buildReactionOptionsFor`
(`helpers.ts`) still *offers* it, so a bot/human can "waste" the choice. Pre-filter
Phase Steppers / Invisibility Cloak / Mystic Amulet / Shield Potion / Ancient Armor /
Sacred Shield / Haunt / Regrowth options when no valid landing exists. Confirm the
"card not consumed on fizzle" choice is the intended economy.

### 5. Verify the Resolution-phase return-to-office paths  *(low — invariant currently green)*
Earlier tracing showed a transient "location=office but slot still lists the mage"
class from Resolution-phase slot effects. The invariant is green across 240 seeds
now, but the paths weren't explicitly routed through a primitive — audit
`completeCurrentSpaceResolution` and round-setup clearing in `engine.ts`, and any
slot effect that sets `location: office`, to confirm both sides always change
together. Consider a `removeMageFromSlot` / reuse of `banishMage` for these.

### 6. Optional: engine-level invariant assertion behind a dev flag  *(optional)*
Per the agreed decision the invariant is test-only. If desired later, call
`assertBoardConsistent` inside `applyAction` gated on a dev/test env flag to catch
desyncs during real play (it will surface anything the seeded games miss).

### 7. Document the taxonomy in code  *(small)*
Add a short header comment block (e.g. atop `boardInvariant.ts` or a new
`docs/effect-resolution.md` section) describing PLACE vs MOVE vs SHADOW vs
WOUND/BANISH and the `{ patch, event }` contract, so future effects use the
primitives instead of hand-rolling.

---

## Cards / effects touching board ops

**Already on the primitive**

- Reaction repositions: **Shield Potion, Ancient Armor, Mystic Amulet, Sacred
  Shield, Phase Steppers, Invisibility Cloak** (`applyReactionReposition`).
- **Haunt** (The Darkness Within L2), **Regrowth** (Songs of Springtime L2).
- Placements/summons: **Living Image** (Trias Blackwind), **Golem Lab** golems,
  **Artificier's Companion**, **Hourglass of Fate**, **Elixir of Life**,
  **Paralocation** (L1 place, L3 shadow), **Mysticism** post-cast placement,
  **Tardy / Stop Time / Slow Time**, **Ars Magna**, **Natural Magick B** displace.

**Correct via existing primitives, untouched**

- Moves: **Gust of Wind, Strength of Earth, Nature Mage's Cap** → `moveMageToSpace`
  (emits `mage-moved`, no instant reward — correct).
- Batch wounds/banishes: **Tsunami, Plague, Fireball, Nox, Ice Comet** →
  `woundMage` / `banishMage` + `buildBatchReactorQueue`.

**Remaining (to-do #1)**

- **Tornado / Hurricane** (Taming of the Storm L2/L3) — room rearrange.
- **Possession** (The Darkness Within L3) — ownership swap.
- **Beyond the Beyonds** L2 (mage swap) and L3 **Flux** (room flip + rearrange).

**No board op** (for reference): Archmage's Apprentice claim (→ office only).

---

## Verification checklist (run before declaring complete)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — full suite green (currently **943**).
- `npx vitest run src/game/boardInvariant.test.ts` — green; temporarily widen
  `seed <= 30` to `<= 240` for a deeper sweep when touching board code.
- 240-game 4-player one-of-each sim (temp): **0 throws**, all games complete.
- Manual: place into an instant room (bonus fires), **move** within an instant room
  (no bonus), summon a golem onto an instant-room slot (bonus fires — it's a place),
  shadow-reposition onto an occupied shadow (fizzles, no orphan), rearrange a room
  with Tornado (no desync).
