# Argent: The Consortium — Visual & UI Design System

**"Starfall Academy" Art Direction** · presentation-layer design doc

> Status: the game engine is complete and prompt-driven (`applyAction` +
> `pendingResolutionStack`); the React presentation layer is greenfield
> (`Board/`, `HUD/`, `Player/`, `Cards/`, `Modals/`, `Council/` are stubs).
> This document is the blueprint for building it.

---

## 1. Concept: A Living Magical Campus at Dusk

The game is five days (rounds) of the **election season at a magical
university**, played out across a floating campus. The board is not a grid of
gray boxes — it is an aerial view of academy buildings drifting in a twilight
sky, connected by glowing ley-lines. Placing a Mage doesn't "occupy a slot";
the student *walks into the building* and a spell circle ignites under their
feet.

Art-direction anchors (modern anime, colorful, whimsical, premium):

- **Little Witch Academia** — saturated whimsy, expressive chibi energy
- **Persona 5** — UI with *personality*: angled panels, cut-in reactions,
  confident typography, every menu is a set-piece
- **Fire Emblem: Three Houses / Genshin menus** — academy fantasy, readable
  card systems, soft-glow materials
- **Atelier series** — alchemical warmth, parchment + gem-light

The emotional target: **wonder + rivalry**. Everything ambient is soft and
magical; everything interactive is crisp, saturated, and a little theatrical.

### The five-day semester (rounds as day/night cycle)

The Bell Tower already drives round length in the engine (`bellTower.available`
depleting → Resolution phase). Map it to the sky:

- Round start: dawn gradient behind the campus.
- Each bell card claimed: the sun arcs lower; ambient hue shifts warm → dusk.
- Last bell claimed: nightfall — lanterns ignite in every room, fireflies out,
  Resolution phase plays out "at night" as Mages do their errands.
- Round 5's night transitions into the **Election ceremony** (final scoring).

This gives players an *ambient read of game tempo with zero UI chrome*.

---

## 2. What Exists (and what the engine gives us for free)

| Engine concept | UI consequence |
| --- | --- |
| `GameState` is one immutable object in a zustand store | Whole UI is a pure render of state; animations keyed by state diffs |
| Every interaction is a typed prompt on `pendingResolutionStack` (`choose-target-mage`, `choose-target-action-space`, `choose-from-options`, `reaction-window`, `choose-voter`, …) | One **PromptDirector** component routes the top prompt to a visual interaction mode. No per-feature modal spaghetti. |
| `roomLayout.grid` (2 cols × N rows), rooms with A/B sides, locks, destruction (Devastation), flips (Flux) | The campus is data-driven; rooms need lock/destroy/flip visual states |
| Shadow slots (`shadowOccupant`) | "Astral projection" visual — a translucent spectral copy of the student |
| Reaction windows interrupt resolution | Persona-style **cut-in panels** — the defining UI signature |
| Departments: sorcery, divinity, natural-magick, mysticism, planar-studies, technomancy | Six school color identities used across spells, rooms, and FX |
| Mage colors (red/grey/green/purple/blue/orange/off-white/rainbow) with powers | Eight student archetypes with distinct silhouettes |
| Hot-seat local play | Turn hand-off banners; "peek" interactions need a privacy flow |

---

## 3. Color Palette

### 3.1 World (ambient) palette — "Twilight Campus"

| Token | Hex | Use |
| --- | --- | --- |
| `night-900` | `#171430` | App background, deepest sky |
| `night-800` | `#1f1b3f` | Board backdrop, modal scrim base |
| `night-700` | `#2a2554` | Panel backgrounds |
| `night-600` | `#383170` | Elevated panels, hover surfaces |
| `parchment-50` | `#fdf8ec` | Card faces, primary light surface |
| `parchment-200` | `#f3e8cd` | Card secondary, table texture |
| `parchment-400` | `#e0cda0` | Borders on light surfaces |
| `ink-900` | `#2b2438` | Text on parchment |
| `starlight` | `#ffe9a8` | Lantern/firefly glow, focus rings |
| `leyline` | `#7ee8fa` | Connective magic lines, available-state glow |

