import {
  BOUNDS, DEFAULT_MOTION_CONFIG, GLIDE_DELAY, MAX_ALTITUDE, MAX_FRAME_SECONDS, MAX_SUBSTEP_SECONDS, STEP_DISTANCE,
  type BirdState, type FlightInput, type MotionEvent,
} from '../motion.ts';
import type { NativeBody, NativeSupport, NativeSupportProbe, NativeSweepHit, NativeWorldQueries, Vec3 } from './contracts.ts';

export interface NativeMotionTuning {
  readonly walkSpeed: number;
  readonly flightSpeed: number;
  readonly glideSpeed: number;
}

export interface NativeMotionInit {
  readonly body?: NativeBody;
  readonly tuning?: Partial<NativeMotionTuning>;
  /** Body-centred snapshot. Omit for a spawn at feet. */
  readonly bird?: Readonly<BirdState>;
  readonly feet?: Vec3;
  readonly sourceId?: string;
  readonly time?: number;
  readonly nextEventSequence?: number;
}

export interface NativeMotionState extends BirdState {
  readonly body: NativeBody;
  readonly tuning: NativeMotionTuning;
  readonly sourceId: string;
  time: number;
  nextEventSequence: number;
  support: NativeSupport | null;
}

export type NativeMotionWorld = Pick<NativeWorldQueries, 'supportAt' | 'sweepBody'>;
export type NativeMotionFailure = 'invalid-state' | 'world-unavailable' | 'malformed-query' | 'initial-overlap';

interface FrameResult {
  state: NativeMotionState;
  acceptedSeconds: number;
  events: MotionEvent[];
}

export type NativeMotionResult = FrameResult & (
  { status: 'advanced' | 'idle' } | { status: 'blocked'; reason: NativeMotionFailure }
);

export const PIGEON_B2_PROXY: NativeBody = Object.freeze({
  horizontalRadiusM: 0.173,
  heightM: 0.225,
  centreToSoleM: 0.1125,
  footSupportRadiusM: 0.060,
  eyeFromSoleM: Object.freeze({ x: 0.025639, y: 0.198057, z: -0.108 }),
});

const DEFAULT_TUNING: NativeMotionTuning = Object.freeze({
  walkSpeed: DEFAULT_MOTION_CONFIG.walkSpeed,
  flightSpeed: DEFAULT_MOTION_CONFIG.flightSpeed,
  glideSpeed: DEFAULT_MOTION_CONFIG.glideSpeed,
});

const FLAP_SPEED = 9.4;
const MAX_RISE_SPEED = 16;
const MAX_DIVE_SPEED = 21;
const HOLD_EPS = 1e-9;
const CONTACT_EPS = 2e-6;
const MAX_CONTACTS = 3;
const LANDING_SAMPLES = 4;
const LANDING_BISECTIONS = 13;

class RejectedFrame extends Error {
  readonly reason: NativeMotionFailure;

  constructor(reason: NativeMotionFailure) {
    super(reason);
    this.reason = reason;
  }
}

function validPoint(p: Vec3): boolean {
  return !!p && [p.x, p.y, p.z].every(Number.isFinite);
}

function validNormal(n: Vec3): boolean {
  return validPoint(n) && Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 0.001;
}

function validBody(body: NativeBody): boolean {
  return !!body && [body.horizontalRadiusM, body.heightM, body.centreToSoleM, body.footSupportRadiusM].every(Number.isFinite) &&
    body.horizontalRadiusM > 0 && body.centreToSoleM > 0 && body.heightM > body.centreToSoleM &&
    body.footSupportRadiusM >= 0 && validPoint(body.eyeFromSoleM);
}

