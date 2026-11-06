import type { BodyProfile, Vec3 } from '../../native/ported/shared-contracts.ts';
import type { BirdState } from '../../simulation.ts';
import type { BirdPoseInput } from '../../native/ported/birds/rig-core/pose.ts';
import type { NpcState } from '../../native/ported/npcs/src/contracts.ts';
import type { NpcProfile } from '../../native/ported/npcs/src/profiles.ts';

export type { BirdPoseInput } from '../../native/ported/birds/rig-core/pose.ts';
export type MotionPoseState = Readonly<Pick<BirdState, 'mode' | 'steps' | 'flapAge' | 'grounded'>>;

export interface MotionPoseTiming {
  /** Active simulation seconds. Freeze this clock and state when paused. */
  readonly simTime: number;
  readonly calledAt?: number;
  readonly landedAt?: number;
  readonly reducedMotion?: boolean;
}

/** Local preview duration for the landing weight, in simulation seconds. */
export const LANDING_BLEND_SECONDS = 0.24;

export function toBirdPoseInput(state: MotionPoseState, timing: MotionPoseTiming): BirdPoseInput {
  const { simTime, calledAt, landedAt, reducedMotion } = timing;
  const landAge = landedAt === undefined ? Infinity : simTime - landedAt;
  const landProgress = Math.min(1, Math.max(0, landAge / LANDING_BLEND_SECONDS));
  const landing = state.grounded && landAge >= 0
    ? 1 - landProgress * landProgress * (3 - 2 * landProgress)
    : 0;
  return {
    mode: state.mode,
    time: simTime,
    flapAge: state.flapAge,
    steps: state.steps,
    landing,
    ...(calledAt !== undefined && Number.isFinite(calledAt) && calledAt <= simTime
      ? { callAge: simTime - calledAt }
      : {}),
    ...(reducedMotion === undefined ? {} : { reducedMotion }),
  };
}

export type BirdRootState = Readonly<Pick<BirdState, 'x' | 'y' | 'z' | 'heading'>>;

export interface NativeBirdRootPlacement {
  readonly position: Vec3;
  readonly yaw: number;
}

/** Translate a physics centre to the native metre rig's sole origin. */
export function toNativeBirdRootPlacement(
  state: BirdRootState, body: Pick<BodyProfile, 'centreToSoleM'>,
): NativeBirdRootPlacement {
  return {
    position: { x: state.x, y: state.y - body.centreToSoleM, z: state.z },
    yaw: -state.heading,
  };
}


export type NpcPoseState = Pick<NpcState,
  'id' | 'kind' | 'x' | 'y' | 'z' | 'heading' | 'action' | 'speed' | 'gaitDistance' | 'age'>;
export type NpcGaitProfile = Pick<NpcProfile, 'stride' | 'walkSpeed'>;

export interface NpcPoseWeights {
  readonly look: number;
  readonly avoid: number;
  readonly startle: number;
}

export interface NpcPoseTransition {
  /** The same NPC's age at its last action change. */
  readonly startedAtAge: number;
  readonly from: NpcPoseWeights;
}

export interface NpcPoseInput {
  readonly id: NpcState['id'];
  readonly kind: NpcState['kind'];
  readonly action: NpcState['action'];
  readonly feet: Readonly<{ x: number; y: number; z: number }>;
  readonly yaw: number;
  readonly speed: number;
  readonly age: number;
  /** Fraction of a full stride, derived solely from accumulated metres. */
  readonly gaitPhase: number;
  readonly gaitWeight: number;
  readonly weights: NpcPoseWeights;
}

const NPC_ACTION_BLEND_SECONDS = 0.15;

export function toNpcPoseInput(
  state: NpcPoseState, profile: NpcGaitProfile, transition?: NpcPoseTransition,
): NpcPoseInput {
  const { id, kind, x, y, z, heading, action, speed, gaitDistance, age } = state;
  const targets = {
    look: Number(action === 'look'),
    avoid: Number(action === 'avoid'),
    startle: Number(action === 'startle'),
  };
  let weights: NpcPoseWeights = targets;
  if (transition) {
    const t = Math.min(1, Math.max(0, (age - transition.startedAtAge) / NPC_ACTION_BLEND_SECONDS));
    const blend = t * t * (3 - 2 * t);
    const mix = (from: number, to: number) => from + (to - from) * blend;
    weights = {
      look: mix(transition.from.look, targets.look),
      avoid: mix(transition.from.avoid, targets.avoid),
      startle: mix(transition.from.startle, targets.startle),
    };
  }

  return {
    id, kind, action, feet: { x, y, z }, yaw: -heading, speed, age,
    gaitPhase: (gaitDistance % profile.stride) / profile.stride,
    gaitWeight: Math.min(1, Math.max(0, speed / profile.walkSpeed)),
    weights,
  };
}
