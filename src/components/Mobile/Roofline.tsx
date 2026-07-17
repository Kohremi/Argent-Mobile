import type { ReactNode } from 'react';
import { roomIconKind, type RoomIconKind } from '../icons';

/**
 * The campus-map "skyline": a 13px architectural silhouette crowning each room
 * tile, keyed on the same name-classification as the room glyphs — a gabled
 * roof and cross for chapels, dome and crenellations for towers, a scalloped
 * awning for shopfronts, tent peaks for the training grounds. Identity you can
 * recognize by shape alone (any zoom, any color vision), replacing the little
 * header icon the tiles used to carry. Each roof is a handful of shapes in a
 * 106×13 box stretched to the tile's width; the parent sets `color` (the
 * room's reward hue) and the silhouette paints at half strength.
 */

const ROOF_BODY: Record<RoomIconKind, ReactNode> = {
  chapel: (
    // Central gable with a cross finial.
    <>
      <path d="M0 13 V9 H38 L53 2 L68 9 H106 V13 Z" />
      <rect x="51.6" y="-0.5" width="2.8" height="6" />
      <rect x="49.4" y="0.8" width="7.2" height="1.6" />
    </>
  ),
  astronomy: (
    // Observatory dome between crenellated parapets.
    <>
      <path d="M0 13 V8 H8 V5 H16 V8 H24 V5 H32 V8 H40 V13 Z" />
      <path d="M40 13 A 14 12 0 0 1 68 13 Z" />
      <path d="M68 13 V8 H76 V5 H84 V8 H92 V5 H100 V8 H106 V13 Z" />
    </>
  ),
  guild: (
    // Roof bar with the guild pennant flying from a pole.
    <>
      <rect x="0" y="9" width="106" height="4" />
      <rect x="10" y="0" width="2" height="9.5" />
      <path d="M12 1 H34 L27 4.5 L34 8 H12 Z" />
    </>
  ),
  stores: (
    // Striped shopfront awning with a scalloped hem.
    <>
      <rect x="0" y="0" width="106" height="6.5" />
      <path
        d="M0 6 A 6.6 5 0 0 0 13.2 6 A 6.6 5 0 0 0 26.4 6 A 6.6 5 0 0 0 39.6 6 A 6.6 5 0 0 0 52.8 6 A 6.6 5 0 0 0 66 6 A 6.6 5 0 0 0 79.2 6 A 6.6 5 0 0 0 92.4 6 A 6.6 5 0 0 0 105.6 6 L106 6 V2 H0 Z"
        fillOpacity="0.55"
      />
    </>
  ),
  library: (
    // Classical pediment over a cornice line.
    <>
      <path d="M8 13 V9 L53 2 L98 9 V13 Z" />
      <rect x="0" y="10" width="106" height="3" />
    </>
  ),
  archive: (
    // Low flat-topped mastaba — the records vault.
    <path d="M0 13 V10 H10 L20 4 H86 L96 10 H106 V13 Z" />
  ),
  courtyard: (
    // Tree canopies rising over the garden wall.
    <>
      <circle cx="18" cy="12" r="9" />
      <circle cx="42" cy="14" r="11" />
      <circle cx="70" cy="11" r="9" />
      <circle cx="94" cy="14" r="10" />
    </>
  ),
  catacombs: (
    // Lintel with burial arches hanging beneath.
    <>
      <rect x="0" y="0" width="106" height="4" />
      <path
        d="M14 13 A 10 9 0 0 1 34 13 Z M43 13 A 10 9 0 0 1 63 13 Z M72 13 A 10 9 0 0 1 92 13 Z"
        fillOpacity="0.6"
      />
    </>
  ),
  castle: (
    // Full crenellated battlement — the generic keep.
    <path d="M0 13 V6 H10 V2 H20 V6 H34 V2 H44 V6 H62 V2 H72 V6 H86 V2 H96 V6 H106 V13 Z" />
  ),
  vault: (
    // Heavy riveted cornice.
    <>
      <rect x="0" y="0" width="106" height="8" rx="1.5" />
      <circle cx="12" cy="10.5" r="1.3" />
      <circle cx="38" cy="10.5" r="1.3" />
      <circle cx="68" cy="10.5" r="1.3" />
      <circle cx="94" cy="10.5" r="1.3" />
    </>
  ),
  adventuring: (
    // Expedition flagline strung with pennants.
    <>
      <rect x="0" y="2" width="106" height="1.6" />
      <path d="M18 3.6 H28 L23 11 Z M52 3.6 H62 L57 11 Z M84 3.6 H94 L89 11 Z" />
    </>
  ),
  council: (
    // Civic dome flanked by flat wings, finial on top.
    <>
      <rect x="0" y="8" width="106" height="5" />
      <path d="M36 8 A 17 10 0 0 1 70 8 Z" />
      <rect x="51.5" y="0" width="3" height="3" rx="1" />
    </>
  ),
  'great-hall': (
    // One long feasting-hall gable spanning the whole tile.
    <>
      <path d="M4 13 V10 L53 1 L102 10 V13 Z" />
      <rect x="0" y="11" width="106" height="2" />
    </>
  ),
  golem: (
    // Rough-hewn stone blocks.
    <path d="M0 13 V7 H14 V3 H30 V9 H48 V4 H66 V9 H82 V3 H98 V7 H106 V13 Z" />
  ),
  lab: (
    // Flat roof with a chimney puffing bubbles.
    <>
      <rect x="0" y="9" width="106" height="4" />
      <rect x="70" y="2" width="7" height="8" rx="1" />
      <circle cx="81" cy="3" r="2" />
      <circle cx="86" cy="1.5" r="1.3" />
    </>
  ),
  tavern: (
    // Long sloped roof with the sign hanging by the door.
    <>
      <path d="M0 13 V10 L8 5 H98 L106 10 V13 Z" />
      <rect x="84" y="7" width="1.6" height="3" fillOpacity="0.7" />
      <rect x="80" y="9.5" width="10" height="3" rx="0.8" fillOpacity="0.7" />
    </>
  ),
  workshop: (
    // Sawtooth factory roof.
    <>
      <rect x="0" y="11" width="106" height="2" />
      <path d="M4 11 L18 4 V11 Z M32 11 L46 4 V11 Z M60 11 L74 4 V11 Z M88 11 L102 4 V11 Z" />
    </>
  ),
  training: (
    // Two field tents.
    <>
      <rect x="0" y="11.5" width="106" height="1.5" />
      <path d="M8 13 L28 3 L48 13 Z M58 13 L78 3 L98 13 Z" />
    </>
  ),
  dormitory: (
    // A terrace of little bedroom gables.
    <>
      <rect x="0" y="12" width="106" height="1" />
      <path d="M2 13 L18 5 L34 13 Z M36 13 L52 5 L68 13 Z M70 13 L86 5 L102 13 Z" />
    </>
  ),
  staff: (
    // The Archmage's spire.
    <>
      <rect x="0" y="10" width="106" height="3" />
      <path d="M45 10 L53 0 L61 10 Z" />
    </>
  ),
  infirmary: (
    // Flat ward roof with a medical cross.
    <>
      <rect x="0" y="6" width="106" height="7" />
      <rect x="52" y="0" width="2.4" height="5" />
      <rect x="50.7" y="1.3" width="5" height="2.4" />
    </>
  ),
};

export function Roofline({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 106 13"
      preserveAspectRatio="none"
      aria-hidden
      className={className}
      fill="currentColor"
    >
      {ROOF_BODY[roomIconKind(name)]}
    </svg>
  );
}