function validState(state: Readonly<NativeMotionState>): boolean {
  return validPoint(state) && [state.heading, state.vx, state.vy, state.vz, state.heldSeconds,
    state.flapAge, state.steps, state.flaps, state.time].every(Number.isFinite) &&
    state.x >= BOUNDS.minX && state.x <= BOUNDS.maxX && state.z >= BOUNDS.minZ &&
    state.z <= BOUNDS.maxZ && state.y <= MAX_ALTITUDE &&
    state.time >= 0 && state.heldSeconds >= 0 && state.steps >= 0 && state.flapAge >= 0 &&
    state.flaps >= 0 && typeof state.sourceId === 'string' && state.sourceId.length > 0 &&
    Number.isSafeInteger(state.nextEventSequence) && state.nextEventSequence > 0 &&
    validBody(state.body) && !!state.tuning &&
    [state.tuning.walkSpeed, state.tuning.flightSpeed, state.tuning.glideSpeed].every(n => Number.isFinite(n) && n > 0);
}

export function createNativeMotionState(init: NativeMotionInit = {}): NativeMotionState {
  const body = init.body ?? PIGEON_B2_PROXY;
  const feet = init.feet ?? { x: -37, y: 0, z: 8 };
  if (!validBody(body) || !validPoint(feet)) throw new RangeError('Invalid native bird geometry');
  const bird = init.bird ?? {
    x: feet.x, y: feet.y + body.centreToSoleM, z: feet.z, heading: 0,
    vx: 0, vy: 0, vz: 0, grounded: true, mode: 'rest' as const,
    heldSeconds: 0, flapAge: 10, steps: 0, flaps: 0,
  };
  const state: NativeMotionState = {
    ...bird,
    body: Object.freeze({ ...body, eyeFromSoleM: Object.freeze({ ...body.eyeFromSoleM }) }),
    tuning: Object.freeze({ ...DEFAULT_TUNING, ...init.tuning }),
    sourceId: init.sourceId ?? 'player', time: init.time ?? 0, nextEventSequence: init.nextEventSequence ?? 1,
    support: null,
  };
  if (!validState(state)) throw new RangeError('Invalid native motion state');
  return state;
}

export function nativeFeet(state: Pick<NativeMotionState, 'x' | 'y' | 'z' | 'body'>): Vec3 {
  return { x: state.x, y: state.y - state.body.centreToSoleM, z: state.z };
}

function point(state: Vec3): Vec3 {
  return { x: state.x, y: state.y, z: state.z };
}

function interpolate(a: Vec3, b: Vec3, f: number): Vec3 {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
}

function assignPosition(state: NativeMotionState, p: Vec3): void {
  state.x = p.x;
  state.y = p.y;
  state.z = p.z;
}

function query<T>(call: () => T | null | undefined): T | null {
  let value: T | null | undefined;
  try {
    value = call();
  } catch {
    throw new RejectedFrame('world-unavailable');
  }
  if (value === undefined) throw new RejectedFrame('world-unavailable');
  return value;
}

function supportAt(
  world: NativeMotionWorld, body: NativeBody, at: Vec3, previousFeetY: number,
  maxRiseM: number, maxDropM: number, layerId?: string,
): NativeSupport | null {
  const probe: NativeSupportProbe = {
    at, previousFeetY, maxRiseM, maxDropM, layerId,
    footRadiusM: body.footSupportRadiusM, heightM: body.heightM,
  };
  const support = query(() => world.supportAt(probe));
  if (support === null) return null;
  if (typeof support.id !== 'string' || !support.id || typeof support.layerId !== 'string' || !support.layerId ||
      typeof support.surface !== 'string' || !support.surface ||
      typeof support.walkable !== 'boolean' || typeof support.landable !== 'boolean' ||
      !validNormal(support.normal) || support.normal.y <= 0 || !Number.isFinite(support.height) ||
      support.height < Math.min(previousFeetY, at.y) - maxDropM - CONTACT_EPS ||
      support.height > previousFeetY + maxRiseM + CONTACT_EPS) throw new RejectedFrame('malformed-query');
  return { ...support, normal: { ...support.normal } };
}