### 3.2 Department (school) accents

| Department | Core | Glow | Vibe |
| --- | --- | --- | --- |
| Sorcery | `#ff5d5d` | `#ffb3a1` | Ember, crackling fire |
| Divinity | `#ffd166` | `#fff3c4` | Gold radiance, halos |
| Natural Magick | `#5fd068` | `#c9f4b4` | Leaf-green, petals |
| Mysticism | `#b16cea` | `#e3c2ff` | Violet smoke, runes |
| Planar Studies | `#5aa9e6` | `#bfe4ff` | Star-blue, portals |
| Technomancy | `#ff9f43` | `#ffd9a8` | Brass + amber circuitry |

### 3.3 Player identity colors

Keep the existing `vis.*` five (red/blue/green/yellow/purple), but brighten to
anime saturation and pair each with a soft variant for auras:

`player-red #ff6b6b · player-blue #4d96ff · player-green #6bcb77 ·
player-gold #ffd93d · player-violet #b388eb`

**Rule:** player color appears on *ownership* (mage aura ring, dashboard
trim, marks on voters); department color appears on *content* (spells, rooms,
FX). Never use one for the other — this keeps "whose is it" and "what school
is it" independently scannable.

### 3.4 State colors

- Available: `leyline` cyan glow + slow pulse
- Selected/targeting: `starlight` gold ring + scale-up
- Hostile-targetable (wound/banish prompts): `#ff5d7d` rose glow
- Locked: desaturate room + chain overlay tinted `night-600`
- Wounded: hue shift toward grey-violet + bandage badge
- Disabled/exhausted: 45% desaturation + 70% opacity, *never* pure greyscale
  (keeps the world feeling alive)

---

## 4. Typography

| Role | Font (Google Fonts) | Fallback | Use |
| --- | --- | --- | --- |
| Display | **Grandstander** (or Baloo 2) | `cursive` | Room names, screen titles, cut-in text — rounded, bouncy, anime-logo energy |
| Body/UI | **Nunito Sans** | `system-ui` | Card text, buttons, tooltips — soft geometric, very legible small |
| Numerals/arcane | **Cinzel Decorative** (sparingly) | `serif` | Spell levels (Ⅰ Ⅱ Ⅲ), round numerals, scoring ceremony |

Scale (desktop-first): display 28/36/48, body 13/14/16, micro-labels 11
uppercase tracked (`tracking-widest`). Card rule text never below 13px.

---

## 5. Tailwind Design System

```js
// tailwind.config.js (extend)
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: { 600:'#383170', 700:'#2a2554', 800:'#1f1b3f', 900:'#171430' },
        parchment: { 50:'#fdf8ec', 200:'#f3e8cd', 400:'#e0cda0' },
        ink: { 900:'#2b2438' },
        starlight: '#ffe9a8',
        leyline: '#7ee8fa',
        dept: {
          sorcery:'#ff5d5d', divinity:'#ffd166', natural:'#5fd068',
          mysticism:'#b16cea', planar:'#5aa9e6', techno:'#ff9f43',
        },
        player: {
          red:'#ff6b6b', blue:'#4d96ff', green:'#6bcb77',
          gold:'#ffd93d', violet:'#b388eb',
        },
      },
      fontFamily: {
        display: ['Grandstander', 'cursive'],
        body: ['"Nunito Sans"', 'system-ui', 'sans-serif'],
        arcane: ['"Cinzel Decorative"', 'serif'],
      },
      borderRadius: { card: '14px', slot: '9999px' },
      boxShadow: {
        glow-sm: '0 0 8px 2px var(--glow, #7ee8fa66)',
        glow: '0 0 16px 4px var(--glow, #7ee8fa88)',
        card: '0 6px 16px -6px #00000066',
        'card-lift': '0 16px 32px -8px #00000088',
      },
      keyframes: {
        breathe: { '0%,100%': { opacity: .55 }, '50%': { opacity: 1 } },
        floaty:  { '0%,100%': { transform: 'translateY(0)' },
                   '50%': { transform: 'translateY(-6px)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        shimmer: { from: { backgroundPosition: '200% 0' },
                   to: { backgroundPosition: '-200% 0' } },
      },
      animation: {
        breathe: 'breathe 2.4s ease-in-out infinite',
        floaty: 'floaty 5s ease-in-out infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
    },
  },
};
```

