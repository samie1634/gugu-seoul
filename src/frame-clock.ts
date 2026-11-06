import type { FrameContext } from './contracts.ts';

export interface PlayGate {
  /** Gameplay has started and is usable; independent of transient pause reasons. */
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly dialogOpen: boolean;
  readonly hidden: boolean;
  readonly focused: boolean;
}

export const INACTIVE_PLAY_GATE: PlayGate = Object.freeze({
  enabled: false, paused: false, dialogOpen: false, hidden: false, focused: false,
});

export function isPlaying(gate: PlayGate): boolean {
  return gate.enabled && gate.focused && !gate.hidden && !gate.paused && !gate.dialogOpen;
}

export const MAX_RAW_FRAME_SECONDS = 0.25;

/** Same per-frame budget as advanceBird. Stalled time above this is discarded. */
export const MAX_SIMULATION_DT = 0.1;

export interface FrameClock {
  readonly gate: PlayGate;
  readonly previousTimestampMs: number | null;
  /** Seconds actually handed to simulation in this session. */
  readonly activeSeconds: number;
}

export interface FrameStep extends Pick<FrameContext, 'rawSeconds' | 'acceptedSeconds' | 'playing'> {
  readonly clock: FrameClock;
}

export function createFrameClock(gate: PlayGate = INACTIVE_PLAY_GATE): FrameClock {
  return { gate: { ...gate }, previousTimestampMs: null, activeSeconds: 0 };
}

/** Break the timestamp chain without changing the elapsed play time. */
export function resetFrameClock(clock: FrameClock): FrameClock {
  return clock.previousTimestampMs === null ? clock : { ...clock, previousTimestampMs: null };
}

/** Apply lifecycle events immediately, including transitions between two RAF callbacks. */
export function setFrameClockGate(clock: FrameClock, gate: PlayGate): FrameClock {
  const previousTimestampMs = isPlaying(clock.gate) && isPlaying(gate) ? clock.previousTimestampMs : null;
  return { ...clock, gate: { ...gate }, previousTimestampMs };
}

export function stepFrameClock(clock: FrameClock, timestampMs: number): FrameStep {
  const playing = isPlaying(clock.gate);
  const idle = (clock: FrameClock): FrameStep => ({ clock, playing, rawSeconds: 0, acceptedSeconds: 0 });
  if (!playing || !Number.isFinite(timestampMs)) return idle(resetFrameClock(clock));
  const previous = clock.previousTimestampMs;
  if (previous === null) return idle({ ...clock, previousTimestampMs: timestampMs });
  if (timestampMs <= previous) return idle(clock);
  const rawSeconds = Math.min(MAX_RAW_FRAME_SECONDS, (timestampMs - previous) / 1000);
  const acceptedSeconds = Math.min(MAX_SIMULATION_DT, rawSeconds);
  return {
    clock: { ...clock, previousTimestampMs: timestampMs, activeSeconds: clock.activeSeconds + acceptedSeconds },
    playing, rawSeconds, acceptedSeconds,
  };
}