function sweepBody(world: NativeMotionWorld, from: Vec3, to: Vec3, body: NativeBody): NativeSweepHit | null {
  const hit = query(() => world.sweepBody(from, to, body));
  if (hit === null) return null;
  if (!Number.isFinite(hit.fraction) || hit.fraction < 0 || hit.fraction > 1 ||
      !validPoint(hit.point) || !validNormal(hit.normal) ||
      typeof hit.colliderId !== 'string' || !hit.colliderId ||
      (hit.layerId !== undefined && typeof hit.layerId !== 'string')) throw new RejectedFrame('malformed-query');
  const expected = interpolate(from, to, hit.fraction);
  if (Math.hypot(hit.point.x - expected.x, hit.point.y - expected.y, hit.point.z - expected.z) > CONTACT_EPS) {
    throw new RejectedFrame('malformed-query');
  }
  return { ...hit, point: expected, normal: { ...hit.normal } };
}

type MotionDetail = { type: 'land'; impactSpeed: number } | { type: 'flap' | 'step' | 'support-lost' };

function emit(state: NativeMotionState, events: MotionEvent[], detail: MotionDetail, intensity: number): void {
  events.push({
    id: state.sourceId + ':' + state.nextEventSequence, sourceId: state.sourceId, time: state.time,
    position: detail.type === 'flap' ? point(state) : nativeFeet(state),
    intensity: Math.min(1, Math.max(0, intensity)), ...detail,
  });
  state.nextEventSequence += 1;
}

function groundIntensity(state: NativeMotionState): number {
  return Math.hypot(state.vx, state.vz) / state.tuning.walkSpeed;
}

function contactUnder(state: NativeMotionState, world: NativeMotionWorld): NativeSupport | null {
  const at = nativeFeet(state);
  const support = supportAt(world, state.body, at, at.y, CONTACT_EPS, CONTACT_EPS, state.support?.layerId);
  return support?.landable && Math.abs(support.height - at.y) <= CONTACT_EPS ? support : null;
}

function flap(state: NativeMotionState, world: NativeMotionWorld, events: MotionEvent[]): void {
  const velocity = Math.min(MAX_RISE_SPEED, Math.max(0, state.vy) + FLAP_SPEED);
  if (velocity <= state.vy || state.y >= MAX_ALTITUDE) return;
  const from = point(state);
  const hit = sweepBody(world, from, { ...from, y: Math.min(MAX_ALTITUDE, from.y + 0.001) }, state.body);
  if (hit) return;

  const impulse = velocity - state.vy;
  state.vy = velocity;
  state.grounded = false;
  state.support = null;
  state.flapAge = 0;
  state.flaps += 1;
  emit(state, events, { type: 'flap' }, impulse / FLAP_SPEED);
}

function canGlide(state: NativeMotionState, input: Readonly<FlightInput>): boolean {
  return !state.grounded && input.flapHeld && !input.descend && state.heldSeconds >= GLIDE_DELAY - HOLD_EPS;
}

