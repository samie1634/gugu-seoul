/** Shared frame type adopted for input/time integration only. */
export interface FrameContext {
  readonly contractVersion: 1;
  readonly frame: number;
  readonly simTime: number; // cumulative acceptedSeconds, not AudioContext.currentTime
  readonly rawSeconds: number; // finite, capped to .25 before acceptance
  readonly acceptedSeconds: number; // <= .1; same value for physics, progress, world, pose, NPC
  readonly playing: boolean;
  readonly quality: 'desktop' | 'mobile';
  readonly reducedMotion: boolean;
}
