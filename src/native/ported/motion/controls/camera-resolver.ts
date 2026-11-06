import type { BodyProfile } from '../../shared-contracts.ts';
import type { BirdState, Obstacle } from '../../../../simulation.ts';

export type Vec3 = readonly [x: number, y: number, z: number];
export type CameraBird = Readonly<Pick<BirdState, 'x' | 'y' | 'z' | 'heading' | 'vy' | 'grounded'>>;
export type ViewMode = 'first' | 'third';

/** Metres from BirdState's body centre; local +X is right, -Z is forward. */
export interface ChaseOffsets {
  readonly chaseTargetOffset: Vec3;
  readonly chaseGroundOffset: Vec3;
  readonly chaseAirOffset: Vec3;
}

export type BirdViewMetrics = ChaseOffsets & { readonly bodyCollisionRadius: number } & (
  | { readonly eyeOrigin: 'body-centre'; readonly eyeOffset: Vec3 }
  | { readonly eyeOrigin: 'sole'; readonly soleOffset: Vec3; readonly eyeOffset: Vec3 }
);

export const LEGACY_BIRD_VIEW: BirdViewMetrics = {
  eyeOrigin: 'body-centre',
  eyeOffset: [0, 0.66, -0.47],
  chaseTargetOffset: [0, 0.7, 0],
  chaseGroundOffset: [0, 3.1, 7.8],
  chaseAirOffset: [0, 3.7, 10.4],
  bodyCollisionRadius: 0.65,
};

/** Adapt the real-metre body contract without conflating sole height and horizontal radius. */
export function viewMetricsFromBody(
  { horizontalRadiusM, centreToSoleM, eyeFromSoleM }: Pick<BodyProfile, 'horizontalRadiusM' | 'centreToSoleM' | 'eyeFromSoleM'>,
  chase: ChaseOffsets,
): BirdViewMetrics {
  return {
    ...chase, eyeOrigin: 'sole', bodyCollisionRadius: horizontalRadiusM,
    soleOffset: [0, -centreToSoleM, 0], eyeOffset: [eyeFromSoleM.x, eyeFromSoleM.y, eyeFromSoleM.z],
  };
}

export interface CameraProjection {
  readonly near: number;
  readonly verticalFovDegrees: number;
  readonly aspect: number;
}

/** Pass the live projection (including aspect after resize) when integrating. */
export const LEGACY_CAMERA_PROJECTION: CameraProjection = { near: 0.12, verticalFovDegrees: 59, aspect: 16 / 9 };

export interface CameraRequest {
  readonly bird: CameraBird;
  readonly mode: ViewMode;
  readonly obstacles: readonly Obstacle[];
  readonly dt: number;
  readonly previousPosition?: Vec3;
  /** Optional animated rig anchor in world metres, used only in first person. */
  readonly firstPersonEyeWorld?: Vec3;
  readonly metrics?: BirdViewMetrics;
  readonly projection?: CameraProjection;
  readonly reducedMotion?: boolean;
}

export type CameraResult =
  | { readonly kind: 'resolved'; readonly position: Vec3; readonly lookAt: Vec3;
      readonly cut: boolean; readonly occluded: boolean }
  | { readonly kind: 'blocked'; readonly reason: 'invalid-view' | 'no-clear-anchor' };

type Axis = 0 | 1 | 2;
const axes = [0, 1, 2] as const;
type Bounds = { readonly min: Vec3; readonly max: Vec3 };
type Space = { readonly floor: number; readonly boxes: readonly Bounds[] };

const skin = 0.001;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];
const distance = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const finiteVec = (v: Vec3): boolean => v.every(Number.isFinite);
const rotated = ([x, y, z]: Vec3, sin: number, cos: number): Vec3 => [cos * x - sin * z, y, sin * x + cos * z];

/** Radius enclosing all four near-plane corners for any camera orientation. */
export function cameraNearRadius({ near, verticalFovDegrees, aspect }: CameraProjection): number {
  const halfHeight = near * Math.tan(verticalFovDegrees * Math.PI / 360);
  return Math.hypot(near, halfHeight, halfHeight * aspect);
}

function makeSpace(obstacles: readonly Obstacle[], clearance: number): Space {
  const boxes: Bounds[] = [];
  for (const { x, z, width, depth, height, minY = 0 } of obstacles) {
    if (![x, z, width, depth, height, minY].every(Number.isFinite) || width <= 0 || depth <= 0 || height < minY) continue;
    boxes.push({
      min: [x - width / 2 - clearance, minY - clearance, z - depth / 2 - clearance],
      max: [x + width / 2 + clearance, height + clearance, z + depth / 2 + clearance],
    });
  }
  return { floor: clearance, boxes };
}

function contains(box: Bounds, point: Vec3): boolean {
  return axes.every(axis => point[axis] >= box.min[axis] && point[axis] <= box.max[axis]);
}

function isFree(point: Vec3, space: Space): boolean {
  return finiteVec(point) && point[1] > space.floor && !space.boxes.some(box => contains(box, point));
}

