import { rebaseCameraOrbit, turnCameraOrbit } from './camera-relative-movement.ts';

export interface CameraOrbitAngles {
  /** Horizontal offset from the normal chase/eye direction. Positive is right. */
  readonly yaw: number;
  /** Absolute elevation. Positive is skyward; null retains the normal camera pitch. */
  readonly pitch: number | null;
}

export type CameraVector = readonly [number, number, number];
export const CAMERA_ORBIT_LIMIT = Math.PI * 0.47;
const sensitivity = 0.005;
const clampPitch = (pitch: number): number => Math.max(-CAMERA_ORBIT_LIMIT, Math.min(CAMERA_ORBIT_LIMIT, pitch));

/** Shared local viewing direction for a bird-centred orbit and first-person eyes. */
export function orbitViewDirection(forward: CameraVector, look: CameraOrbitAngles): CameraVector {
  const yaw = Math.atan2(forward[0], -forward[2]) + look.yaw;
  const pitch = look.pitch ?? Math.atan2(forward[1], Math.hypot(forward[0], forward[2]));
  const horizontal = Math.cos(pitch);
  return [Math.sin(yaw) * horizontal, Math.sin(pitch), -Math.cos(yaw) * horizontal];
}


/** Orbit the camera around the bird, keeping its target and requested boom length.
 * Collision resolvers must clip this proposal before displaying it.
 */
export function birdOrbitPosition(target: CameraVector, normalPosition: CameraVector, orbit?: CameraOrbitAngles): CameraVector {
  if (!orbit || (orbit.yaw === 0 && orbit.pitch === null)) return normalPosition;
  const forward: CameraVector = [target[0] - normalPosition[0], target[1] - normalPosition[1], target[2] - normalPosition[2]];
  const radius = Math.hypot(...forward);
  const direction = orbitViewDirection(forward, orbit);
  return [target[0] - direction[0] * radius, target[1] - direction[1] * radius, target[2] - direction[2] * radius];
}

/** Smooth a manual orbit in angles, never along a chord through its centre.
 * When a wall/floor blocks the orbit, stop at a safe angle instead of zooming in.
 * The caller verifies both the displayed motion chord and the bird-to-camera tether.
 * A null result leaves recovery from an already occluded camera to the resolver.
 */
export function stableOrbitStep(
  target: CameraVector, previous: CameraVector, desired: CameraVector, alpha: number,
  canMove: (position: CameraVector) => boolean,
): CameraVector | null {
  const from = previous.map((value, i) => value - target[i]);
  const to = desired.map((value, i) => value - target[i]);
  const fromRadius = Math.hypot(...from), toRadius = Math.hypot(...to);
  if (fromRadius < 1e-6 || toRadius < 1e-6 || !canMove(previous)) return null;
  if (alpha <= 0) return previous;
  const yaw = Math.atan2(from[0], from[2]);
  const pitch = Math.atan2(from[1], Math.hypot(from[0], from[2]));
  const rawYaw = Math.atan2(to[0], to[2]) - yaw;
  const dyaw = Math.atan2(Math.sin(rawYaw), Math.cos(rawYaw));
  const dpitch = Math.atan2(to[1], Math.hypot(to[0], to[2])) - pitch;
  const dradius = toRadius - fromRadius;
  const at = (t: number, yawScale: number, pitchScale: number): CameraVector => {
    const r = fromRadius + dradius * t;
    const p = pitch + dpitch * t * pitchScale;
    const y = yaw + dyaw * t * yawScale;
    return [target[0] + r * Math.cos(p) * Math.sin(y), target[1] + r * Math.sin(p),
      target[2] + r * Math.cos(p) * Math.cos(y)];
  };
  const end = at(alpha, 1, 1);
  if (canMove(end)) return end;

  // Separate axes let horizontal dragging continue along a floor or wall limit.
  // Every candidate, including each bisection, passes the caller's exact sweeps.
  let best = previous;
  let bestError = dyaw * dyaw + dpitch * dpitch + (dradius / toRadius) ** 2;
  for (const [yawScale, pitchScale] of [[1, 1], [1, 0], [0, 1]]) {
    let low = 0, high = alpha;
    if (canMove(at(alpha, yawScale, pitchScale))) low = alpha;
    else for (let attempt = 0; attempt < 14; attempt++) {
      const mid = (low + high) / 2;
      if (canMove(at(mid, yawScale, pitchScale))) low = mid;
      else high = mid;
    }
    const candidate = at(low, yawScale, pitchScale);
    const error = (dyaw * (1 - low * yawScale)) ** 2 +
      (dpitch * (1 - low * pitchScale)) ** 2 + (dradius * (1 - low) / toRadius) ** 2;
    if (error < bestError && canMove(candidate)) { best = candidate; bestError = error; }
  }
  return best;
}

export function validCameraOrbit(orbit: CameraOrbitAngles | undefined): boolean {
  return orbit === undefined || (!!orbit && Number.isFinite(orbit.yaw) &&
    (orbit.pitch === null || (Number.isFinite(orbit.pitch) && Math.abs(orbit.pitch) <= CAMERA_ORBIT_LIMIT)));
}

/** One pointer owns a drag. All mouse, pen and touch motion follows the same path. */
export class CameraOrbitControls {
  private enabled = false;
  private drag: { id: number; x: number; y: number } | null = null;
  private look: CameraOrbitAngles = { yaw: 0, pitch: null };
  private readonly canvas: HTMLCanvasElement;
  private readonly readPitch: () => number;

  constructor(canvas: HTMLCanvasElement, readPitch: () => number) {
    this.canvas = canvas;
    this.readPitch = readPitch;
    canvas.addEventListener('pointerdown', event => {
      if (!this.enabled || this.drag || event.button !== 0 || !this.validPoint(event)) return;
      try { canvas.setPointerCapture(event.pointerId); }
      catch { return; }
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.enabled || this.drag?.id !== event.pointerId) return;
      // Recover if a mouse release happened outside the window before capture was lost.
      if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) { this.cancel(); return; }
      if (!this.validPoint(event)) { this.cancel(); return; }
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      if (dx === 0 && dy === 0) return;
      const pitch = this.look.pitch ?? this.readPitch();
      if (!Number.isFinite(pitch)) { this.cancel(); return; }
      // Clamp each actual move, so reversing at a limit responds immediately.
      const yaw = this.look.yaw + dx * sensitivity;
      this.look = { yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch: clampPitch(pitch - dy * sensitivity) };
      event.preventDefault();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, event => { if (this.drag?.id === event.pointerId) this.cancel(); });
    }
  }

  get angles(): CameraOrbitAngles { return { ...this.look }; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  cancel(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    try { if (this.canvas.hasPointerCapture(drag.id)) this.canvas.releasePointerCapture(drag.id); }
    catch { /* Capture may already have been released by the browser. */ }
  }

  rebaseHeading(before: number, after: number, cameraTurn = 0, seconds = 0): void {
    this.look = rebaseCameraOrbit(turnCameraOrbit(this.look, cameraTurn, seconds), before, after);
  }

  reset(): void {
    this.cancel();
    this.look = { yaw: 0, pitch: null };
  }

  private validPoint(event: PointerEvent): boolean {
    return Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
  }
}
