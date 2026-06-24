
Scenarios.  Scenarios change the rules or mechanics of the normal game a bit, and add a flavored round end bonus or mechanic.  these are 5 round games just like the base game. 


Scenarios have a theme, a change to the normal rules, and new round ending rewards or mechanics.

Scenario 1: Dimensional Rift
Rule alteration: After each errands phase (at very end of each round) any room tiles that have no mages in them are flipped over to the other side - Side A flips to Side B and vice versa.
Round 1: Temporal Breakdown
    Round End: Each player takes one more action before the round ends.  The player who took the last bell tower offering will take the last action (so it continues in turn order once around) note you get an action (so no fast action is included here)
Round 2: Time Races
    Ongoing for this round: Taking a Fast Action costs 1 additional Mana during this round.
Round 3: Time Stands Still
    Ongoing for this round: Players may take up to 2 Fast Actions each turn before taking their normal action. (so 2 fast actions instead of the normal 1)
Round 4: Reality Inversion
    Ongoing for this round: Shadowing Mages act before normal mages during this round.  I will clarify this is per slot, so the shadow slot then the normal slot, then we move to the next slot in line and go shadow, then normal.
Round 5: Time Flux
    No bell tower cards are in play this round, yet the round persists until all player voluntarily pass their turn and future turns. players get a pass for this round button.  when the player clicks pass for this round they opt out of future turns.  once everyone has passed the round ends.
Scenario 1 has been implemented.


Scenario 2: Talismans of Magic
Rule Alteration: Synthesis Lab is banned in this scenario.  Always use Student Store in this Scenario.  Players begin the game with the Synthesis Item associated with their school of magic.  (currently multiple players can select the same department of magic, in this case allow each a copy of the synth item).  If there is a Neutral Character, they may choose from the remaining unused items.
Divinity: Sacred Shield
Technomancy: Endless Well of Mana
Mysticism: Staff of Invisibility
Sorcery: Sword of Flame
Natural Magick: Lightning Totem
Planar Studies: Hourglass of Fate.

Round 1: Research Grants - Round end: All players receive 5 Gold.
Round 2: Opening the Vaults - Round end: Each player draws two vault cards and selects one to keep.
Round 3: Research and Merit - Ongoing for this Round: Each time a Vault Card is used during this round, its owner gains 1 IP
Round 4: Student Testing Incentives - Round End: Each player may retrieve one Consumable from their discard and place it into their hand.
Round 5: Research Review Committee - Ongoing for this Round: Each time a Vault Card is used during this round, its owner gains 1 IP.
Scenario 2 has been implemented.


Scenario 3:  The Well of Souls
Rule Alteration:  When casting a spell, a player may send a mage in their office to the infirmary (no infirmary bonus) to reduce the cost of the spell by up to 3.
How this looks:  When casting: Sacrifice a Mage to reduce cost / Cast normally / Cancel - options, also allow casting a spell that is at least 3 mana more than the player currently has giving them the option to sacrifice a mage, or cancel casting.

Round 1: Rumours of Hauntings: Round End: In turn order, each player gains 2 Research.
Round 2: Visions in the Night: Round End: In turn order, each player gains 1 INT or 1 WIS.
Round 3: Whispers in the Shadows: Round End: In turn order, each player gains 1 Research.
Round 4: Power Unleashed: Ongoing for this Round: You may cast any level of the spells in your office this round, even ones you have not researched.
Round 5: All Mysteries Revealed : Ongoing for this Round: All Spell cost is reduced by 1 to a minimum of 0.  Ongoing for this Round: You may cast any level of the spells in your office this round, even ones you have not researched.
Scenario 3 has been implemented.


---

# How scenarios are implemented (read before adding scenarios 4–6)

This section documents the data-driven architecture the three shipped scenarios
use, so new scenarios follow the same pattern instead of inventing new ones.

## The one rule that governs everything

**The engine never switches on a scenario id.** A scenario is *data*: a
`Scenario` object whose persistent rules and per-round rules are expressed as
typed **behavior flags**. The engine reads those flags at a small set of fixed
**hook points**. Adding a scenario whose mechanics already exist is pure data;
adding a genuinely new mechanic is "one new flag + one engine hook that reads
it" — never `if (scenarioId === '…')`.

This mirrors the pack/effect rule ("no engine code switches on a pack id") and
keeps every scenario composable with packs (e.g. a Scenario *and* Summer Break
can both be active and both fire their round-end rewards).

## Where the pieces live

| Concern | File |
| --- | --- |
| Scenario definitions + registry | `src/content/scenarios.ts` |
| `Scenario` / `ScenarioRoundRule` types (every flag is documented here) | `src/game/types.ts` |
| Engine hook points + scenario accessors | `src/game/engine.ts` |
| Round-end reward effect handlers | `src/game/effects/<scenario>.ts` (e.g. `wellofsouls.ts`, `talismans.ts`) |
| Effect side-effect registration | `src/game/effects/index.ts` |
| Setup-time application (rooms, starting items, required packs) | `src/game/setup.ts` |
| UI surfaces (picker / banners) | `SetupScreen.tsx`, `TopBar.tsx`, `PlayerDock.tsx` |

A scenario self-registers at module load: call `registerScenario(myScenario)`
at the bottom of `scenarios.ts`. It is selected via `GameConfig.scenarioId`,
independently of content packs, and is **always a 5-round game**
(`finalRoundFor` returns 5 when `scenarioId` is set).

