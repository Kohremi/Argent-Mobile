import type { PackId } from '../game/types';
import type { ContentPack } from './types';
import { baseGamePack } from './packs/base';
import { mancersPack } from './packs/mancers';
import { archmagePack } from './packs/archmage';
import { renovationPack } from './packs/renovation';
import { summerBreakPack } from './packs/summerbreak';
// Importing this module runs scenario registration as a side effect.
import './scenarios';

const packs = new Map<PackId, ContentPack>();

export function registerPack(pack: ContentPack): void {
  if (packs.has(pack.id)) {
    throw new Error(`Pack "${pack.id}" is already registered`);
  }
  packs.set(pack.id, pack);
}

export function getPack(id: PackId): ContentPack | undefined {
  return packs.get(id);
}

export function requirePack(id: PackId): ContentPack {
  const pack = packs.get(id);
  if (!pack) throw new Error(`Pack "${id}" is not registered`);
  return pack;
}

export function listPacks(): ContentPack[] {
  return Array.from(packs.values());
}

// Built-in packs are registered eagerly. Third-party packs (if we ever support
// them) would call `registerPack` themselves.
registerPack(baseGamePack);
registerPack(mancersPack);
registerPack(archmagePack);
registerPack(renovationPack);
registerPack(summerBreakPack);