/** The start of each sweep is in free space. t=1 contact is still a hit. */
function firstHit(start: Vec3, end: Vec3, space: Space): number | null {
  let hit = end[1] <= space.floor ? (start[1] - space.floor) / (start[1] - end[1]) : null;
  for (const { min, max } of space.boxes) {
    let entry = 0;
    let exit = hit ?? 1;
    for (const axis of axes) {
      const d = end[axis] - start[axis];
      if (d === 0) {
        if (start[axis] < min[axis] || start[axis] > max[axis]) { exit = -1; break; }
      } else {
        const a = (min[axis] - start[axis]) / d;
        const b = (max[axis] - start[axis]) / d;
        entry = Math.max(entry, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (entry > exit) break;
      }
    }
    if (entry <= exit) hit = entry;
  }
  return hit;
}

function stopBefore(start: Vec3, end: Vec3, hit: number | null): Vec3 {
  return hit === null ? end : mix(start, end, Math.max(0, hit - skin / distance(start, end)));
}

function clip(start: Vec3, end: Vec3, space: Space): Vec3 {
  return stopBefore(start, end, firstHit(start, end, space));
}

/** Recover a shallow overlap only. Deep/ambiguous geometry has no trusted anchor. */
function findAnchor(centre: Vec3, radius: number, space: Space): Vec3 | null {
  if (isFree(centre, space)) return centre;
  let best: Vec3 | null = null;
  let bestDistance = Infinity;
  function tryFace(axis: Axis, value: number): void {
    const shift = Math.abs(value - centre[axis]);
    if (shift > radius || shift >= bestDistance) return;
    const candidate: [number, number, number] = [...centre];
    candidate[axis] = value;
    if (isFree(candidate, space)) { best = candidate; bestDistance = shift; }
  }
  if (centre[1] <= space.floor) tryFace(1, space.floor + skin);
  for (const box of space.boxes) {
    if (!contains(box, centre)) continue;
    for (const axis of axes) {
      tryFace(axis, box.min[axis] - skin);
      tryFace(axis, box.max[axis] + skin);
    }
  }
  return best;
}

export function resolveCamera({
  bird, mode, obstacles, dt, previousPosition, firstPersonEyeWorld, metrics = LEGACY_BIRD_VIEW,
  projection = LEGACY_CAMERA_PROJECTION, reducedMotion = false,
}: CameraRequest): CameraResult {
  const centre: Vec3 = [bird.x, bird.y, bird.z];
  const radius = cameraNearRadius(projection);
  if (!finiteVec(centre) || !Number.isFinite(bird.heading) || !Number.isFinite(bird.vy) ||
    !Number.isFinite(metrics.bodyCollisionRadius) || metrics.bodyCollisionRadius <= 0 ||
    !Number.isFinite(radius) || projection.near <= 0 || projection.aspect <= 0 ||
    !(projection.verticalFovDegrees > 0 && projection.verticalFovDegrees < 180)) {
    return { kind: 'blocked', reason: 'invalid-view' };
  }
  // A sphere around the camera encloses the near plane even during an abrupt yaw/pitch.
  // Expanding the boxes by that radius is conservative at their corners.
  const space = makeSpace(obstacles, radius + skin);
  const anchor = findAnchor(centre, metrics.bodyCollisionRadius, space);
  if (!anchor) return { kind: 'blocked', reason: 'no-clear-anchor' };

  const sin = Math.sin(bird.heading);
  const cos = Math.cos(bird.heading);
  const first = mode === 'first';
  const nominalTarget = first ? anchor : add(centre, rotated(metrics.chaseTargetOffset, sin, cos));
  const eye = metrics.eyeOrigin === 'sole' ? add(metrics.soleOffset, metrics.eyeOffset) : metrics.eyeOffset;
  const offset = first ? eye : bird.grounded ? metrics.chaseGroundOffset : metrics.chaseAirOffset;
  const desired = first && firstPersonEyeWorld ? firstPersonEyeWorld : add(centre, rotated(offset, sin, cos));
  if (!finiteVec(nominalTarget) || !finiteVec(desired)) return { kind: 'blocked', reason: 'invalid-view' };
  const target = clip(anchor, nominalTarget, space);
  const goal = clip(target, desired, space);

  let position = goal;
  let cut = true;
  if (previousPosition && isFree(previousPosition, space)) {
    cut = false;
    const alpha = Number.isFinite(dt) && dt > 0 ? (first || reducedMotion ? 1 : -Math.expm1(-6 * dt)) : 0;
    const candidate = mix(previousPosition, goal, alpha);
    const movementHit = firstHit(previousPosition, candidate, space);
    position = stopBefore(previousPosition, candidate, movementHit);
    // If the chord is pinned at a wall or loses sight of the tether, shorten the
    // boom toward the anchor only when that alternate motion is itself clear.
    const stalled = movementHit !== null && distance(previousPosition, position) < 2 * skin;
    if (alpha > 0 && (stalled || firstHit(target, position, space) !== null) &&
      firstHit(previousPosition, target, space) === null) {
      position = mix(previousPosition, target, alpha);
    }
  }

  const pitch = first ? Math.max(-3, Math.min(4, bird.vy * 0.28)) : 0;
  const lookAt = first || distance(position, target) < skin
    ? add(position, [sin * 40, pitch, -cos * 40]) : target;
  return { kind: 'resolved', position, lookAt, cut, occluded: firstHit(target, position, space) !== null };
}
