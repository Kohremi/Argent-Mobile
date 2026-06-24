// Assassins scenario effects.
//
//   R1 Preparations Made  → round end: gain a Mark that CANNOT be a Hit.
//   R2 Choosing Targets   → round end: gain a Mark that can ONLY be a Hit.
//   R3 Carrying out the Deed → action: send an office Mage to the Infirmary (no
//      bonus), then place a Hit on up to two DIFFERENT voters.
//
// The persistent "gain a Mark → may place a Hit instead" rule, the rounds-1–4
// gate, and the R4 "lose 1 IP per Hit" cost all live in `applyGainMark` /
// `buildGainMarkChooseVoterPrompt` (helpers.ts). The end-of-round discard of
// 3-hit voters lives in the engine's `processRoundSetup`.

import { registerEffect } from './registry';
import {
  allocateInfirmaryBed,
  applyGainMark,
  buildGainMarkChooseVoterPrompt,
  parseHitTarget,
} from './helpers';
import type { EffectResult, GameState, GameStatePatch, PlayerId } from '../types';

// ---------------------------------------------------------------------------
// R1 / R2 round-end "gain a Mark" in a fixed mode.
// ---------------------------------------------------------------------------

function registerGainMark(
  id: string,
  markMode: 'mark-only' | 'hit-only',
): void {
  registerEffect(id, (ctx): EffectResult => {
    if (!ctx.resumeAnswer) {
      const prompt = buildGainMarkChooseVoterPrompt(
        ctx.state,
        ctx.triggeringPlayerId,
        { markMode },
      );
      if (!prompt) return { kind: 'done', patch: {} };
      return {
        kind: 'pause',
        pending: {
          responderId: ctx.triggeringPlayerId,
          prompt,
          resume: { effectId: id, context: {} },
          source: ctx.source,
        },
      };
    }
    if (ctx.resumeAnswer.kind !== 'voter-chosen') {
      throw new Error(`${id} expected voter-chosen`);
    }
    return {
      kind: 'done',
      patch: applyGainMark(
        ctx.state,
        ctx.triggeringPlayerId,
        ctx.resumeAnswer.voterId,
      ),
    };
  });
}

registerGainMark('assassins.scenario.gain-mark-no-hit', 'mark-only');
registerGainMark('assassins.scenario.gain-hit-only', 'hit-only');

// ---------------------------------------------------------------------------
// R3 action — send an office Mage to the Infirmary, then place up to two Hits.
// ---------------------------------------------------------------------------

const STRIKE = 'assassins.scenario.infirmary-strike';

/** Office Mage → Infirmary, wounded, no bonus (mirrors the Well of Souls
 *  sacrifice / Burnout). Office mages hold no board slot, so none is cleared. */
function sendOfficeMageToInfirmary(
  state: GameState,
  playerId: PlayerId,
  mageId: string,
): GameStatePatch {
  const bed = allocateInfirmaryBed(state);
  return {
    players: state.players.map((p) =>
      p.id !== playerId
        ? p
        : {
            ...p,
            mages: p.mages.map((m) =>
              m.id !== mageId
                ? m
                : {
                    ...m,
                    isWounded: true,
                    isShadowing: false,
                    location: { kind: 'infirmary' as const, bed },
                  },
            ),
          },
    ),
  };
}

function hitPrompt(
  state: GameState,
  playerId: PlayerId,
  exclude: readonly string[],
  step: string,
  patch?: GameStatePatch,
): EffectResult {
  const prompt = buildGainMarkChooseVoterPrompt(state, playerId, {
    markMode: 'hit-only',
    excludeHitVoterIds: exclude,
  });
  if (!prompt) return { kind: 'done', ...(patch ? { patch } : { patch: {} }) };
  return {
    kind: 'pause',
    ...(patch ? { patch } : {}),
    pending: {
      responderId: playerId,
      prompt,
      resume: { effectId: STRIKE, context: { step, hitVoters: [...exclude] } },
      source: {
        kind: 'system',
        id: STRIKE,
        triggeringPlayerId: playerId,
        description: 'Infirmary Strike',
      },
    },
  };
}

registerEffect(STRIKE, (ctx): EffectResult => {
  const playerId = ctx.triggeringPlayerId;
  const step = ctx.resumeContext?.['step'] as string | undefined;

  // Step 0 — pick the office Mage to send to the Infirmary.
  if (!ctx.resumeAnswer) {
    const player = ctx.state.players.find((p) => p.id === playerId);
    const office = (player?.mages ?? []).filter(
      (m) => m.location.kind === 'office',
    );
    if (office.length === 0) return { kind: 'done', patch: {} };
    return {
      kind: 'pause',
      pending: {
        responderId: playerId,
        prompt: {
          kind: 'choose-target-mage',
          eligibleMageIds: office.map((m) => m.id),
        },
        resume: { effectId: STRIKE, context: { step: 'mage' } },
        source: ctx.source,
      },
    };
  }

  if (step === 'mage') {
    if (ctx.resumeAnswer.kind !== 'mage-chosen') {
      throw new Error(`${STRIKE} expected mage-chosen`);
    }
    const infirmaryPatch = sendOfficeMageToInfirmary(
      ctx.state,
      playerId,
      ctx.resumeAnswer.mageId,
    );
    const after: GameState = { ...ctx.state, ...infirmaryPatch };
    return hitPrompt(after, playerId, [], 'hit', infirmaryPatch);
  }

  if (step === 'hit') {
    if (ctx.resumeAnswer.kind !== 'voter-chosen') {
      throw new Error(`${STRIKE} expected voter-chosen`);
    }
    const patch = applyGainMark(ctx.state, playerId, ctx.resumeAnswer.voterId);
    const hit = parseHitTarget(ctx.resumeAnswer.voterId);
    const prior = (ctx.resumeContext?.['hitVoters'] as string[] | undefined) ?? [];
    const hitVoters = hit ? [...prior, hit] : prior;
    const after: GameState = { ...ctx.state, ...patch };
    // Offer a second Hit on a different voter, or stop.
    const canContinue = buildGainMarkChooseVoterPrompt(after, playerId, {
      markMode: 'hit-only',
      excludeHitVoterIds: hitVoters,
    });
    if (!canContinue) return { kind: 'done', patch };
    return {
      kind: 'pause',
      patch,
      pending: {
        responderId: playerId,
        prompt: {
          kind: 'choose-from-options',
          options: [
            { id: 'continue', label: 'Place a second Hit', payload: {} },
            { id: 'stop', label: 'Done', payload: {} },
          ],
        },
        resume: { effectId: STRIKE, context: { step: 'confirm2', hitVoters } },
        source: ctx.source,
      },
    };
  }

  if (step === 'confirm2') {
    if (ctx.resumeAnswer.kind !== 'option-chosen') {
      throw new Error(`${STRIKE} expected option-chosen`);
    }
    if (ctx.resumeAnswer.optionId === 'stop') return { kind: 'done', patch: {} };
    const hitVoters =
      (ctx.resumeContext?.['hitVoters'] as string[] | undefined) ?? [];
    return hitPrompt(ctx.state, playerId, hitVoters, 'hit2');
  }

  if (step === 'hit2') {
    if (ctx.resumeAnswer.kind !== 'voter-chosen') {
      throw new Error(`${STRIKE} expected voter-chosen`);
    }
    return {
      kind: 'done',
      patch: applyGainMark(ctx.state, playerId, ctx.resumeAnswer.voterId),
    };
  }

  throw new Error(`${STRIKE}: unexpected step ${step}`);
});
