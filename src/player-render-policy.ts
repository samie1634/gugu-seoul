import type { LookId } from './progress.ts';

/** The native rig remains the measured actor; it cannot be drawn for the default gray pigeon. */
export function showProceduralLocalPlayer(look: LookId|null, firstPerson: boolean, ground: boolean, flight: boolean): boolean {
  return look !== 'pigeon' && !firstPerson && !ground && !flight;
}

type RuntimeVisual = {
  root: { removeFromParent(): unknown };
  snapshot(): { loadState: string };
};

/** The existing Home action can recover a failed load without restoring the old avatar or adding UI. */
export function retryFailedLocalVisual<T extends RuntimeVisual>(current: T, create: () => T): T {
  if (current.snapshot().loadState !== 'fallback') return current;
  const next = create();
  current.root.removeFromParent();
  return next;
}
