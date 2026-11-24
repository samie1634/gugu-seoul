import type { NativeMotionTuning } from './native/ported/motion/locomotion/b2/native-motion.ts';
import { FED_FLIGHT_TUNING } from './native/flight-feeding.ts';

// Game adjustments based on recorded kinematics, not video playback speed.
// Walking: Queen's gait thesis, Table 3.2; Troje & Frost (2000), real-time 60 Hz.
// Launch: Berg & Biewener (2010), JEB Fig. 2, calibrated perch-to-perch video.
// The 8–10 m/s game cruise/glide remains faster than their short perch flights.
export const PIGEON_PLAYER_TUNING: NativeMotionTuning = Object.freeze({
  walkSpeed: .19, flightSpeed: 8, glideSpeed: 10,
  takeoff: Object.freeze({ seconds: .52, launchSpeed: 1.5, endSpeed: 4.5, liftSpeed: 6.8 }),
});
// Food keeps its promised 2× walking bonus and original absolute air speeds.
export const PIGEON_FED_TUNING: NativeMotionTuning = Object.freeze({
  ...FED_FLIGHT_TUNING, walkSpeed: PIGEON_PLAYER_TUNING.walkSpeed * 2,
});
export const PIGEON_HOLD_WALK_MAX = .70;
export const PIGEON_MANUAL_PECK_RATE = .70;
// The accepted 3-target GLB first touches the floor at ~0.65 clip seconds.
export const PIGEON_APPROVED_FLOOR_CONTACT = .65 * PIGEON_MANUAL_PECK_RATE;
export const PIGEON_AUTO_PECK_EXTENSION = .26;
export const pigeonPeckClockDelta = (look: string|null|undefined, dt: number) =>
  look === 'pigeon' || look === 'white' ? dt * PIGEON_MANUAL_PECK_RATE : dt;

/**
 * Spend a little more time aiming and straightening without slowing the three
 * already-authored impacts as a group. Both feet remain in the original GLB.
 */
export function pigeonAutoPeckClipAge(age: number, duration: number): number {
  const aim = .55, aimExtra = .16, recoverExtra = PIGEON_AUTO_PECK_EXTENSION - aimExtra;
  if (duration <= aim + .30) return Math.max(0, Math.min(duration, age));
  const recover = duration - .30;
  if (age <= aim + aimExtra) return Math.max(0, age) * aim / (aim + aimExtra);
  if (age <= recover + aimExtra) return age - aimExtra;
  return Math.min(duration, recover + (age - recover - aimExtra) * .30 / (.30 + recoverExtra));
}
