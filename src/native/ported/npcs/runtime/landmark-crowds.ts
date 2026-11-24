import type { MapLayout } from '../../map/contracts.ts';
import { isSpawnClear, sampleGround } from '../../map/layout.ts';
import { realMapData } from '../../map/real-map/data.ts';
import type { NpcNavigation, NpcRoute, Point3, Probe, SpawnZone } from '../src/contracts.ts';

/** Short gathering walks on the existing plaza and inside the mapped palace courts. */
export function landmarkCrowdWalks(layout: MapLayout, navigation: NpcNavigation, probe: Probe) {
  const result: { route: NpcRoute; zone: SpawnZone; width: number }[] = [];
  // These coordinates belong to this source map, never a procedural/test map.
  if (layout.realMap !== realMapData) return result;
  const candidates: { area: 'plaza' | 'palace'; x: number; z: number; vertical: boolean }[] = [];
  for (const z of [170, 108, 65, 0, -80, -160, -235, -290]) {
    for (const x of [-348, -330]) candidates.push({ area: 'plaza', x, z, vertical: false });
  }
  // South of Heungnyemun: keep visitors on the narrow central pedestrian strip.
  for (const z of [-358, -385, -414]) {
    for (const x of [-322, -318]) candidates.push({ area: 'palace', x, z, vertical: true });
  }
  // The inner court is included in the source extent; do not invent the palace beyond it.
  for (const z of [-460, -482, -503]) {
    for (const x of [-347, -331, -317]) candidates.push({ area: 'palace', x, z, vertical: true });
  }
  for (const [i, candidate] of candidates.entries()) {
    const { area, x, z, vertical } = candidate, half = 5;
    const a: Point3 = { x: x - (vertical ? 0 : half), y: 0, z: z - (vertical ? half : 0) };
    const b: Point3 = { x: x + (vertical ? 0 : half), y: 0, z: z + (vertical ? half : 0) };
    const width = 2.6;
    let clear = true;
    // Validate the entire walking corridor, including lateral clearance and motor-road edges.
    for (let j = 0; j <= 20 && clear; j++) {
      for (const lateral of [-width / 2, 0, width / 2]) {
        const p = { x: a.x + (b.x - a.x) * j / 20 + (vertical ? lateral : 0), y: 0,
          z: a.z + (b.z - a.z) * j / 20 + (vertical ? 0 : lateral) };
        const ground = sampleGround(layout, p.x, p.z, { feetY: 0 });
        if (!ground.walkable || ground.surface === 'water' || ground.surface === 'asphalt' ||
            !isSpawnClear(layout, p, probe.radius, probe.height)) { clear = false; break; }
      }
    }
    if (!clear || !navigation.canTraverse(a, b, probe, { referenceY: 0 })) continue;
    const id = `landmark-crowd:${area}:${i}`;
    const route: NpcRoute = { id, kinds: ['human'], points: [a, b], loop: false,
      ...(area === 'palace' ? { humanOutfit: 'hanbok' as const } : {}) };
    result.push({ route, width, zone: { id: `${id}:spawn`, routeId: id, kinds: ['human'],
      center: { x, z }, radius: 6, capacity: 4, referenceY: 0, minObserverDistance: 6, priorityDistance: 85 } });
  }
  return result;
}