Set `--glow` inline per department/state so one shadow utility serves all six
schools: `style={{ '--glow': deptGlow[dept] }}`.

Reusable class recipes (extract as `cva`/`clsx` helpers, not @apply soup):

- **Panel**: `bg-night-700/90 backdrop-blur rounded-card ring-1 ring-white/10`
- **Card face**: `bg-parchment-50 text-ink-900 rounded-card shadow-card`
- **Slot (spell circle)**: `rounded-slot border-2 border-dashed
  border-white/25 data-[available=true]:border-leyline
  data-[available=true]:shadow-glow data-[available=true]:animate-breathe`
- **Primary button**: `font-display bg-gradient-to-b from-starlight
  to-amber-300 text-ink-900 rounded-full px-5 py-2 shadow-card
  hover:shadow-card-lift hover:-translate-y-0.5 active:translate-y-0
  transition`

---

## 6. The Students (Worker/Meeple Design)

Eight archetypes, one per engine mage color. Chibi proportions (~1:2.5 head
ratio), each with a **unique silhouette readable at 28px**:

| Mage color | Archetype | Silhouette key | Specialty fantasy |
| --- | --- | --- | --- |
| Red | Battle-mage girl, twin tails up like flames | Spiky twin-tails | Evocation — wounds others when placed |
| Grey | Hooded prefect, lantern at hip | Asymmetric hood | Errand-runner (acts at Errands too) |
| Green | Druid boy w/ leaf-cowlick + satchel | Big round satchel | Wardcraft — can't be wounded |
| Purple | Sleepy diviner, wide hat over eyes | Enormous brim | Foresight — peeks hidden info |
| Blue | Star-scholar w/ floating grimoire | Book orbits her | Abjuration — spell-immune |
| Orange | Tinkerer w/ goggles + backpack arm | Mechanical backpack | Artifice — gold/vault tricks |
| Off-white | First-year in plain robe | Plain teardrop robe | Undeclared (no power) |
| Rainbow | Prism-haired prodigy | Gradient hair swirl | Wild — counts as any color |

Rendering tiers (build in this order):

1. **Tier 0 (ship first):** flat SVG chibi *tokens* — head + robe silhouette,
   department-tinted robe, player-color **aura ring**. One SVG per archetype,
   recolored via CSS `currentColor`/CSS vars. Readable, cheap, animatable.
2. **Tier 1:** expressive portrait busts (PNG/WebP, AI-assisted or
   commissioned) shown in the dashboard, tooltips, and cut-ins.
3. **Tier 2:** idle micro-animation on tokens (2-frame bob via `animate-floaty`,
   blink via CSS steps).

**Status dressing on the token, never replacing it:** wounded = bandage +
desaturate; shadowing = 55% opacity + cyan rim-light + slow wisp particles;
temporary golem = brass rim + gear badge; rainbow = animated hue-rotate ring.

When selected, the student's portrait slides into the Action Tray with an
expression (determined/smug/worried) matching the prompt type — wound prompts
get the smug face, being targeted gets the worried face. Cheap, huge charm.

---

## 7. The Campus (Board & Rooms)

### 7.1 Layout wireframe (desktop-first, 1440+)

```
┌────────────────────────────────────────────────────────────────────┐
│ HUD BAR  round/day-dial · phase banner · bell-tower meter · menu   │ 64px
├──────────┬─────────────────────────────────────────────┬──────────┤
│ OPPONENT │                                             │ COUNCIL  │
│ RAIL     │              CAMPUS BOARD                   │ TOWER    │
│ (compact │   ┌─────────┐  ley  ┌─────────┐             │ voters,  │
│ player   │   │ Room A1 │═══════│ Room A2 │             │ marks,   │
│ panels,  │   └─────────┘ lines └─────────┘             │ bell     │
│ vertical)│   ┌─────────┐       ┌─────────┐             │ cards    │
│          │   │ Room B1 │═══════│ Room B2 │   floating  │          │
│          │   └─────────┘       └─────────┘   islands   │          │
│          │      … grid rows from roomLayout.grid …     │          │
├──────────┴─────────────────────────────────────────────┴──────────┤
│ PLAYER DOCK  portrait · resources · mage bench · hand fans · acts │ 180px
└────────────────────────────────────────────────────────────────────┘
```

