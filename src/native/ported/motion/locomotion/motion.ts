import type { BirdState, FlightInput, Obstacle } from '../../../../simulation.ts';

export type { BirdState, FlightInput, Obstacle };

export interface MotionConfig {
  radius: number;
  height: number;
  centreToSoleM: number;
  eyeHeight: number;
  walkSpeed: number;
  flightSpeed: number;
  glideSpeed: number;
}

export interface MotionInit {
  bird?: Readonly<BirdState>;
  sourceId?: string;
  config?: Readonly<Partial<MotionConfig>>;
}

export interface MotionState extends BirdState {
  config: Readonly<MotionConfig>;
  sourceId: string;
  time: number;
  nextEventSequence: number;
}

export interface MotionPosition {
  x: number;
  y: number;
  z: number;
}

type MotionEventDetail =
  | { type: 'land'; impactSpeed: number }
  | { type: 'flap' | 'step' | 'support-lost' };

export type MotionEvent = MotionEventDetail & {
  id: string;
  sourceId: string;
  time: number;
  /** Body centre for flap, sole height at the AABB contact for ground events. */
  position: MotionPosition;
  intensity: number;
};

export interface MotionResult {
  state: MotionState;
  acceptedSeconds: number;
  events: MotionEvent[];
}

// Match the baseline map and pigeon. All bounds apply to the player's centre.
export const BODY_RADIUS = 0.65;
export const GLIDE_DELAY = 0.24;
export const MAX_ALTITUDE = 180;
export const BOUNDS = Object.freeze({ minX: -590, maxX: 650, minZ: -665, maxZ: 560 });
export const MAX_FRAME_SECONDS = 0.1;
export const MAX_SUBSTEP_SECONDS = 1 / 240;
export const STEP_DISTANCE = 0.8;

// Compatibility tuning in metres and metres per second, separate from rig measurements.
export const DEFAULT_MOTION_CONFIG: Readonly<MotionConfig> = Object.freeze({
  radius: BODY_RADIUS,
  height: 2 * BODY_RADIUS,
  centreToSoleM: BODY_RADIUS,
  eyeHeight: BODY_RADIUS + 0.66,
  walkSpeed: 6.2,
  flightSpeed: 17,
  glideSpeed: 22,
});

const FLAP_SPEED = 9.4;
const MAX_RISE_SPEED = 16;
const MAX_DIVE_SPEED = 21;
const HOLD_EPSILON = 1e-9;

const horizontalAxes = ['x', 'z'] as const;
const lowerBound = { x: BOUNDS.minX, z: BOUNDS.minZ };
const upperBound = { x: BOUNDS.maxX, z: BOUNDS.maxZ };

export function createMotionState({ bird, sourceId = 'player', config = {} }: MotionInit = {}): MotionState {
  const resolved = Object.freeze({
    ...DEFAULT_MOTION_CONFIG,
    ...config,
    centreToSoleM: config.centreToSoleM ?? config.radius ?? DEFAULT_MOTION_CONFIG.centreToSoleM,
  });
  const { radius, height, centreToSoleM, eyeHeight, walkSpeed, flightSpeed, glideSpeed } = resolved;
  if (!Object.values(resolved).every(Number.isFinite) ||
      radius <= 0 || centreToSoleM <= 0 || centreToSoleM >= MAX_ALTITUDE || height <= centreToSoleM ||
      eyeHeight < 0 || walkSpeed <= 0 || flightSpeed <= 0 || glideSpeed <= 0) {
    throw new RangeError('Invalid motion dimensions or speeds');
  }
  const initial = bird ?? {
    x: -37, y: centreToSoleM, z: 8, heading: 0,
    vx: 0, vy: 0, vz: 0, grounded: true, mode: 'rest' as const,
    heldSeconds: 0, flapAge: 10, steps: 0, flaps: 0,
  };
  return { ...initial, config: resolved, sourceId, time: 0, nextEventSequence: 1 };
}

export function motionAnchors(state: Pick<MotionState, 'y' | 'config'>): { feetY: number; eyeY: number } {
  const feetY = state.y - state.config.centreToSoleM;
  return { feetY, eyeY: feetY + state.config.eyeHeight };
}

