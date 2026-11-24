import type { MapLayout } from './ported/map/contracts.ts';
import { isSpawnClear, sampleGround } from './ported/map/layout.ts';
import type { BirdPoint } from './bird-behavior.ts';

/** One shared, existing player start. Food and approaching walkers use this anchor. */
export function feedingOrigin(layout: MapLayout): BirdPoint {
  const start = layout.realMap ? layout.spawns[0] : { x: -37, z: 8 };
  return { x: start.x, y: sampleGround(layout, start.x, start.z).y, z: start.z };
}

/** Validate the whole footprint, not only the centre, before authoring a walking path. */
export function feedingGroundAt(layout: MapLayout, x: number, z: number, radius = .2, height = .6, referenceY?: number): number | null {
  const ground = sampleGround(layout, x, z, { feetY: referenceY ?? 0, height, maxStep: .08 });
  if (!ground.walkable || ground.surface === 'water' || ground.surface === 'asphalt' ||
      !isSpawnClear(layout, { x, y: ground.y, z }, radius, height)) return null;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const edge = sampleGround(layout, x + Math.sin(angle) * radius, z + Math.cos(angle) * radius, { feetY: ground.y, height, maxStep: .08 });
    if (!edge.walkable || edge.surface === 'water' || edge.surface === 'asphalt' || Math.abs(edge.y - ground.y) > .08) return null;
  }
  return ground.y;
}

export function clearFeedingPath(layout: MapLayout, from: BirdPoint, to: BirdPoint, radius = .2, height = .6): boolean {
  const slices = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .2));
  let y = from.y;
  for (let i = 0; i <= slices; i++) {
    const fraction = i / slices;
    const next = feedingGroundAt(layout, from.x + (to.x - from.x) * fraction, from.z + (to.z - from.z) * fraction, radius, height, y);
    if (next === null || Math.abs(next - y) > .08) return false;
    y = next;
  }
  return Math.abs(y - to.y) <= .08;
}