- Campus board pans/zooms slightly (CSS transform, `framer-motion` drag
  constraints) — it should feel *bigger than the viewport*, like a diorama.
- `roomLayout.grid` drives island positions; add ±8px random-but-seeded jitter
  and per-room `animate-floaty` with staggered delays so the campus drifts.
- **Ley-lines** (SVG paths between adjacent grid cells) pulse softly; they
  matter for adjacency rules (e.g. Devastation wall treatment), so they're
  informative, not just decorative.

### 7.2 Room identity

Each room is a **RoomScene**: an illustrated mini-building on a floating
island chunk, with its action slots arranged as physical spots *in front of
it*. Visual identities:

| Room | Scene | Ambient loop |
| --- | --- | --- |
| Vault | Brass bank-vault door, coin glints | Door seam glow |
| Library | Tower of books, floating tomes | A book flips a page |
| Infirmary | Greenhouse-clinic, soft pink light | Petals drift |
| Council Chamber | Marble rotunda, banners | Banner sway |
| Training Fields | Floating duel rings | Spark crackle |
| Catacombs | Cracked stair into violet dark | Mist seep |
| Guilds | Cluster of guild flags & stalls | Flag flutter |
| Courtyard | Fountain + cherry tree | Falling leaves |
| (Mancers rooms) | Brass-and-gear annexes | Gear ticks |

Department tint on the island's rim-light tells you the room's school
affiliation at a glance.

### 7.3 Action slots as spell circles

- Empty slot: faint dashed rune-circle on the ground (`rounded-slot` recipe).
- Available (during placement): circle ignites — cyan `shadow-glow` +
  `animate-breathe`, runes fade in around the rim (`animate-spin-slow` on a
  rune-ring SVG).
- Hover: circle brightens, ghost-preview of the selected student standing in
  it at 50% opacity ("try before you commit").
- **Placement lands:** student drops in with a spring (framer-motion
  `type:'spring', stiffness 400, damping 22`), circle flashes department
  color, 6–10 particle motes pop, faint ripple expands. ~450ms total.
- Occupied: circle solidifies in the *owner's player color*; merit slots get
  a gold laurel rim; shadow position renders the spectral copy *behind* the
  base occupant, slightly elevated.
- Slot cost badges (mana/merit/gold) float above the circle as tiny chips.

### 7.4 Room states (the engine demands these!)

- **Locked** (Rift, Devastation L1): translucent chains wrap the island,
  room desaturates, padlock badge with "until ⏳" tooltip showing unlock
  timing (`untilTurnStartOf` vs Resolution).
- **Flipped** (Flux): the entire island does a 3D `rotateY` flip
  (600ms, `transform-style: preserve-3d`) revealing the B-side scene —
  this is a marquee animation, let it be loud: camera nudge + chime.
- **Destroyed** (Devastation L3): island cracks (fragment masks), pieces
  fall away with gravity easing + dust puff; grid gap remains as drifting
  rubble. Permanent, dramatic, worth a 1.2s set-piece.
- **Bell Tower meter** in HUD: a vertical tower; each claimed bell card
  visibly removes a glowing bell; sky gradient binds to remaining count.

---

## 8. Component Architecture (React)

