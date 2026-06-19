# Board-operation refactor — finalization to-dos

**Status: COMPLETE.** All to-dos (#1–#7) are done; `tsc` clean and the full
suite (947) is green, including with the engine-level invariant assertion
enabled (`ARGENT_ASSERT_BOARD=1`). Started from the initial `placeMageOnSlot`
refactor (commits `83981af`, `dd7fe15`, `ecd3d61`).

The goal of the refactor is a single source of truth for every mage board
operation — **PLACE / MOVE / SHADOW / WOUND / BANISH** — so a mage's `location`
and the slot `occupant` / `shadowOccupant` can never desync, instant-room rewards
fire on **place** (never on **move**), summons count as places, and reactions
hang off the operations' trigger events.

The canonical in-code reference for the taxonomy and primitives is the header
comment atop `src/game/boardInvariant.ts`.

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
- **To-do #2 (instant-reward predicate)** — `firesInstantReward(room, space)`
  extracted into `src/game/effects/registry.ts` (next to `hasEffect`, re-exported
  from `effects/index.ts`); the three call sites (engine shadow tail, engine base
  tail, `patchWithMaybeInstantReward`) now call it.
- **To-do #4 (no-landing reposition reactions)** — `buildReactionOptionsFor`
  pre-filters reposition reactions with no legal landing: re-shadow reactions
  (Phase Steppers, Invisibility Cloak, Haunt) are hidden when the original slot's
  shadow is taken or the room has no shadow positions; open-base-slot reactions
  (Shield Potion, Ancient Armor, Mystic Amulet, Sacred Shield, Diviner's Mitre)
  when no open base landing exists; Regrowth / Renewal when
  `listPlaceWithoutPowersSlots` is empty (avoids paying+exhausting for nothing).
  `listPlaceWithoutPowersSlots` moved `base.ts → helpers.ts` to avoid a cycle.
  Card-not-consumed-on-fizzle kept as the safety net. Regression test in
  `engine.test.ts` ("re-shadow reactions are NOT offered …").

---

## Remaining to-dos

### 1. Migrate the batch / multi-mage ops onto the primitive  *(medium)*  — ✅ DONE
Added `placeMagesOnSlots(state, ops[])` to `helpers.ts` — the batch sibling of
`placeMageOnSlot` that **clears every involved origin AND destination first, then
seats each**, so a swap/rearrange never passes through a double-booked state
(per-mage `placeMageOnSlot` can't, since it throws on an occupied dest). Throws on
duplicate target positions / unknown spaces; syncs each Mage's
`location` / `isShadowing` / clears `isWounded`. Migrated:

- `swapTwoPlacedMagesPatch` (Beyond the Beyonds L2 "Shift") → two-op batch; still
  emits the two `mage-moved` events.
- `applyRearrangement` (Tornado / Hurricane) → delegates to `placeMagesOnSlots`;
  `roomId` param dropped (no longer needed). Equivalent because the queue is seeded
  from `baseMagesInRoom`, so every base occupant is reassigned.
- **Flux** (Beyond the Beyonds L3) → the flip parks Mages in office and offers
  empty slots, so each placement is a plain `placeMageOnSlot` (no batch needed).
  `placeMageDirect` folded into `placeMageOnSlot` and **deleted**.

**Exception:** `applyOwnershipSwap` (Possession, The Darkness Within L3) only swaps
`ownerId`s — no Mage changes slot — so it stays out of the batch primitive; a
doc-comment now explains why.

Invariant coverage: the base-only `boardInvariant.test.ts` sweep exercises
Tornado / Hurricane / Possession; the mancers-only ops (Shift, Flux) it can't
reach now assert `findBoardInconsistency(s)` is null in their `engine.test.ts`
functional tests (plus the Tornado/Hurricane rearrange tests). Re-verified with a
temporary 240-seed sweep (0 throws).

### 2. De-triplicate the instant-room trigger  *(small)*  — ✅ DONE
`firesInstantReward(room, space)` lives in `effects/registry.ts` (alongside
`hasEffect`, which it needs; `registry` imports only types so there's no cycle),
re-exported from `effects/index.ts`. The three sites — `engine.ts` shadow tail,
`engine.ts` base tail, `patchWithMaybeInstantReward` in `base.ts` — call it.

### 3. Centralize the placement hooks  *(small)*  — ✅ DONE
**Decision (2026-06-18, corrected):** a shadow placement **DOES** fire
Technomancy. The shadow-slot rule is narrow: a mage in a shadow slot loses ONLY
its defensive colour immunities — **green's wound-immunity and blue's
spell-immunity** — and keeps everything else (Technomancy on-place, red's Ars
Magna, …). (This supersedes the earlier "base only" call.)

What shipped:
- **Technomancy** folded into `placeMageOnSlot` via an opt-in `firesTechnomancy`
  flag (+ `suppressMagePowers`). It is opt-in because the primitive also backs
  MOVE / reposition / re-shadow, which are not placements. Every genuine PLACE —
  base AND shadow — now sets the flag, so the trigger fires uniformly; previously
  it fired on base placements but was silently dropped on shadow ones
  (`placeOfficeMageAsShadow`, the PLACE_WORKER shadow tail, the Mancers
  shadow-place spell, Artificier's shadow branch). The explicit
  `technomancyOnPlacePatch` spreads were removed from those wrappers (the engine
  keeps its two explicit calls — its tails build full `GameState`s and order the
  Adventuring-B prompt by hand).
- **Adventuring-B** hook deliberately NOT folded in: the engine pushes the
  instant-room prompt then the Adventuring-B prompt on top (LIFO order matters),
  so it can't move into the placement primitive without changing prompt order. It
  stays in the wrappers / engine as-is.
- **Shadow immunity rule** enforced at one point: `colorAbilityActive` now returns
  false for green/blue when `isShadowing` (their only A-side power is the
  immunity, so this is exactly the rule). This also fixed real deviations in
  `buildPossessionTargets` and `buildArsMagnaTargets`, which protected a shadowing
  green/blue mage while already allowing shadowing red mages to be targeted.
- `suppressMagePowers` (Stop/Slow Time, Great Hall) still skips Technomancy.
- Tests: shadow placement fires Technomancy (and a non-orange contrast); the
  shadow-immunity drop with a red-keeps-its-power contrast.

### 4. Don't offer a reposition reaction with no legal destination  *(small, polish)*  — ✅ DONE
`buildReactionOptionsFor` (`helpers.ts`) now pre-filters by landing shape:
- **Re-shadow original slot** (Phase Steppers, Invisibility Cloak, Haunt) — hidden
  via `canReShadowOriginal` when the room has no shadow positions OR the original
  slot's shadow is held by another Mage.
- **Open base slot** (Shield Potion, Ancient Armor, Mystic Amulet, Sacred Shield,
  Diviner's Mitre) — hidden via `hasOpenBaseLanding` (some placeable room has an
  empty base slot, or the original base slot is free).
- **Place-without-powers** (Regrowth, Renewal) — hidden when
  `listPlaceWithoutPowersSlots` is empty; these pay+exhaust *before* checking, so
  filtering prevents a wasted cast.

`listPlaceWithoutPowersSlots` moved `base.ts → helpers.ts` (its only dep,
`isRoomAtPlayerCap`, already lives there) so the gate has no `helpers → base`
cycle; `base.ts` and `mancers.ts` import it from `helpers`. **Decision
(2026-06-18):** "card not consumed on fizzle" kept — the pre-filter is the fix;
the fizzle stays a safety net.

### 5. Route the Resolution-phase return-to-office paths through a primitive  *(low)*  — ✅ DONE
Added `removeMageFromSlot(state, mageId)` to `helpers.ts` — the inverse of
`placeMageOnSlot`: lifts a placed mage off its slot back to its owner's office,
clearing BOTH the slot occupancy and the mage's `location` / `isShadowing` in one
step (no event — use `banishMage` when a `mage-banished` trigger is needed; no-op
off-slot). `completeCurrentSpaceResolution` (`engine.ts`) — the
"errand done → office" return — now routes through it instead of hand-rolling
both sides.

Audit of every other `location: 'office'` site (so the to-do is closed, not just
the one path):
- `banishMage` — already a primitive (clears slot + sets office + emits event).
- `healInfirmaryMages`, `returnMageToOfficePatch` — infirmary → office; the mage is
  on no slot, so there's nothing to clear (beds derive from `location`).
- `flipRoomPatch` (Flux) — parks mages by replacing the room with a fresh empty
  copy, so slot refs clear wholesale; mages are then re-seated via
  `placeMageOnSlot` (see #1).
- `clearArchmagesApprentice` — removes the mage from the roster entirely AND scrubs
  its slot refs in the same pass (consistent; it's a deletion, not a return).
- All remaining sites mint a NEW mage directly into the office (draft, summon,
  Living Image, Archmage's Apprentice claim, Garek/Cin swaps) — no slot involved.

Test: `removeMageFromSlot` clears base + shadow occupancy and updates `location`
(invariant intact), and is a no-op for an off-slot mage.

### 6. Engine-level invariant assertion behind a dev flag  *(optional)*  — ✅ DONE
`applyAction` calls `assertBoardConsistent` after every action when
`ARGENT_ASSERT_BOARD=1` (off by default; a `typeof process` guard makes it a
no-op in the browser bundle). It asserts only a **newly-introduced** desync — it
captures whether the input board was already consistent and skips the check
otherwise — mirroring `boardInvariant.test.ts` so it ignores the deliberately
stale fixtures a few unit tests feed in to verify defensive skips. Validation:
the full suite is green with the flag ON (947), i.e. no action introduces a
desync anywhere in the suite. Intended for catching desyncs in real / interactive
play the seeded sims don't cover.

### 7. Document the taxonomy in code  *(small)*  — ✅ DONE
A header comment block atop `boardInvariant.ts` describes the
PLACE / MOVE / SHADOW / WOUND-BANISH taxonomy, which primitive implements each
(`placeMageOnSlot`, `placeMagesOnSlots`, `moveMageToSpace`, `removeMageFromSlot`,
`woundMage` / `banishMage`, `firesInstantReward`), the corrected shadow rules
(colour powers kept in shadow except green wound- / blue spell-immunity), and the
`{ patch, event }` contract (helpers return a patch + implied event; only the
top-level effect wraps it in `open-reaction`).

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
- Batch (via `placeMagesOnSlots`): **Tornado / Hurricane** (Taming of the Storm
  L2/L3) room rearrange, **Beyond the Beyonds L2 "Shift"** mage swap. **Flux**
  (Beyond the Beyonds L3) re-places each Mage via `placeMageOnSlot` after the flip.

**Correct via existing primitives, untouched**

- Moves: **Gust of Wind, Strength of Earth, Nature Mage's Cap** → `moveMageToSpace`
  (emits `mage-moved`, no instant reward — correct).
- Batch wounds/banishes: **Tsunami, Plague, Fireball, Nox, Ice Comet** →
  `woundMage` / `banishMage` + `buildBatchReactorQueue`.

**Not a place (intentionally outside the primitives)**

- **Possession** (The Darkness Within L3) — `applyOwnershipSwap` swaps owners only;
  no Mage moves slot.

**No board op** (for reference): Archmage's Apprentice claim (→ office only).

---

## Verification checklist (run before declaring complete)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — full suite green (currently **947**).
- `ARGENT_ASSERT_BOARD=1 npx vitest run` — also green: the engine-level
  invariant assertion fires after every action and no action introduces a desync
  anywhere in the suite.
- `npx vitest run src/game/boardInvariant.test.ts` — green; temporarily widen
  `seed <= 30` to `<= 240` for a deeper sweep when touching board code.
- 240-game 4-player one-of-each sim (temp): **0 throws**, all games complete.
- Manual: place into an instant room (bonus fires), **move** within an instant room
  (no bonus), summon a golem onto an instant-room slot (bonus fires — it's a place),
  shadow-reposition onto an occupied shadow (fizzles, no orphan), rearrange a room
  with Tornado (no desync).
