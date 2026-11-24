import type { FlightInput } from './simulation.ts';

export type FlightModelReadiness = 'idle'|'loading'|'ready'|'fallback';
export const PIGEON_TAKEOFF_VALID_SECONDS = 12;
export type PigeonTakeoffIntent = Readonly<{ expiresAt: number }>;
type TakeoffContext = Readonly<{
  eligible: boolean;
  atRest: boolean;
  readiness: FlightModelReadiness;
  simTime: number;
}>;

/** Pure proposal. The native frame commits the queued intent atomically with its input. */
export function preparePigeonTakeoff(
  input: Readonly<FlightInput>, before: PigeonTakeoffIntent | null, c: TakeoffContext,
): { input: Readonly<FlightInput>; pending: PigeonTakeoffIntent | null } {
  // A camera/look switch, lost support, or explicit descent invalidates a waiting
  // action without disabling any fresh normal controls in that different mode.
  if (!c.eligible || !c.atRest || input.descend) return { input, pending: null };
  const previous = before && c.simTime < before.expiresAt ? before : null;
  if (c.readiness === 'ready' || c.readiness === 'fallback') {
    // A completed tap still flies once; the *current* hold determines glide.
    return { input: previous && !input.flapPressed ? { ...input, flapPressed: true } : input, pending: null };
  }
  const pending = input.flapPressed ? { expiresAt: c.simTime + PIGEON_TAKEOFF_VALID_SECONDS } : previous;
  return { input: pending ? { ...input, flapPressed: false, flapHeld: false } : input, pending };
}