function axis(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

export function advanceNativeMotion(
  state: Readonly<NativeMotionState>, input: Readonly<FlightInput>, seconds: number, world: NativeMotionWorld,
): NativeMotionResult {
  const unchanged = { state: { ...state }, acceptedSeconds: 0, events: [] };
  if (!Number.isFinite(seconds) || seconds <= 0) return { ...unchanged, status: 'idle' };
  if (!validState(state)) return { ...unchanged, status: 'blocked', reason: 'invalid-state' };
  if (!world || typeof world.supportAt !== 'function' || typeof world.sweepBody !== 'function') {
    return { ...unchanged, status: 'blocked', reason: 'world-unavailable' };
  }

  const next = { ...state };
  const events: MotionEvent[] = [];
  const acceptedSeconds = Math.min(seconds, MAX_FRAME_SECONDS);
  const controls = { ...input, forward: axis(input.forward), turn: axis(input.turn) };
  try {
    const start = point(next);
    if (sweepBody(world, start, start, next.body)) throw new RejectedFrame('initial-overlap');
    if (next.grounded) {
      next.support = contactUnder(next, world);
      if (!next.support) {
        next.grounded = false;
        emit(next, events, { type: 'support-lost' }, groundIntensity(next));
      }
    }

    if (!controls.flapHeld || controls.flapPressed) next.heldSeconds = 0;
    if (controls.flapPressed) flap(next, world, events);

    const count = Math.ceil(acceptedSeconds / MAX_SUBSTEP_SECONDS);
    const dt = acceptedSeconds / count;
    const endTime = state.time + acceptedSeconds;
    for (let i = 0; i < count; i += 1) {
      const sliceEnd = i === count - 1 ? endTime : state.time + (i + 1) * dt;
      const untilGlide = GLIDE_DELAY - next.heldSeconds;
      if (!next.grounded && controls.flapHeld && !controls.descend &&
          untilGlide > HOLD_EPS && untilGlide < dt - HOLD_EPS) {
        integrate(next, controls, untilGlide, next.time + untilGlide, world, events);
        integrate(next, controls, dt - untilGlide, sliceEnd, world, events);
      } else {
        integrate(next, controls, dt, sliceEnd, world, events);
      }
    }
  } catch (error) {
    if (error instanceof RejectedFrame) return { ...unchanged, status: 'blocked', reason: error.reason };
    throw error;
  }
  return { state: next, acceptedSeconds, events, status: 'advanced' };
}

interface Landing {
  position: Vec3;
  support: NativeSupport;
}

function landingOnSegment(
  world: NativeMotionWorld, body: NativeBody, from: Vec3, to: Vec3, limit: number,
): Landing | null {
  if (to.y > from.y) return null;
  const startFeetY = from.y - body.centreToSoleM;
  const atFraction = (fraction: number): Landing | null => {
    const p = interpolate(from, to, fraction);
    const at = { ...p, y: p.y - body.centreToSoleM };
    const support = supportAt(world, body, at, startFeetY, CONTACT_EPS, CONTACT_EPS);
    return support?.landable && support.height >= at.y - CONTACT_EPS
      ? { position: { ...p, y: support.height + body.centreToSoleM }, support } : null;
  };
  let previous = 0;
  for (let i = 0; i <= LANDING_SAMPLES; i += 1) {
    let high = limit * i / LANDING_SAMPLES;
    let landing = atFraction(high);
    if (landing) {
      let low = previous;
      for (let j = 0; j < LANDING_BISECTIONS && high > low; j += 1) {
        const mid = (low + high) / 2;
        const earlier = atFraction(mid);
        if (earlier) {
          high = mid;
          landing = earlier;
        } else low = mid;
      }
      return landing;
    }
    previous = high;
  }
  return null;
}

function plannedEnd(state: NativeMotionState, from: Vec3, dt: number, world: NativeMotionWorld): Vec3 {
  const desired = {
    x: Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, from.x + state.vx * dt)),
    y: Math.min(MAX_ALTITUDE, from.y + (state.grounded ? 0 : state.vy * dt)),
    z: Math.min(BOUNDS.maxZ, Math.max(BOUNDS.minZ, from.z + state.vz * dt)),
  };
  if (!state.grounded) return desired;
  const horizontal = Math.hypot(desired.x - from.x, desired.z - from.z);
  if (horizontal <= CONTACT_EPS) return desired;
  const feetY = from.y - state.body.centreToSoleM;
  const stepHeight = Math.min(0.045, 0.006 + 1.25 * horizontal);
  const support = supportAt(world, state.body, { ...desired, y: feetY }, feetY, stepHeight, stepHeight, state.support?.layerId);
  if (support?.walkable && support.landable) desired.y = support.height + state.body.centreToSoleM;
  return desired;
}