```
src/components/
├─ App.tsx → screens/{SetupScreen, GameScreen, ScoringScreen}
│
├─ GameScreen.tsx              // layout shell + FX/Modal portals
│  ├─ HUD/
│  │  ├─ TopBar.tsx            // day-dial, phase banner, menu
│  │  ├─ BellTowerMeter.tsx    // sky-clock + bell cards popover
│  │  └─ TurnBanner.tsx        // hot-seat hand-off splash
│  ├─ Board/
│  │  ├─ CampusBoard.tsx       // pan/zoom stage, ley-line SVG layer
│  │  ├─ RoomScene.tsx         // island + building + state overlays
│  │  ├─ ActionSlot.tsx        // spell-circle (all 7 visual states)
│  │  ├─ MageToken.tsx         // archetype SVG + aura + status dressing
│  │  └─ roomArt.ts            // roomId → scene art/tint registry
│  ├─ Council/
│  │  ├─ CouncilTower.tsx      // right rail: voters, marks
│  │  └─ VoterTile.tsx         // face-down/revealed/marked states
│  ├─ Player/
│  │  ├─ PlayerDock.tsx        // bottom: active player command center
│  │  ├─ OpponentRail.tsx      // left: compact rival panels
│  │  ├─ MageBench.tsx         // office mages (drag/select source)
│  │  ├─ ResourceChips.tsx     // gold/mana/IP/marks/badges/INT/WIS
│  │  └─ HandFans.tsx          // spells · vault · supporters fans
│  ├─ Cards/
│  │  ├─ SpellBook.tsx         // tome w/ L1/L2/L3 page-tabs
│  │  ├─ VaultCard.tsx, SupporterCard.tsx, BellCard.tsx
│  │  └─ CardZoom.tsx          // shared long-press/right-click zoom
│  ├─ Prompts/                 // ⭐ heart of the UI
│  │  ├─ PromptDirector.tsx    // routes top of pendingResolutionStack
│  │  ├─ TargetingLayer.tsx    // board overlay: eligible mages/slots/rooms
│  │  ├─ ChoiceSheet.tsx       // choose-from-options bottom sheet
│  │  ├─ ReactionCutIn.tsx     // reaction-window interrupt panel
│  │  ├─ VoterPick.tsx         // choose-voter w/ council zoom
│  │  └─ PromptBreadcrumb.tsx  // “Devastation ▸ choose room” context line
│  ├─ FX/
│  │  ├─ FxLayer.tsx           // portal; queue of one-shot effects
│  │  ├─ effects.ts            // wound, banish, flip, destroy, sparkle…
│  │  └─ useStateDiffFx.ts     // diff GameState transitions → enqueue FX
│  └─ Modals/
│     ├─ DraftModal.tsx, PeekModal.tsx (privacy flow), LogDrawer.tsx
│     └─ ScoringCeremony.tsx   // staged election reveal
└─ store/
   ├─ gameStore.ts             // existing (state + dispatch)
   └─ uiStore.ts               // NEW: selection, hovered, camera, fxQueue,
                               //      handedOffTo (hot-seat privacy)
```

### Key patterns

**PromptDirector (the one pattern that makes this UI tractable).** The engine
already funnels *every* decision into a typed prompt. So:

```tsx
function PromptDirector() {
  const prompt = useGameStore(s => topPending(s.state)?.prompt);
  switch (prompt?.kind) {
    case 'choose-target-mage':        return <TargetingLayer mode="mage" />;
    case 'choose-target-action-space':return <TargetingLayer mode="slot" />;
    case 'choose-from-options':       return <ChoiceSheet />;     // rooms, colors, rewards…
    case 'reaction-window':           return <ReactionCutIn />;
    case 'choose-voter':              return <VoterPick />;
    default:                          return null;
  }
}
```

TargetingLayer doesn't draw its own board — it dims the campus
(`bg-night-900/55`) and *lifts eligible targets above the scrim* (z-index +
glow), so eligibility is literally illuminated. Ineligible mages duck their
heads (tiny `scaleY` squash) — the world reacts.

**FX from state diffs, not imperative calls.** `useStateDiffFx` compares
previous/next `GameState` after each dispatch: a mage that was on a slot and
is now in the infirmary ⇒ enqueue `woundFx(at: slotPosition)`. Rooms array
lost an id ⇒ `destroyFx`. Room id changed `.a→.b` ⇒ `flipFx`. This keeps the
engine pure and the UI honest — effects can never desync from truth.

**Shared layout animation:** give every mage token
`layoutId={mage.id}` (framer-motion) and tokens *automatically glide* between
office bench → slot → infirmary → office across renders. This single trick
delivers 80% of the "premium" feel.

