import { resetFrameClock, stepFrameClock, type FrameClock } from '../frame-clock.ts';
import type { Controls } from '../input.ts';
import type { FlightInput } from '../simulation.ts';

export type PreparedNativeFrame =
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'ready'; isCurrent(): boolean; commit(): void };

export interface TransactionTick {
  readonly clock: FrameClock;
  readonly playing: boolean;
  readonly rawSeconds: number;
  readonly acceptedSeconds: number;
  readonly status: 'idle' | 'committed' | 'blocked';
  readonly reason?: string;
}

/** One pure clock proposal and one input owner. Failed space never consumes time/edges. */
export function transactNativeFrame(
  clock: FrameClock, timestampMs: number, controls: Pick<Controls, 'preview'>,
  prepare: (input: Readonly<FlightInput>, seconds: number) => PreparedNativeFrame,
  clockIsCurrent: () => boolean = () => true,
): TransactionTick {
  const proposal = stepFrameClock(clock, timestampMs);
  if (proposal.acceptedSeconds <= 0) return { ...proposal, status: 'idle' };
  const ticket = controls.preview();
  let frame: PreparedNativeFrame;
  try { frame = prepare(ticket.input, proposal.acceptedSeconds); }
  catch { frame = { kind: 'blocked', reason: 'prepare-exception' }; }
  const reject = (reason: string): TransactionTick => ({
    ...proposal, clock: resetFrameClock(clock), acceptedSeconds: 0, status: 'blocked', reason,
  });
  if (frame.kind === 'blocked') return reject(frame.reason);
  if (!clockIsCurrent() || !ticket.isCurrent() || !frame.isCurrent()) return reject('stale-proposal');
  // Both commits below are synchronous, validated assignments with no callbacks.
  if (!ticket.commit()) return reject('stale-input');
  frame.commit();
  return { ...proposal, status: 'committed' };
}