## The type model

- **Persistent rule** (applies all game) → a flag on `Scenario`. Examples:
  `flipEmptyRoomsEachRound`, `sacrificeMageForSpellDiscount`,
  `requiresPackIds`, `bannedRoomNames`, `guaranteedRoomNames`,
  `startingItemsByDepartment` / `startingItemPool`.
- **Per-round rule** → a flag on the matching `ScenarioRoundRule` in
  `rounds[]`. Every round carries `name` + `description` (shown in the UI even
  when it has no mechanical flag).

Each flag is documented inline in `src/game/types.ts` — add new flags there with
a comment naming the scenario/round that introduced them.

## The two kinds of per-round rule

### 1. Ongoing / inline rules (read mid-action)

These change how an action resolves while the round is active. Implementation =
add a flag, then read it at the relevant engine hook via
`scenarioRoundRule(state)` (current round) or `scenarioRoundRuleFor(state,
round)`. Shipped examples and their hooks (see `src/game/engine.ts`):

- `maxFastActionsPerTurn`, `fastActionManaSurcharge` — fast-action gating/cost.
- `shadowResolvesFirst` — resolution order (shadow vs. base slot).
- `castAnyLevel`, `spellCostReduction` — spell legality / cost in `CAST_SPELL`.
- `vaultUseGrantsIp` — fires on vault-card use.
- `voluntaryPassRound`, `extraActionRoundEnd` — round-flow at round end.
- `flipEmptyRoomsEachRound`, `sacrificeMageForSpellDiscount` — persistent
  (`Scenario`-level), read via `activeScenario(state)`.

When the mechanic already exists, a new scenario reuses the flag for free
(Talismans R3 and R5 both just set `vaultUseGrantsIp`).

### 2. Round-end reward effects (run once per player, in turn order, after scoring)

For a "round end: each player gains X / may do Y" reward:

1. On the round rule, set `roundEndEffectId: '<scenario>.scenario.<name>'` (and
   optionally `roundEndName` for the phase banner).
2. Register the handler in `src/game/effects/<scenario>.ts` with
   `registerEffect(id, ctx => EffectResult)`.

The engine's round-end pump (`roundEndScenariosForRound` →
`drainRoundEndScenarioIfIdle`) runs it once per player in turn order, using the
same channel as a pack's `roundEndScenarios` — so it stacks cleanly with Summer
Break. **Round-end effects never fire on the final round (round 5).** Put
round-5 flavor in an *ongoing* flag instead (as Well of Souls does).

#### Effect handler pattern (pause / resume)

Handlers are pure functions of `EffectContext` returning an `EffectResult`:

- No-prompt reward → return `{ kind: 'done', patch }` (e.g.
  `wellofsouls.scenario.research-2` appends to the research queue).
- Reward with a choice → first call (no `ctx.resumeAnswer`) returns
  `{ kind: 'pause', pending: { responderId, prompt, resume, source } }`; the
  engine collects the answer and re-invokes the same effect with
  `ctx.resumeAnswer`, which applies it (e.g.
  `wellofsouls.scenario.int-or-wis`).
- Clean skip → `{ kind: 'done', patch: {} }`.

Reuse the shared builders in `src/game/effects/helpers.ts`
(`gainResourcePatch`, etc.) rather than mutating state by hand.

## Setup-time hooks

Applied in `src/game/setup.ts` when `config.scenarioId` is set:

- `requiresPackIds` — the SetupScreen auto-enables and **locks** these packs
  (Talismans → Mancers, for its Synthesis Treasures).
- `bannedRoomNames` / `guaranteedRoomNames` — matched by `Room.name` to remove
  or force rooms into the in-play pool.
- `startingItemsByDepartment` (+ `startingItemPool` for a neutral leader, who
  picks interactively) — grants each player a starting Vault card at round-1
  setup.

## UI surfaces (usually no code change needed)

The UI reads the registry generically, so a new scenario shows up automatically:

- `SetupScreen.tsx` — lists `listScenarios()`, shows the description, and
  enforces `requiresPackIds`.
- `TopBar.tsx` — persistent-rule banner.
- `PlayerDock.tsx` — current round's rule text.

## Testing expectations

Every scenario ships a test file (`dimensional-rift.test.ts`,
`talismans.test.ts`, `well-of-souls.test.ts`). For a new scenario:

- A unit test per behavior flag (assert the hook reads it correctly).
- At least one **headless all-bot game to completion** (no stalls / illegal
  moves), plus a **stacked-with-Summer-Break** game if it has round-end effects.
- The `boardInvariant.test.ts` fuzzer (every pack active) must still hold.

## Checklist for adding a scenario

1. Define the `Scenario` object in `scenarios.ts` and `registerScenario(...)`.
2. For each round, write `name` + `description`; add an ongoing flag and/or a
   `roundEndEffectId`.
3. For any *new* mechanic: add the flag to `types.ts` (with a doc comment) and
   read it at one engine hook via `scenarioRoundRule` / `activeScenario`.
4. For round-end rewards: register handlers in
   `src/game/effects/<scenario>.ts` and import that file in
   `src/game/effects/index.ts`.
5. Add setup hooks (`requiresPackIds` / room bans / starting items) if needed.
6. Write tests (per-flag + headless all-bot game) and run the full suite.
7. Update this file: mark the scenario "implemented".