---

## 9. Signature Interactions

### 9.1 Reaction cut-in (the UI's identity move)

When a `reaction-window` prompt surfaces (someone's mage was wounded/moved/
banished), time freezes — literally: the board gets a brief
`saturate(0.6) contrast(1.1)` filter and a radial speed-line vignette. A
**diagonal panel slashes in** from the right (Persona-style): the defending
player's portrait, the trigger ("Your student was struck by *Fireball*!"),
and the reaction options as cards (Wrath of Heaven, Sacred Shield, …) plus a
big "Let it happen" pass button. Choosing a reaction stamps the card down
with an impact frame (2 frames of white flash + 4px screen shake).

This converts the engine's most bureaucratic moment (interrupt stack) into
the most exciting one, *and* it doubles as the hot-seat hand-off cue since
the responder is a different player.

### 9.2 Spellbook & casting

Spells render as a **tome** in the dock: cover shows department sigil; tabs
show unlocked levels as gem-bookmarks (Ⅰ Ⅱ Ⅲ — gems lit when INT/WIS placed,
greyed when locked, cracked when exhausted). Casting flow:

1. Click tome → it opens floating center-left, pages for each level.
2. Hover a level → mana cost chips glow; if unaffordable, the gem dims and
   the mana chip shakes 2px on click (refusal microinteraction).
3. Cast → the page's rune-script lights up in department color, the tome
   snaps shut, and a glyph-comet flies from the book to the target/board,
   delivering the effect FX.
4. Once-per-game spells (Devastation L3) burn: page edges char permanently.

### 9.3 Shadow placement

Placing into a shadow slot: the student token *splits* — body stays ghosted
at origin for 200ms, the astral copy (cyan rim, 55% opacity, particle wisps)
drifts into the shadow position with a smear trail. Swaps (Envelop, Shift)
play both moves simultaneously with crossing arcs.

### 9.4 Marks & voters

The Council rail shows voter tiles face-down (rune-back). Gaining a mark:
your player-color wax seal *stamps* onto the tile (squash & stretch, wax
splat particles). Peeking (purple mage / spells) opens the **privacy flow**:
"Pass the device/look away" interstitial → tilt-reveal only after the active
player confirms.

### 9.5 Turn hand-off (hot-seat)

Between turns: full-width banner sweeps across — active player's color wash,
portrait, name in display font, "Day 3 · Your move". 900ms, skippable on
click. Doubles as the anti-information-leak curtain.

---

## 10. Animation & Motion Guidelines

- **Library:** Framer Motion for layout/gesture/presence; CSS keyframes for
  ambient infinite loops (cheaper, no JS). Don't mix per-element.
- **Durations:** micro (hover, chip) 120–160ms · placement/cards 300–450ms
  spring · set-pieces (flip, destroy, cut-in) 600–1200ms, max one per action.
- **Easing:** springs for objects (stiffness 350–450, damping 20–26);
  `ease-out` for UI panels; `anticipate` for cut-ins.
- **Ambient motion budget:** at most 3 always-on loop types visible (island
  floaty, slot breathe, sky drift). Everything else event-driven. 60fps —
  animate only `transform`/`opacity`/`filter`.
- **Stagger:** lists (hand fans, options) animate in with 30–40ms stagger.
- **Impact grammar:** good things bounce (spring overshoot); bad things hit
  (2-frame flash + shake); mystical things drift (long ease, particles).
- **Reduced motion:** respect `prefers-reduced-motion` — swap set-pieces for
  300ms crossfades; never gate information behind an animation.
- **Interruptibility:** all FX are fire-and-forget visuals over settled
  state; clicking through is always safe (engine state already advanced).

---

## 11. UI State Matrix (slots & cards)

| State | Slot (spell circle) | Card |
| --- | --- | --- |
| Idle | dashed white/25 circle | parchment face, `shadow-card` |
| Available | cyan glow, breathe, rune-ring spins | lifted 4px, leyline ring pulse |
| Hover | brighten + ghost preview occupant | `-translate-y-2 rotate-1 shadow-card-lift`, zoom affordance |
| Selected | starlight ring, scale 1.06 | starlight ring + sticky lift |
| Occupied | solid player-color ring + token | — |
| Exhausted | — | desat 45% + diagonal "used" ribbon + cracked gem |
| Disabled/illegal | 60% dim, no pointer, shake on click | dim + cost chip flashes red on click |
| Locked (room) | chains + padlock + desat | — |
| Hostile-targetable | rose glow + crosshair runes | — |