export function advanceMotion(
  state: Readonly<MotionState>,
  input: Readonly<FlightInput>,
  seconds: number,
  obstacles: readonly Obstacle[],
): MotionResult {
  const next = { ...state };
  const events: MotionEvent[] = [];
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { state: next, acceptedSeconds: 0, events };
  }

  const acceptedSeconds = Math.min(seconds, MAX_FRAME_SECONDS);
  const controls = { ...input, forward: axisValue(input.forward), turn: axisValue(input.turn) };

  if (next.grounded && !hasSupport(next, obstacles)) {
    next.grounded = false;
    emit(next, events, { type: 'support-lost' }, groundIntensity(next));
  }
  if (!controls.flapHeld || controls.flapPressed) next.heldSeconds = 0;
  if (controls.flapPressed) applyFlap(next, obstacles, events);

  const slices = Math.ceil(acceptedSeconds / MAX_SUBSTEP_SECONDS);
  const slice = acceptedSeconds / slices;
  const endTime = state.time + acceptedSeconds;
  for (let i = 0; i < slices; i += 1) {
    const sliceEnd = i === slices - 1 ? endTime : state.time + (i + 1) * slice;
    const untilGlide = GLIDE_DELAY - next.heldSeconds;
    if (!next.grounded && controls.flapHeld && !controls.descend &&
        untilGlide > HOLD_EPSILON && untilGlide < slice - HOLD_EPSILON) {
      integrate(next, controls, untilGlide, next.time + untilGlide, obstacles, events);
      integrate(next, controls, slice - untilGlide, sliceEnd, obstacles, events);
    } else {
      integrate(next, controls, slice, sliceEnd, obstacles, events);
    }
  }
  return { state: next, acceptedSeconds, events };
}

