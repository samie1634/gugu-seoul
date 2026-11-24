import type { FlightInput } from './simulation.ts';
import type { CameraOrbitAngles, CameraVector } from './camera-orbit.ts';

const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
export const CAMERA_KEY_TURN_SPEED = 1.6;

/** Add a bounded, time-based key turn before the existing collision-safe camera resolve.
 * Keep this pure so rejected/paused frames cannot accumulate unseen camera rotation.
 */
export function turnCameraOrbit(orbit: CameraOrbitAngles, axis: number | undefined, seconds: number): CameraOrbitAngles {
  if (!Number.isFinite(axis) || !Number.isFinite(seconds) || seconds <= 0 || seconds > .1) return orbit;
  return { ...orbit, yaw: wrap(orbit.yaw + Math.max(-1, Math.min(1, axis!)) * CAMERA_KEY_TURN_SPEED * seconds) };
}

/** Map only manual keyboard/stick axes into the displayed camera's horizontal plane.
 * Autonomous route controllers keep supplying their world-relative input unchanged.
 */
export function cameraRelativeMovement(input: Readonly<FlightInput>, direction: CameraVector, fallbackHeading: number): FlightInput {
  const forward = Number.isFinite(input.forward) ? Math.max(-1, Math.min(1, input.forward)) : 0;
  const right = Number.isFinite(input.turn) ? Math.max(-1, Math.min(1, input.turn)) : 0;
  const length = Math.hypot(forward, right);
  if (length < .001) return { ...input, forward: 0, turn: 0, moveHeading: undefined };
  const horizontal = Math.hypot(direction[0], direction[2]);
  const cameraHeading = Number.isFinite(horizontal) && horizontal > 1e-6
    ? Math.atan2(direction[0], -direction[2]) : fallbackHeading;
  return { ...input, forward: Math.min(1, length), turn: 0,
    moveHeading: wrap(cameraHeading + Math.atan2(right, forward)) };
}

/** Keep the view fixed in world space while a camera-relative actor turns under it. */
export function rebaseCameraOrbit(orbit: CameraOrbitAngles, before: number, after: number): CameraOrbitAngles {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return orbit;
  return { ...orbit, yaw: wrap(orbit.yaw - wrap(after - before)) };
}