---

## 12. Example Screen Mockups (descriptions)

**A. Mid-round campus (Errands, Day 2, afternoon).** Dusk-orange sky, eight
islands drifting over cloud wisps, ley-lines pulsing. The Library island has
two students on lit circles (one red-aura, one blue-aura) and a spectral
green student hovering in a shadow position. Right rail: Council tower with
two wax seals visible, bell meter showing 3 bells left. Bottom dock: active
player's portrait (smug tinkerer), resource chips, four bench students
bobbing idly, three card fans. One room glows cyan — a placement is legal
there and the player is hovering a student.

**B. Casting Devastation L3.** Board dims; every eligible island lifts above
the scrim with rose-red targeting glow; Central Campus islands visibly duck
below it (excluded). Breadcrumb top-center: "Devastation ▸ choose a room to
destroy". Player clicks the Guilds — confirmation chip ("This is forever ⚠"),
then the set-piece: island cracks, fragments tumble, dust, the grid keeps an
ember-rimmed gap. Opponent rail portraits do a worried wobble.

**C. Reaction cut-in.** Frozen desaturated board behind diagonal violet
panel: worried diviner portrait, "Naomi's student was struck by *Frost
Bolt*!", two reaction cards fanned (Sacred Shield glowing — affordable;
Phase Steppers dim — exhausted), and a large "Take the hit" button with a
gritted-teeth icon.

**D. Election ceremony (final scoring).** The campus recedes; the Council
rotunda rises center-screen under night sky + fireworks. Voter tiles flip
one at a time (1s cadence, skippable), each declaring its criterion in
display type ("Most devoted to *Mysticism*…"), wax seals fly to the leader,
running totals tick up on player podiums that physically rise. Confetti +
title card for the winner: "Archmage-Elect".

---

## 13. Experimental Ideas (ranked by value/effort)

1. **Day/night bell-sky** (§1) — high value, low effort (one gradient bound
   to `bellTower.available.length`). DO FIRST.
2. **Floating-island campus with seeded drift** — high value, medium effort;
   it *is* the art direction.
3. **Cut-in reactions** — the signature; medium effort, reuses ChoiceSheet
   logic.
4. **Room flip/destroy set-pieces** — engine already has the mechanics; the
   UI owes them spectacle.
5. **Expression system** (portrait emotion per prompt context) — low effort,
   outsized charm.
6. **Tome interface for spellbooks** — medium effort, strong theme cohesion.
7. **Seasonal dressing per round** (Day 1 spring petals → Day 5 winter
   lanterns) — pure CSS layer swaps; nice-to-have.
8. **Living campus idle events** (a book cart crosses a bridge; an owl lands
   on the Bell Tower between turns) — delight layer, post-launch.
9. **Relationship sparks** (when two specific archetypes share a room, tiny
   heart/rivalry emotes) — purely cosmetic, post-launch.

---

## 14. Build Order (suggested)

1. `uiStore` + GameScreen shell + CampusBoard grid from `roomLayout` (flat
   placeholder islands) + MageToken Tier 0 + ActionSlot states + PLACE_WORKER
   via TargetingLayer. *Playable.*
2. PromptDirector + ChoiceSheet + ReactionCutIn (functional, plain) — at this
   point **every engine prompt is playable** and the whole game runs.
3. PlayerDock (resources, bench, fans) + SpellBook + cast flow + TurnBanner.
4. Design-system pass: palette, fonts, panel/card recipes, state matrix.
5. Motion pass: layoutId glides, placement springs, FX layer + state-diff FX.
6. Set-pieces: day/night sky, flip, destroy, cut-in styling, ceremony.
7. Art pass: room scenes, portrait busts, ambient loops.

Each step ships a playable game; polish accretes without blocking play.
