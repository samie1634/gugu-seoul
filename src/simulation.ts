/** Coordinates are metres; north is -Z. The model is independent of rendering. */
export interface Obstacle {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  minY?: number;
}

export interface FlightInput {
  forward: number;
  turn: number;
  /** Optional absolute world heading supplied by manual camera-relative controls. */
  moveHeading?: number;
  /** Manual left/right arrow input also turns the local camera; never networked. */
  cameraTurn?: number;
  roll?: number;
  accelerate?: boolean;
  peckHeld?: boolean;
  peckReleased?: boolean;
  /** Internal scene-owned assisted flight, never raw DOM input. Targets use body centre. */
  owlHuntMotion?: { target: { x: number; y: number; z: number }; speed: number; phase: 'dive' | 'rise' };
  flapPressed: boolean;
  flapHeld: boolean;
  descend: boolean;
}

export interface BirdState {
  movementScale?: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  mode: 'rest' | 'walk' | 'flap' | 'glide' | 'fall';
  heldSeconds: number;
  flapAge: number;
  steps: number;
  flaps: number;
}

export const BODY_RADIUS = 0.65;
export const GLIDE_DELAY = 0.24;
export const MAX_ALTITUDE = 180;
export const BOUNDS = { minX: -590, maxX: 650, minZ: -665, maxZ: 560 };

export function createBirdState(): BirdState {
  return {
    x: -37, y: BODY_RADIUS, z: 8, heading: 0,
    vx: 0, vy: 0, vz: 0, grounded: true, mode: 'rest',
    heldSeconds: 0, flapAge: 10, steps: 0, flaps: 0,
  };
}

export function emptyInput(): FlightInput {
  return { forward: 0, turn: 0, flapPressed: false, flapHeld: false, descend: false };
}

export function advanceBird(state: BirdState, input: FlightInput, seconds: number, obstacles: readonly Obstacle[], movementScale = 1): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const dt = Math.min(seconds, 0.1);
  const scale = movementScale === .5 ? .5 : 1, ratio = scale / (state.movementScale ?? 1);
  state.vx *= ratio; state.vy *= ratio; state.vz *= ratio; state.movementScale = scale;
  if (input.flapPressed) {
    state.grounded = false;
    state.vy = Math.min(16 * scale, Math.max(0, state.vy) + 9.4 * scale);
    state.flapAge = 0;
    state.flaps += 1;
  }
  state.heldSeconds = input.flapHeld ? state.heldSeconds + dt : 0;
  state.flapAge += dt;
  const slices = Math.ceil(dt / (1 / 90));
  for (let i = 0; i < slices; i += 1) integrate(state, input, dt / slices, obstacles);
}

function integrate(s: BirdState, input: FlightInput, dt: number, obstacles: readonly Obstacle[]): void {
  const scale = s.movementScale ?? 1;
  const oldX = s.x;
  const oldZ = s.z;
  const oldY = s.y;
  if (Number.isFinite(input.moveHeading)) s.heading = input.moveHeading!;
  else s.heading += Math.max(-1, Math.min(1, input.turn)) * (s.grounded ? 2.35 : 1.35) * dt * scale;
  const gliding = !s.grounded && input.flapHeld && s.heldSeconds >= GLIDE_DELAY && !input.descend;
  const directing = Math.abs(input.forward) > 0.001 || Math.abs(input.turn) > 0.001;
  const forwardFlight = input.flapHeld || s.flapAge < .42 || input.accelerate;
  const speed = scale * (s.grounded ? Math.max(-1, Math.min(1, input.forward)) * 6.2
    // Legacy selectable species cannot hover; retain passive falls and C descent.
    : directing || forwardFlight || input.descend ? (gliding ? 22 : 17) * (1 + input.forward * 0.25) : 0);
  const acceleration = 1 - Math.exp(-(s.grounded ? 14 : 3.5) * dt);
  s.vx += (Math.sin(s.heading) * speed - s.vx) * acceleration;
  s.vz += (-Math.cos(s.heading) * speed - s.vz) * acceleration;
  if (!s.grounded) {
    if (gliding) {
      // Holding extends the wings once; it never repeats the take-off impulse.
      s.vy += (-1.7 * scale - s.vy) * (1 - Math.exp(-3.5 * dt));
    } else {
      s.vy -= (input.descend ? 25 : 16) * dt * scale;
      s.vy = Math.max((input.descend ? -21 : -16) * scale, s.vy);
    }
  }
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.y += s.vy * dt;

  let support = 0;
  for (const b of obstacles) {
    const left = b.x - b.width / 2 - BODY_RADIUS;
    const right = b.x + b.width / 2 + BODY_RADIUS;
    const near = b.z - b.depth / 2 - BODY_RADIUS;
    const far = b.z + b.depth / 2 + BODY_RADIUS;
    if (s.x <= left || s.x >= right || s.z <= near || s.z >= far) continue;
    if (oldY - BODY_RADIUS >= b.height - 0.04 && s.vy <= 0) {
      support = Math.max(support, b.height);
      continue;
    }
    const bottom = b.minY ?? 0;
    if (s.y - BODY_RADIUS >= b.height || s.y + BODY_RADIUS <= bottom) continue;
    if (bottom > 0 && oldY + BODY_RADIUS <= bottom && s.vy > 0) {
      s.y = bottom - BODY_RADIUS; s.vy = 0; continue;
    }
    if (oldX <= left) { s.x = left; s.vx = 0; }
    else if (oldX >= right) { s.x = right; s.vx = 0; }
    else if (oldZ <= near) { s.z = near; s.vz = 0; }
    else if (oldZ >= far) { s.z = far; s.vz = 0; }
    else {
      const distances = [s.x - left, right - s.x, s.z - near, far - s.z];
      const side = distances.indexOf(Math.min(...distances));
      if (side < 2) { s.x = side === 0 ? left : right; s.vx = 0; }
      else { s.z = side === 2 ? near : far; s.vz = 0; }
    }
  }
  if (s.y <= support + BODY_RADIUS && s.vy <= 0) {
    s.y = support + BODY_RADIUS;
    s.vy = 0;
    s.grounded = true;
  } else if (s.y > support + BODY_RADIUS + 0.06) s.grounded = false;
  if (s.y > MAX_ALTITUDE) { s.y = MAX_ALTITUDE; s.vy = Math.min(0, s.vy); }
  s.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, s.x));
  s.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, s.z));
  if (s.grounded) {
    const walked = Math.hypot(s.x - oldX, s.z - oldZ);
    s.steps += walked;
    s.mode = walked > 0.0005 ? 'walk' : 'rest';
  } else s.mode = gliding ? 'glide' : s.flapAge < 0.42 ? 'flap' : 'fall';
}
