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
  flapPressed: boolean;
  flapHeld: boolean;
  descend: boolean;
}

export interface BirdState {
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

export function advanceBird(state: BirdState, input: FlightInput, seconds: number, obstacles: readonly Obstacle[]): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const dt = Math.min(seconds, 0.1);
  if (input.flapPressed) {
    state.grounded = false;
    state.vy = Math.min(16, Math.max(0, state.vy) + 9.4);
    state.flapAge = 0;
    state.flaps += 1;
  }
  state.heldSeconds = input.flapHeld ? state.heldSeconds + dt : 0;
  state.flapAge += dt;
  const slices = Math.ceil(dt / (1 / 90));
  for (let i = 0; i < slices; i += 1) integrate(state, input, dt / slices, obstacles);
}

function integrate(s: BirdState, input: FlightInput, dt: number, obstacles: readonly Obstacle[]): void {
  const oldX = s.x;
  const oldZ = s.z;
  const oldY = s.y;
  s.heading += Math.max(-1, Math.min(1, input.turn)) * (s.grounded ? 2.35 : 1.35) * dt;
  const gliding = !s.grounded && input.flapHeld && s.heldSeconds >= GLIDE_DELAY && !input.descend;
  const speed = s.grounded ? Math.max(-1, Math.min(1, input.forward)) * 6.2
    : (gliding ? 22 : 17) * (1 + input.forward * 0.25);
  const acceleration = 1 - Math.exp(-(s.grounded ? 14 : 3.5) * dt);
  s.vx += (Math.sin(s.heading) * speed - s.vx) * acceleration;
  s.vz += (-Math.cos(s.heading) * speed - s.vz) * acceleration;
  if (!s.grounded) {
    if (gliding) {
      // Holding extends the wings once; it never repeats the take-off impulse.
      s.vy += (-1.7 - s.vy) * (1 - Math.exp(-3.5 * dt));
    } else {
      s.vy -= (input.descend ? 25 : 16) * dt;
      s.vy = Math.max(input.descend ? -21 : -16, s.vy);
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