function axisValue(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function emit(state: MotionState, events: MotionEvent[], detail: MotionEventDetail, strength: number): void {
  events.push({
    id: state.sourceId + ':' + state.nextEventSequence,
    sourceId: state.sourceId,
    time: state.time,
    ...detail,
    position: {
      x: state.x, y: detail.type === 'flap' ? state.y : state.y - state.config.centreToSoleM, z: state.z,
    },
    intensity: Math.min(1, Math.max(0, strength)),
  });
  state.nextEventSequence += 1;
}

function insideFootprint(position: MotionPosition, obstacle: Obstacle, radius: number): boolean {
  const left = obstacle.x - obstacle.width / 2 - radius;
  const right = obstacle.x + obstacle.width / 2 + radius;
  const north = obstacle.z - obstacle.depth / 2 - radius;
  const south = obstacle.z + obstacle.depth / 2 + radius;
  return position.x > left && position.x < right && position.z > north && position.z < south;
}

function hasSupport(state: MotionState, obstacles: readonly Obstacle[]): boolean {
  const { radius, centreToSoleM } = state.config;
  return state.y === centreToSoleM || obstacles.some(obstacle =>
    state.y === obstacle.height + centreToSoleM && insideFootprint(state, obstacle, radius));
}

function groundIntensity(state: MotionState): number {
  return Math.hypot(state.vx, state.vz) / state.config.walkSpeed;
}

function applyFlap(state: MotionState, obstacles: readonly Obstacle[], events: MotionEvent[]): void {
  const velocity = Math.min(MAX_RISE_SPEED, Math.max(0, state.vy) + FLAP_SPEED);
  const { radius, height, centreToSoleM } = state.config;
  const topOffset = height - centreToSoleM;
  if (velocity <= state.vy || state.y >= MAX_ALTITUDE || obstacles.some(obstacle =>
    state.y === (obstacle.minY ?? 0) - topOffset && insideFootprint(state, obstacle, radius))) return;

  const impulse = velocity - state.vy;
  state.vy = velocity;
  state.grounded = false;
  state.flapAge = 0;
  state.flaps += 1;
  emit(state, events, { type: 'flap' }, impulse / FLAP_SPEED);
}

function canGlide(state: MotionState, input: FlightInput): boolean {
  return !state.grounded && input.flapHeld && !input.descend &&
    state.heldSeconds >= GLIDE_DELAY - HOLD_EPSILON;
}

function integrate(
  state: MotionState,
  input: FlightInput,
  dt: number,
  time: number,
  obstacles: readonly Obstacle[],
  events: MotionEvent[],
): void {
  const wasGrounded = state.grounded;
  const oldX = state.x;
  const oldZ = state.z;
  const gliding = canGlide(state, input);
  state.heading += input.turn * (wasGrounded ? 2.35 : 1.35) * dt;
  const { walkSpeed, flightSpeed, glideSpeed } = state.config;
  const speed = wasGrounded ? input.forward * walkSpeed
    : (gliding ? glideSpeed : flightSpeed) * (1 + input.forward * 0.25);
  const acceleration = 1 - Math.exp(-(wasGrounded ? 14 : 3.5) * dt);
  state.vx += (Math.sin(state.heading) * speed - state.vx) * acceleration;
  state.vz += (-Math.cos(state.heading) * speed - state.vz) * acceleration;
  if (gliding) {
    state.vy += (-1.7 - state.vy) * (1 - Math.exp(-3.5 * dt));
  } else if (!wasGrounded) {
    const gravity = input.descend ? 25 : 16;
    const terminalSpeed = input.descend ? MAX_DIVE_SPEED : 16;
    state.vy = Math.max(-terminalSpeed, state.vy - gravity * dt);
  }
  const descentSpeed = Math.max(0, -state.vy);
  move(state, dt, obstacles);
  state.grounded = state.vy <= 0 && hasSupport(state, obstacles);
  state.time = time;
  state.flapAge += dt;
  if (input.flapHeld) state.heldSeconds += dt;

  const walked = wasGrounded ? Math.hypot(state.x - oldX, state.z - oldZ) : 0;
  const previousSteps = state.steps;
  state.steps += walked;
  if (Math.floor(state.steps / STEP_DISTANCE) > Math.floor(previousSteps / STEP_DISTANCE)) {
    emit(state, events, { type: 'step' }, walked / dt / walkSpeed);
  }
  if (!wasGrounded && state.grounded) {
    emit(state, events, { type: 'land', impactSpeed: descentSpeed }, descentSpeed / MAX_DIVE_SPEED);
  }
  if (wasGrounded && !state.grounded) emit(state, events, { type: 'support-lost' }, groundIntensity(state));

  if (state.grounded) state.mode = walked / dt > 0.045 ? 'walk' : 'rest';
  else if (canGlide(state, input)) state.mode = 'glide';
  else state.mode = state.flapAge < 0.42 ? 'flap' : 'fall';
}

// Centre sweep against the same radius-expanded box envelope as the baseline.
type Contact = Partial<MotionPosition> & { time: number };
type Crossing = { enter: number; exit: number; face: number };
const stationaryInside = { enter: -Infinity, exit: Infinity, face: 0 };

function crossAxis(start: number, delta: number, min: number, max: number): Crossing | undefined {
  // Travel parallel to a touching face is allowed.
  if (delta === 0) return start > min && start < max ? stationaryInside : undefined;
  const face = delta > 0 ? min : max;
  const far = delta > 0 ? max : min;
  const enter = (face - start) / delta;
  const exit = (far - start) / delta;
  if (enter > 1 || exit <= 0) return;
  return { enter, exit, face };
}

function earlier(current: Contact | undefined, hit: Contact): Contact {
  if (!current || hit.time < current.time) return hit;
  if (hit.time === current.time) return { ...current, ...hit };
  return current;
}

function firstContact(
  state: MotionState,
  delta: MotionPosition,
  obstacles: readonly Obstacle[],
): Contact | undefined {
  const { radius, height, centreToSoleM } = state.config;
  const topOffset = height - centreToSoleM;
  let contact: Contact | undefined;
  if (delta.y !== 0) {
    const y = delta.y > 0 ? MAX_ALTITUDE : centreToSoleM;
    const time = (y - state.y) / delta.y;
    if (time >= 0 && time <= 1) contact = { time, y };
  }
  for (const axis of horizontalAxes) {
    if (delta[axis] === 0) continue;
    const face = delta[axis] > 0 ? upperBound[axis] : lowerBound[axis];
    const time = (face - state[axis]) / delta[axis];
    if (time >= 0 && time <= 1) contact = earlier(contact, { time, [axis]: face });
  }

  for (const b of obstacles) {
    const x = crossAxis(state.x, delta.x, b.x - b.width / 2 - radius, b.x + b.width / 2 + radius);
    if (!x) continue;
    const z = crossAxis(state.z, delta.z, b.z - b.depth / 2 - radius, b.z + b.depth / 2 + radius);
    if (!z) continue;
    const y = crossAxis(state.y, delta.y, (b.minY ?? 0) - topOffset, b.height + centreToSoleM);
    if (!y) continue;
    const time = Math.max(x.enter, y.enter, z.enter);
    if (time < 0 || time >= Math.min(x.exit, y.exit, z.exit)) continue;

    // At a roof edge, a simultaneous vertical contact can settle while sliding across the top.
    const hit: Contact = { time };
    if (y.enter === time) hit.y = y.face;
    else {
      if (x.enter === time) hit.x = x.face;
      if (z.enter === time) hit.z = z.face;
    }
    contact = earlier(contact, hit);
  }
  return contact;
}

function move(state: MotionState, seconds: number, obstacles: readonly Obstacle[]): void {
  let remaining = seconds;
  // Each contact removes at least one moving axis for the rest of the slice.
  for (let pass = 0; pass < 3 && remaining > 0; pass += 1) {
    const delta = { x: state.vx * remaining, y: state.vy * remaining, z: state.vz * remaining };
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return;
    const hit = firstContact(state, delta, obstacles);
    const time = hit?.time ?? 1;
    state.x = hit?.x ?? state.x + delta.x * time;
    state.y = hit?.y ?? state.y + delta.y * time;
    state.z = hit?.z ?? state.z + delta.z * time;
    if (!hit) return;
    if (hit.x !== undefined) state.vx = 0;
    if (hit.y !== undefined) state.vy = 0;
    if (hit.z !== undefined) state.vz = 0;
    remaining *= 1 - time;
  }
}
