import type { NativeBody, NativeSweepHit, NativeWorldQueries, Vec3 } from '../../locomotion/b2/contracts.ts';
import {
  cameraNearRadius, type CameraBird, type CameraProjection, type ChaseOffsets,
  type Vec3 as CameraPoint, type ViewMode,
} from '../camera-resolver.ts';

export type { CameraPoint, CameraProjection, ViewMode };

export interface NativeCameraMetrics extends ChaseOffsets {
  /** Physics-centre to sole distance and local -Z-forward eye position measured from the sole. */
  readonly body: Pick<NativeBody, 'centreToSoleM' | 'eyeFromSoleM'>;
}

export interface NativeCameraRequest {
  readonly bird: CameraBird;
  readonly mode: ViewMode;
  readonly world: Pick<NativeWorldQueries, 'sphereClear' | 'sweepSphere'>;
  readonly metrics: NativeCameraMetrics;
  readonly projection: CameraProjection;
  readonly acceptedSeconds: number;
  /** Omit on initial placement or an intentional cut. Use the last displayed position otherwise. */
  readonly previousPosition?: CameraPoint;
  /** Final posed eye in world metres, after the caller updates rig matrices. */
  readonly posedEyeWorld?: Vec3;
  readonly reducedMotion?: boolean;
}

export type NativeCameraResult =
  | { readonly kind: 'resolved'; readonly position: CameraPoint; readonly lookAt: CameraPoint;
      readonly up: CameraPoint; readonly cut: boolean; readonly occluded: boolean }
  | { readonly kind: 'blocked';
      readonly reason: 'invalid-view' | 'invalid-query' | 'no-clear-anchor' | 'no-clear-previous' };

const worldUp: CameraPoint = Object.freeze([0, 1, 0]);
const skin = 0.001;
const add = (a: CameraPoint, b: CameraPoint): CameraPoint => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix = (a: CameraPoint, b: CameraPoint, t: number): CameraPoint => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];
const distance = (a: CameraPoint, b: CameraPoint): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function isCameraPoint(p: unknown): p is CameraPoint {
  return Array.isArray(p) && p.length === 3 && [p[0], p[1], p[2]].every(Number.isFinite);
}

function isWorldPoint(p: unknown): p is Vec3 {
  if (!p || typeof p !== 'object') return false;
  const { x, y, z } = p as Partial<Vec3>;
  return [x, y, z].every(Number.isFinite);
}

const toWorld = ([x, y, z]: CameraPoint): Vec3 => ({ x, y, z });
const toCamera = ({ x, y, z }: Vec3): CameraPoint => [x, y, z];

function validHit(hit: unknown, from: CameraPoint, to: CameraPoint): hit is NativeSweepHit {
  if (!hit || typeof hit !== 'object') return false;
  const { fraction, point, normal, colliderId, layerId } = hit as Partial<NativeSweepHit>;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 ||
    !isWorldPoint(point) || !isWorldPoint(normal) || typeof colliderId !== 'string' || !colliderId ||
    (layerId !== undefined && typeof layerId !== 'string')) return false;
  return Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1) <= 1e-3 &&
    distance(toCamera(point), mix(from, to, fraction)) <= 1e-6;
}

function cameraClearance(world: NativeCameraRequest['world'], radiusM: number) {
  function clear(point: CameraPoint): boolean {
    const result = world.sphereClear(toWorld(point), radiusM);
    if (result !== true && result !== false) throw new TypeError('Unverified camera sphere overlap');
    return result;
  }
  function sweep(from: CameraPoint, to: CameraPoint): NativeSweepHit | null {
    if (distance(from, to) === 0) return null; // All sweep starts have already been verified clear.
    const result = world.sweepSphere(toWorld(from), toWorld(to), radiusM);
    if (result === null || validHit(result, from, to)) return result;
    throw new TypeError('Unverified camera sphere sweep');
  }
  function clip(from: CameraPoint, to: CameraPoint): { position: CameraPoint; hit: NativeSweepHit | null } {
    const hit = sweep(from, to);
    const position = hit ? mix(from, to, Math.max(0, hit.fraction - skin / distance(from, to))) : to;
    if (!clear(position)) throw new TypeError('Sweep did not yield a clear camera sphere');
    return { position, hit };
  }
  return { clear, sweep, clip };
}

