import type { GroundContext, GroundSample, NpcNavigation, NpcRoute, Point2, Point3, Probe, SpawnZone } from '../src/contracts.ts';
import { PROFILES } from '../src/profiles.ts';

/** Structural match for current src/simulation.ts Obstacle; no root imports. */
export interface LegacyObstacle {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  /** Absolute top Y, not thickness (also when minY is present). */
  readonly height: number;
  readonly minY?: number;
}
export interface AabbNavigationInput {
  readonly obstacles: readonly LegacyObstacle[];
  readonly routes: readonly NpcRoute[];
  readonly spawnZones: readonly SpawnZone[];
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Required: map decides road/water/step/walkability. Never inferred from Y=0. */
  terrainAt(point: Point2, context?: GroundContext, probe?: Probe): GroundSample | undefined;
}

const EPSILON = 1e-6;
function horizontalHit(from: Point2, to: Point2, b: LegacyObstacle, radius: number): boolean {
  let entry = 0; let exit = 1;
  const axes = [
    [from.x, to.x - from.x, b.x - b.width / 2 - radius, b.x + b.width / 2 + radius],
    [from.z, to.z - from.z, b.z - b.depth / 2 - radius, b.z + b.depth / 2 + radius],
  ];
  for (const [origin, direction, min, max] of axes) {
    if (Math.abs(direction) < EPSILON) { if (origin <= min || origin >= max) return false; continue; }
    const t1 = (min - origin) / direction; const t2 = (max - origin) / direction;
    entry = Math.max(entry, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (entry > exit) return false;
  }
  return true;
}

/** Conservative swept-cylinder/AABB bridge for the existing obstacle shape. */
export function createAabbNavigation(input: AabbNavigationInput): NpcNavigation {
  const clear = (from: Point3, to: Point3, probe: Probe): boolean => {
    const minX = Math.min(from.x, to.x) - probe.radius;
    const maxX = Math.max(from.x, to.x) + probe.radius;
    const minZ = Math.min(from.z, to.z) - probe.radius;
    const maxZ = Math.max(from.z, to.z) + probe.radius;
    for (const obstacle of input.obstacles) {
      // Allocation-free broad phase; read live coordinates each call so moving
      // blockers remain correct without invalidating a static spatial cache.
      if (obstacle.x + obstacle.width / 2 <= minX || obstacle.x - obstacle.width / 2 >= maxX
        || obstacle.z + obstacle.depth / 2 <= minZ || obstacle.z - obstacle.depth / 2 >= maxZ) continue;
      const bottom = obstacle.minY ?? 0;
      if (Math.min(from.y, to.y) >= obstacle.height - EPSILON
        || Math.max(from.y, to.y) + probe.height <= bottom + EPSILON) continue;
      if (horizontalHit(from, to, obstacle, probe.radius)) return false;
    }
    return true;
  };
  const groundAt = (p: Point2, probe: Probe, context?: GroundContext): GroundSample | undefined => {
    const b = input.bounds;
    if (p.x - probe.radius < b.minX || p.x + probe.radius > b.maxX
      || p.z - probe.radius < b.minZ || p.z + probe.radius > b.maxZ) return undefined;
    const center = input.terrainAt(p, context, probe);
    if (!center?.walkable || center.surface === 'water' || !Number.isFinite(center.height)) return undefined;
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      const edge = input.terrainAt({ x: p.x + Math.cos(angle) * probe.radius, z: p.z + Math.sin(angle) * probe.radius }, context, probe);
      if (!edge?.walkable || edge.surface === 'water' || !Number.isFinite(edge.height)
        || Math.abs(edge.height - center.height) > (probe.maxStep ?? PROFILES[probe.kind].maxStep)) return undefined;
    }
    const feet = { x: p.x, y: center.height, z: p.z };
    return clear(feet, feet, probe) ? center : undefined;
  };
  return {
    routes: input.routes,
    spawnZones: input.spawnZones,
    groundAt,
    canTraverse(from: Point3, to: Point3, probe: Probe, context?: GroundContext): boolean {
      if (![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite) || !clear(from, to, probe)) return false;
      const slices = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.10));
      let previousHeight = from.y;
      let layerId = context?.layerId;
      for (let i = 0; i <= slices; i += 1) {
        const sample = groundAt({ x: from.x + (to.x - from.x) * i / slices, z: from.z + (to.z - from.z) * i / slices }, probe,
          { referenceY: previousHeight, layerId });
        if (!sample || Math.abs(sample.height - previousHeight) > (probe.maxStep ?? PROFILES[probe.kind].maxStep)) return false;
        previousHeight = sample.height;
        layerId = sample.layerId ?? layerId;
      }
      return Math.abs(previousHeight - to.y) <= EPSILON;
    },
  };
}
