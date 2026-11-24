import { sampleDayCycle } from '../day-cycle.ts';
import type { NativeMotionTuning } from './ported/motion/locomotion/b2/native-motion.ts';

/** The sun is below the horizon from 18:00 until 06:00 on the existing game clock. */
export function isOwlNight(activeSeconds: number): boolean {
  const hour = sampleDayCycle(activeSeconds).hour;
  return hour >= 18 || hour < 6;
}
export function owlMovementScale(species: string, activeSeconds: number): number {
  return species === 'eagle-owl' && !isOwlNight(activeSeconds) ? .5 : 1;
}
/** Compose with food tuning rather than replacing it. */
export function owlFlightTuning(tuning: NativeMotionTuning, species: string, activeSeconds: number): NativeMotionTuning {
  const movementScale = owlMovementScale(species, activeSeconds);
  if (movementScale === 1) return tuning;
  return { walkSpeed: tuning.walkSpeed * movementScale, flightSpeed: tuning.flightSpeed * movementScale,
    glideSpeed: tuning.glideSpeed * movementScale, movementScale };
}