export function resolveNativeCamera({
  bird, mode, world, metrics, projection, acceptedSeconds, previousPosition, posedEyeWorld, reducedMotion,
}: NativeCameraRequest): NativeCameraResult {
  if (!bird || !metrics?.body || !projection) return { kind: 'blocked', reason: 'invalid-view' };
  const centre: CameraPoint = [bird.x, bird.y, bird.z];
  const { body, chaseTargetOffset, chaseGroundOffset, chaseAirOffset } = metrics;
  const radius = cameraNearRadius(projection);
  if (!isCameraPoint(centre) || ![bird.heading, bird.vy, body.centreToSoleM, acceptedSeconds, radius].every(Number.isFinite) ||
    body.centreToSoleM <= 0 || acceptedSeconds < 0 || acceptedSeconds > 0.1 ||
    !(projection.near > 0 && projection.aspect > 0 && projection.verticalFovDegrees > 0 && projection.verticalFovDegrees < 180) ||
    (mode !== 'first' && mode !== 'third') ||
    ![chaseTargetOffset, chaseGroundOffset, chaseAirOffset].every(isCameraPoint) || !isWorldPoint(body.eyeFromSoleM) ||
    (previousPosition !== undefined && !isCameraPoint(previousPosition)) ||
    (posedEyeWorld !== undefined && !isWorldPoint(posedEyeWorld))) {
    return { kind: 'blocked', reason: 'invalid-view' };
  }
  if (!world || typeof world.sphereClear !== 'function' || typeof world.sweepSphere !== 'function') {
    return { kind: 'blocked', reason: 'invalid-query' };
  }

  const first = mode === 'first';
  const sin = Math.sin(bird.heading);
  const cos = Math.cos(bird.heading);
  const rotate = ([x, y, z]: CameraPoint): CameraPoint => [cos * x - sin * z, y, sin * x + cos * z];
  const eye = body.eyeFromSoleM;
  const localEye: CameraPoint = [eye.x, eye.y - body.centreToSoleM, eye.z];
  const nominalTarget = first ? centre : add(centre, rotate(chaseTargetOffset));
  const offset = first ? localEye : bird.grounded ? chaseGroundOffset : chaseAirOffset;
  const desired = first && posedEyeWorld ? toCamera(posedEyeWorld) : add(centre, rotate(offset));
  if (!isCameraPoint(nominalTarget) || !isCameraPoint(desired) ||
    !Number.isFinite(distance(centre, nominalTarget) + distance(nominalTarget, desired) +
      (previousPosition ? distance(previousPosition, centre) + distance(previousPosition, desired) : 0))) {
    return { kind: 'blocked', reason: 'invalid-view' };
  }

  // One sphere covers the lens-to-near-plane volume in every orientation.
  const { clear, sweep, clip } = cameraClearance(world, radius + skin);
  let position: CameraPoint;
  let target: CameraPoint;
  let occluded = false;
  try {
    let anchor = centre;
    if (!clear(anchor)) {
      const reference = first ? desired : nominalTarget;
      // The body centre is a logical reference. It can be too close to support for
      // the full lens volume. Verify an alternate full-radius anchor and confirm
      // a point-scale connection to the bird before using it.
      const connector = cameraClearance(world, skin);
      if (!clear(reference) || !connector.clear(centre) || connector.sweep(centre, reference) !== null) {
        return { kind: 'blocked', reason: 'no-clear-anchor' };
      }
      anchor = reference;
    }
    if (previousPosition && !clear(previousPosition)) return { kind: 'blocked', reason: 'no-clear-previous' };

    target = first ? anchor : clip(anchor, nominalTarget).position;
    const goal = clip(target, desired).position;
    position = goal;
    if (previousPosition) {
      const alpha = acceptedSeconds === 0 ? 0 : first || reducedMotion ? 1 : -Math.expm1(-6 * acceptedSeconds);
      const step = clip(previousPosition, mix(previousPosition, goal, alpha));
      position = step.position;
      occluded = sweep(target, position) !== null;
      if (!first && alpha > 0 && step.hit && occluded) {
        // A straight chase can remain pinned against a roof after the bird falls
        // below it. Try one bounded tangent chord from the previous safe centre.
        // Every displayed step is still a single verified sweep, never a cut.
        const wanted = mix(previousPosition, goal, alpha);
        const normals = [step.hit.normal];
        for (let attempt = 0; attempt < 4; attempt++) {
          let delta: CameraPoint = [wanted[0] - previousPosition[0], wanted[1] - previousPosition[1], wanted[2] - previousPosition[2]];
          for (const n of normals) {
            const inward = Math.min(0, delta[0] * n.x + delta[1] * n.y + delta[2] * n.z);
            delta = [delta[0] - inward * n.x, delta[1] - inward * n.y, delta[2] - inward * n.z];
          }
          const tangent: CameraPoint = [previousPosition[0] + delta[0], previousPosition[1] + delta[1], previousPosition[2] + delta[2]];
          const alternative = clip(previousPosition, tangent);
          if (distance(alternative.position, goal) + skin < distance(position, goal)) {
            position = alternative.position;
            occluded = sweep(target, position) !== null;
          }
          if (!alternative.hit) break;
          normals.push(alternative.hit.normal);
        }
      }
      const pinned = step.hit && distance(previousPosition, position) < 2 * skin;
      // Retract along the existing tether only if the entire alternative path is clear.
      if (alpha > 0 && (pinned || occluded) && sweep(previousPosition, target) === null) {
        const retracted = mix(previousPosition, target, alpha);
        if (!clear(retracted)) throw new TypeError('Retraction did not yield a clear camera sphere');
        position = retracted;
        occluded = false;
      }
      if (!clear(position) || sweep(previousPosition, position) !== null) {
        throw new TypeError('Final displayed camera chord is not verified clear');
      }
    }
  } catch {
    return { kind: 'blocked', reason: 'invalid-query' };
  }

  const horizontal = Math.hypot(position[0] - target[0], position[2] - target[2]);
  const nearPole = horizontal < Math.max(1e-6, 0.01 * Math.abs(position[1] - target[1]));
  const pitch = first ? Math.max(-3, Math.min(4, bird.vy * 0.28)) : 0;
  const lookAt = first || nearPole ? add(position, [sin * 40, pitch, -cos * 40]) : target;
  if (!isCameraPoint(lookAt) || (lookAt[0] === position[0] && lookAt[2] === position[2])) {
    return { kind: 'blocked', reason: 'invalid-view' };
  }
  return { kind: 'resolved', position, lookAt, up: worldUp, cut: previousPosition === undefined, occluded };
}