function move(state: NativeMotionState, dt: number, world: NativeMotionWorld): number | null {
  let remaining = dt;
  for (let i = 0; i < MAX_CONTACTS && remaining > HOLD_EPS; i += 1) {
    const from = point(state);
    const to = plannedEnd(state, from, remaining, world);
    const solid = sweepBody(world, from, to, state.body);
    const landing = state.grounded ? null : landingOnSegment(world, state.body, from, to, solid?.fraction ?? 1);
    if (landing && !sweepBody(world, landing.position, landing.position, state.body)) {
      const impact = Math.max(0, -state.vy);
      assignPosition(state, landing.position);
      state.vy = 0;
      state.grounded = true;
      state.support = landing.support;
      return impact;
    }
    if (!solid) {
      assignPosition(state, to);
      break;
    }

    assignPosition(state, solid.point);
    const n = solid.normal;
    const inward = state.vx * n.x + state.vy * n.y + state.vz * n.z;
    if (inward >= -HOLD_EPS) break;
    state.vx -= inward * n.x;
    state.vy -= inward * n.y;
    state.vz -= inward * n.z;
    remaining *= 1 - solid.fraction;
  }

  if ((state.x === BOUNDS.minX && state.vx < 0) || (state.x === BOUNDS.maxX && state.vx > 0)) state.vx = 0;
  if ((state.z === BOUNDS.minZ && state.vz < 0) || (state.z === BOUNDS.maxZ && state.vz > 0)) state.vz = 0;
  if (state.y === MAX_ALTITUDE && state.vy > 0) state.vy = 0;
  if (state.grounded) {
    state.support = contactUnder(state, world);
    state.grounded = state.support !== null;
    state.vy = 0;
  }
  return null;
}

function integrate(
  state: NativeMotionState, input: Readonly<FlightInput>, dt: number, time: number,
  world: NativeMotionWorld, events: MotionEvent[],
): void {
  const wasGrounded = state.grounded;
  const start = point(state);
  const gliding = canGlide(state, input);
  state.heading += input.turn * (wasGrounded ? 2.35 : 1.35) * dt;
  const { walkSpeed, flightSpeed, glideSpeed } = state.tuning;
  const speed = wasGrounded ? (state.support?.walkable ? input.forward * walkSpeed : 0) :
    (gliding ? glideSpeed : flightSpeed) * (1 + input.forward * 0.25);
  const acceleration = 1 - Math.exp(-(wasGrounded ? 14 : 3.5) * dt);
  state.vx += (Math.sin(state.heading) * speed - state.vx) * acceleration;
  state.vz += (-Math.cos(state.heading) * speed - state.vz) * acceleration;
  if (gliding) {
    state.vy += (-1.7 - state.vy) * (1 - Math.exp(-3.5 * dt));
  } else if (!wasGrounded) {
    state.vy = Math.max(input.descend ? -MAX_DIVE_SPEED : -16, state.vy - (input.descend ? 25 : 16) * dt);
  }

  const impactSpeed = move(state, dt, world);
  state.time = time;
  state.flapAge += dt;
  if (input.flapHeld) state.heldSeconds += dt;
  const walked = wasGrounded ? Math.hypot(state.x - start.x, state.z - start.z) : 0;
  const previousSteps = state.steps;
  state.steps += walked;
  if (Math.floor(state.steps / STEP_DISTANCE) > Math.floor(previousSteps / STEP_DISTANCE)) {
    emit(state, events, { type: 'step' }, walked / dt / walkSpeed);
  }
  if (impactSpeed !== null) emit(state, events, { type: 'land', impactSpeed }, impactSpeed / MAX_DIVE_SPEED);
  if (wasGrounded && !state.grounded) emit(state, events, { type: 'support-lost' }, groundIntensity(state));
  if (state.grounded) state.mode = walked / dt > 0.045 ? 'walk' : 'rest';
  else if (canGlide(state, input)) state.mode = 'glide';
  else state.mode = state.flapAge < 0.42 ? 'flap' : 'fall';
}
