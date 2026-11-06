import type { NpcKind, NpcLimits, Probe } from './contracts.ts';

export interface NpcProfile extends Probe {
  readonly walkSpeed: number;
  readonly fleeSpeed: number;
  readonly reactionRadius: number;
  readonly stride: number;
  readonly maxStep: number;
  readonly pauseChance: number;
  readonly acceleration: number;
  readonly turnRate: number;
}
export const NPC_KINDS: readonly NpcKind[] = ['human', 'dog', 'cat', 'rat'];
export const HARD_MAX_NPCS = 48;
export const FIXED_STEP = 1 / 20;
export const MAX_FRAME_SECONDS = 0.1;
export const DEFAULT_LIMITS: NpcLimits = Object.freeze({ human: 18, dog: 4, cat: 5, rat: 7 });
/** Draft metre proportions, not approved final anatomy; use the shared bodyScale. */
export const PROFILES: Readonly<Record<NpcKind, NpcProfile>> = Object.freeze({
  human: Object.freeze({ kind: 'human', radius: 0.32, height: 1.8, walkSpeed: 1.15, fleeSpeed: 1.85, reactionRadius: 2.4, stride: 1.25, maxStep: 0.20, pauseChance: 0.22, acceleration: 1.8, turnRate: 2.8 }),
  dog: Object.freeze({ kind: 'dog', radius: 0.34, height: 0.76, walkSpeed: 1.25, fleeSpeed: 3.0, reactionRadius: 3.0, stride: 0.8, maxStep: 0.16, pauseChance: 0.32, acceleration: 3.5, turnRate: 4.0 }),
  cat: Object.freeze({ kind: 'cat', radius: 0.23, height: 0.48, walkSpeed: 0.85, fleeSpeed: 3.5, reactionRadius: 3.2, stride: 0.58, maxStep: 0.14, pauseChance: 0.40, acceleration: 4.2, turnRate: 5.0 }),
  rat: Object.freeze({ kind: 'rat', radius: 0.12, height: 0.22, walkSpeed: 1.05, fleeSpeed: 3.8, reactionRadius: 3.6, stride: 0.30, maxStep: 0.08, pauseChance: 0.28, acceleration: 5.0, turnRate: 6.0 }),
});

export function scaleProfiles(scale: number): Readonly<Record<NpcKind, NpcProfile>> {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 10) throw new RangeError('NPC bodyScale must be in (0, 10]');
  return Object.fromEntries(NPC_KINDS.map(kind => {
    const p = PROFILES[kind];
    return [kind, Object.freeze({ ...p, radius: p.radius * scale, height: p.height * scale,
      walkSpeed: p.walkSpeed * scale, fleeSpeed: p.fleeSpeed * scale,
      reactionRadius: p.reactionRadius * scale, stride: p.stride * scale, maxStep: p.maxStep * scale,
      acceleration: p.acceleration * scale })];
  })) as Readonly<Record<NpcKind, NpcProfile>>;
}
