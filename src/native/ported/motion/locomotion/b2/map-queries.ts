import type { MapCollider, MapLayout, RoofSpec, WaterContact } from '../../../map/contracts.ts';
import {
  contains, queryRoofSupport, RIVER, RIVER_ENTRIES, roofHeight, roofNormal,
  ROOF_RENDER_SEGMENTS, sampleGround, sampleWater,
} from '../../../map/layout.ts';
import type { NativeBody, NativeQueryResult, NativeSupport, NativeSupportProbe, NativeSweepHit, NativeWorldQueries, Vec3 } from './contracts.ts';
import {
  face, overlaps, pointAt, segmentBounds, sweepBodyBox, sweepEllipsoidFace, sweepSphereBox,
  sweepSphereFace, type Box, type Contact, type Face,
} from './collision.ts';

export interface MapNativeQueries extends NativeWorldQueries {
  waterAt(feet: Vec3): NativeQueryResult<WaterContact>;
}

interface Solid {
  id: string;
  layerId?: string;
  box: Box;
}

interface FootRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface TerrainPatch extends FootRect {
  id: string;
  y: number;
  slopeZ: number;
  depth: number;
  surface: string;
  walkable: boolean;
}

interface RoofFaces {
  roof: RoofSpec;
  box: Box;
  cells: readonly (readonly [Face, Face])[];
}

const UP = { x: 0, y: 1, z: 0 };
const EPS = 1e-7;
const DOMAIN = 1500;
const MAX_SEGMENT = 96;
const MAX_RADIUS = 10;
const RAMP_START = 382;
const RAMP_END = 405;
const RAMP_HALF_WIDTH = 2.8;

function validPosition(v: Vec3): boolean {
  return !!v && [v.x, v.y, v.z].every(n => Number.isFinite(n) && Math.abs(n) <= DOMAIN);
}

function validSegment(a: Vec3, b: Vec3): boolean {
  return validPosition(a) && validPosition(b) && Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) <= MAX_SEGMENT;
}

function validRadius(radius: number): boolean {
  return Number.isFinite(radius) && radius >= 0.001 && radius <= MAX_RADIUS;
}

function validBody(body: NativeBody): boolean {
  return !!body && validRadius(body.horizontalRadiusM) && Number.isFinite(body.heightM) &&
    Number.isFinite(body.centreToSoleM) && body.centreToSoleM > 0 &&
    body.heightM - body.centreToSoleM >= 0.001 && body.heightM <= 2 * MAX_RADIUS &&
    Number.isFinite(body.footSupportRadiusM) && body.footSupportRadiusM >= 0 &&
    body.footSupportRadiusM <= MAX_RADIUS && validPosition(body.eyeFromSoleM);
}

function makeBox(id: string, x: number, z: number, width: number, depth: number, minY: number, maxY: number, layerId?: string): Solid {
  if (![x, z, width, depth, minY, maxY].every(Number.isFinite) || width <= 0 || depth <= 0 || minY >= maxY) {
    throw new RangeError('Invalid collider ' + id);
  }
  return {
    id, layerId, box: {
      min: { x: x - width / 2, y: minY, z: z - depth / 2 },
      max: { x: x + width / 2, y: maxY, z: z + depth / 2 },
    },
  };
}

function boxFromCollider(collider: MapCollider): Solid {
  return makeBox(collider.id, collider.x, collider.z, collider.width, collider.depth,
    collider.minY ?? 0, collider.height, collider.id);
}

function inRect(r: FootRect, x: number, z: number): boolean {
  return x >= r.minX - EPS && x <= r.maxX + EPS && z >= r.minZ - EPS && z <= r.maxZ + EPS;
}

function terrainPatches(layout: MapLayout): TerrainPatch[] {
  const { minX, maxX, excavationMinZ: north, excavationMaxZ: south } = RIVER;
  const patches: TerrainPatch[] = [];
  const floor = (x0: number, x1: number, z0: number, z1: number) => patches.push({
    id: 'terrain:street', minX: x0, maxX: x1, minZ: z0, maxZ: z1,
    y: 0, slopeZ: 0, depth: 3, surface: 'stone', walkable: true,
  });
  floor(-DOMAIN, minX, -DOMAIN, DOMAIN);
  floor(maxX, DOMAIN, -DOMAIN, DOMAIN);
  floor(minX, maxX, -DOMAIN, RAMP_START);
  floor(minX, maxX, south, DOMAIN);
  let west: number = minX;
  for (const x of RIVER_ENTRIES) {
    floor(west, x - RAMP_HALF_WIDTH, RAMP_START, north);
    west = x + RAMP_HALF_WIDTH;
    patches.push({
      id: 'terrain:ramp:' + x, minX: x - RAMP_HALF_WIDTH, maxX: west, minZ: RAMP_START, maxZ: RAMP_END,
      y: 0, slopeZ: layout.promenadeY / (RAMP_END - RAMP_START), depth: 0, surface: 'stone', walkable: true,
    });
  }
  floor(west, maxX, RAMP_START, north);
  patches.push(
    { id: 'terrain:promenade:north', minX, maxX, minZ: north, maxZ: RIVER.minZ,
      y: layout.promenadeY, slopeZ: 0, depth: 0.26, surface: 'stone', walkable: true },
    { id: 'terrain:promenade:south', minX, maxX, minZ: RIVER.maxZ, maxZ: south,
      y: layout.promenadeY, slopeZ: 0, depth: 0.26, surface: 'stone', walkable: true },
    { id: 'terrain:riverbed', minX, maxX, minZ: north, maxZ: south,
      y: layout.water.bedY, slopeZ: 0, depth: 0.24, surface: 'soil', walkable: false },
  );
  return patches;
}

function heightAt(patch: TerrainPatch, z: number): number {
  return patch.y + (z - patch.minZ) * patch.slopeZ;
}

function terrainFaces(patch: TerrainPatch): [Face, Face] {
  const a = { x: patch.minX, y: heightAt(patch, patch.minZ), z: patch.minZ };
  const b = { x: patch.maxX, y: a.y, z: a.z };
  const c = { x: a.x, y: heightAt(patch, patch.maxZ), z: patch.maxZ };
  const d = { x: b.x, y: c.y, z: c.z };
  return [face(a, c, b), face(b, c, d)];
}

function roofFaces(roof: RoofSpec): RoofFaces {
  const n = ROOF_RENDER_SEGMENTS;
  const grid = Array.from({ length: (n + 1) ** 2 }, (_, index) => {
    const u = (index % (n + 1)) / n * 2 - 1;
    const v = Math.floor(index / (n + 1)) / n * 2 - 1;
    return { x: roof.x + u * roof.width / 2, y: roofHeight(roof, u, v), z: roof.z + v * roof.depth / 2 };
  });
  const cells: [Face, Face][] = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      cells.push([face(grid[a], grid[c], grid[b]), face(grid[b], grid[c], grid[d])]);
    }
  }
  const heights = grid.map(point => point.y);
  const box = makeBox(roof.id, roof.x, roof.z, roof.width, roof.depth,
    Math.min(...heights) - EPS, Math.max(...heights) + EPS).box;
  return { roof, box, cells };
}

function* nearbyFaces(roof: RoofFaces, swept: Box): Generator<Face> {
  if (!overlaps(roof.box, swept)) return;
  const n = ROOF_RENDER_SEGMENTS;
  const cell = (axis: 'x' | 'z', value: number) => Math.max(0, Math.min(n - 1,
    Math.floor(n * (value - roof.box.min[axis]) / (roof.box.max[axis] - roof.box.min[axis]))));
  const firstX = cell('x', swept.min.x - EPS);
  const lastX = cell('x', swept.max.x + EPS);
  const firstZ = cell('z', swept.min.z - EPS);
  const lastZ = cell('z', swept.max.z + EPS);
  for (let j = firstZ; j <= lastZ; j += 1) {
    for (let i = firstX; i <= lastX; i += 1) yield* roof.cells[j * n + i];
  }
}

function roofFixtures(roof: RoofSpec): Solid[] {
  const solids = [
    makeBox(roof.id + ':ridge', roof.x, roof.z, roof.width * 0.58, 0.7,
      roof.y + roof.rise, roof.y + roof.rise + 0.32, roof.id),
  ];
  for (const side of [-1, 1]) {
    solids.push(
      makeBox(roof.id + ':eave:' + side, roof.x, roof.z + side * roof.depth / 2,
        roof.width, 0.38, roof.y, roof.y + 0.28),
      makeBox(roof.id + ':beam:' + side, roof.x, roof.z + side * (roof.depth / 2 - 1.2),
        roof.width * 0.95, 0.4, roof.y - 0.31, roof.y + 0.01),
    );
    for (let x = roof.x - roof.width * 0.43, i = 0; x < roof.x + roof.width * 0.44; x += 2.5, i += 1) {
      solids.push(makeBox(roof.id + ':rafter:' + side + ':' + i, x, roof.z + side * (roof.depth / 2 - 2),
        0.8, 1.8, roof.y - 0.725, roof.y - 0.175));
    }
  }
  return solids;
}

function benchSlats(seat: MapCollider): Solid[] {
  return Array.from({ length: 4 }, (_, i) => makeBox(seat.id + ':slat:' + i,
    seat.x, seat.z - 0.33 + i * 0.22, seat.width, 0.18, seat.height - 0.16, seat.height, seat.id));
}

function bridgeRails(rail: MapCollider): Solid[] {
  const solids = [makeBox(rail.id + ':bar', rail.x, rail.z, rail.width, rail.depth, 0.94, rail.height)];
  for (let z = rail.z - rail.depth / 2 + 0.6, i = 0; z < rail.z + rail.depth / 2; z += 3.2, i += 1) {
    solids.push(makeBox(rail.id + ':post:' + i, rail.x, z, 0.13, 0.13, 0, 1.04));
  }
  return solids;
}

// Partition the disk's bounding square at nearby sheet edges. Each open cell is wholly
// covered or uncovered; distance to an uncovered cell determines whether the disk fits.
function diskCovered(x: number, z: number, radius: number, regions: readonly FootRect[]): boolean {
  if (radius <= EPS) return regions.some(r => inRect(r, x, z));
  if (regions.some(r => inRect(r, x - radius, z - radius) && inRect(r, x + radius, z + radius))) return true;
  const edges = (centre: number, low: 'minX' | 'minZ', high: 'maxX' | 'maxZ') =>
    [centre - radius, centre + radius, ...regions.flatMap(r => [r[low], r[high]])
      .filter(v => v > centre - radius && v < centre + radius)].sort((a, b) => a - b);
  const xs = edges(x, 'minX', 'maxX');
  const zs = edges(z, 'minZ', 'maxZ');
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i] === xs[i - 1]) continue;
    const dx = Math.max(0, xs[i - 1] - x, x - xs[i]);
    for (let j = 1; j < zs.length; j += 1) {
      if (zs[j] === zs[j - 1]) continue;
      const dz = Math.max(0, zs[j - 1] - z, z - zs[j]);
      if (Math.hypot(dx, dz) >= radius - EPS) continue;
      if (!regions.some(r => inRect(r, (xs[i] + xs[i - 1]) / 2, (zs[j] + zs[j - 1]) / 2))) return false;
    }
  }
  return true;
}

function selectSupport(current: NativeSupport | null, candidate: NativeSupport, layerId: string | undefined): NativeSupport {
  if (!current || candidate.height > current.height + EPS) return candidate;
  if (Math.abs(candidate.height - current.height) <= EPS &&
      candidate.layerId === layerId && current.layerId !== layerId) return candidate;
  return current;
}

export function createMapQueries(layout: Readonly<MapLayout>): MapNativeQueries {
  if (!Number.isFinite(layout.promenadeY) || !Number.isFinite(layout.water.bedY) ||
      !Number.isFinite(layout.water.y)) throw new RangeError('Invalid map terrain heights');

  const terrain = terrainPatches(layout);
  const ramps = terrain.filter(patch => patch.depth === 0)
    .map(patch => ({ id: patch.id, faces: terrainFaces(patch) }));
  const roofs = layout.roofs.map(roofFaces);
  const slats = new Map<string, Solid[]>();
  const solids: Solid[] = [];
  for (const c of layout.colliders) {
    if (c.kind === 'roof') continue;
    if (c.id.startsWith('bench:') && c.id.endsWith(':seat')) {
      const pieces = benchSlats(c);
      slats.set(c.id, pieces);
      solids.push(...pieces);
      solids.push(...[-1, 1].map(side => makeBox(c.id + ':leg:' + side, c.x + side, c.z, 0.12, 0.65, 0, c.height - 0.16)));
    } else if (/^bridge:\d+:rail:/.test(c.id)) {
      solids.push(...bridgeRails(c));
    } else {
      solids.push(boxFromCollider(c));
    }
  }
  for (const p of terrain) {
    if (p.depth > 0) solids.push(makeBox(p.id, (p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2,
      p.maxX - p.minX, p.maxZ - p.minZ, p.y - p.depth, p.y, p.id));
  }
  for (const roof of layout.roofs) solids.push(...roofFixtures(roof));
  // Solid cut faces at the wet edge of the promenade. The water volume is queried separately.
  for (const side of [-1, 1]) {
    if (layout.promenadeY > layout.water.bedY) solids.push(makeBox('terrain:bank:' + side,
      (RIVER.minX + RIVER.maxX) / 2, (RIVER.minZ + RIVER.maxZ) / 2 + side * 9.2,
      RIVER.maxX - RIVER.minX, 0.4, layout.water.bedY, layout.promenadeY));
  }

  const flatSurfaces = layout.landingSurfaces.filter(surface => surface.approximation === 0 && !/^bridge:\d+:rail:/.test(surface.id));

  function supportAt(probe: NativeSupportProbe): NativeQueryResult<NativeSupport> {
    if (!probe || !validPosition(probe.at) ||
        ![probe.previousFeetY, probe.footRadiusM, probe.heightM, probe.maxRiseM, probe.maxDropM].every(Number.isFinite) ||
        probe.footRadiusM < 0 || probe.footRadiusM > MAX_RADIUS || probe.heightM <= 0 ||
        probe.maxRiseM < 0 || probe.maxDropM < 0) return undefined;

    const { at, previousFeetY, maxRiseM, maxDropM, footRadiusM, layerId } = probe;
    const top = previousFeetY + maxRiseM;
    const bottom = Math.min(previousFeetY, at.y) - maxDropM;
    if (![top, bottom].every(Number.isFinite)) return undefined;
    const within = (y: number) => y >= bottom - EPS && y <= top + EPS;
    const ground = sampleGround(layout, at.x, at.z, { feetY: previousFeetY, maxStep: maxRiseM, height: probe.heightM });
    if (!ground || !Number.isFinite(ground.y) || typeof ground.walkable !== 'boolean' || !ground.surface) return undefined;
    let best: NativeSupport | null = null;
    for (const p of terrain) {
      if (!inRect(p, at.x, at.z)) continue;
      const y = heightAt(p, at.z);
      if (!within(y)) continue;
      const compatible = terrain.filter(q => {
        if (q.walkable !== p.walkable || !inRect({
          minX: q.minX - footRadiusM, maxX: q.maxX + footRadiusM,
          minZ: q.minZ - footRadiusM, maxZ: q.maxZ + footRadiusM,
        }, at.x, at.z)) return false;
        const seamZ = Math.max(q.minZ, Math.min(q.maxZ, at.z));
        const slope = Math.max(Math.abs(p.slopeZ), Math.abs(q.slopeZ));
        return Math.abs(heightAt(q, seamZ) - y) <= slope * Math.abs(seamZ - at.z) + EPS ||
          Math.abs(heightAt(q, at.z) - y) <= EPS;
      });
      if (!diskCovered(at.x, at.z, footRadiusM, compatible)) continue;
      const normalLength = Math.hypot(1, p.slopeZ);
      const surface = p.walkable && ground.walkable && Math.abs(ground.y - y) <= EPS ? ground.surface : p.surface;
      best = selectSupport(best, {
        id: p.id, layerId: p.id, height: y, normal: { x: 0, y: 1 / normalLength, z: -p.slopeZ / normalLength },
        surface, walkable: p.walkable, landable: p.walkable,
      }, layerId);
    }
    for (const surface of flatSurfaces) {
      if (!within(surface.y) || footRadiusM > surface.maxFootRadius || !contains(surface, at.x, at.z, -footRadiusM)) continue;
      const pieces = slats.get(surface.id);
      if (pieces && !pieces.some(({ box }) => inRect({
        minX: box.min.x + footRadiusM, maxX: box.max.x - footRadiusM,
        minZ: box.min.z + footRadiusM, maxZ: box.max.z - footRadiusM,
      }, at.x, at.z))) continue;
      best = selectSupport(best, {
        id: surface.id, layerId: surface.id, height: surface.y, normal: UP, surface: surface.surface,
        walkable: true, landable: true,
      }, layerId);
    }
    const support = queryRoofSupport(layout, at.x, at.z, footRadiusM, top + EPS);
    if (support) {
      const roof = layout.roofs.find(roof => roof.id === support.id);
      if (!roof || !Number.isFinite(support.y)) return undefined;
      if (within(support.y)) {
        const normal = roofNormal(roof, at.x, at.z);
        best = selectSupport(best, {
          id: support.id, layerId: support.id, height: support.y, normal, surface: support.surface,
          walkable: normal.y >= 0.55, landable: normal.y >= 0.25,
        }, layerId);
      }
    }
    return best;
  }

  function sweep(from: Vec3, to: Vec3, shape: number | NativeBody): NativeQueryResult<NativeSweepHit> {
    if (!validSegment(from, to)) return undefined;
    const body = typeof shape === 'number' ? undefined : shape;
    const radius = typeof shape === 'number' ? shape : shape.horizontalRadiusM;
    if (!validRadius(radius) || (body && !validBody(body))) return undefined;
    const below = body?.centreToSoleM ?? radius;
    const above = body ? body.heightM - below : radius;
    const swept = segmentBounds(from, to, radius, below, above);
    let best: NativeSweepHit | null = null;
    const consider = (hit: NativeQueryResult<Contact>, colliderId: string, layerId?: string) => {
      if (hit && (!best || hit.fraction < best.fraction - EPS ||
          (Math.abs(hit.fraction - best.fraction) <= EPS && hit.normal.y > best.normal.y))) {
        best = { ...hit, point: pointAt(from, to, hit.fraction), colliderId, layerId };
      }
      return hit !== undefined;
    };

    for (const solid of solids) {
      if (!overlaps(swept, solid.box)) continue;
      const hit = body ? sweepBodyBox(from, to, body, solid.box) : sweepSphereBox(from, to, radius, solid.box);
      if (!consider(hit, solid.id, solid.layerId)) return undefined;
    }
    for (const ramp of ramps) {
      for (const panel of ramp.faces) {
        if (!overlaps(swept, panel.bounds)) continue;
        const hit = body ? sweepEllipsoidFace(from, to, body, panel) : sweepSphereFace(from, to, radius, panel);
        if (!consider(hit, ramp.id, ramp.id)) return undefined;
      }
    }
    for (const patch of roofs) {
      if (!overlaps(swept, patch.box)) continue;
      const roof = patch.roof;
      for (const panel of nearbyFaces(patch, swept)) {
        if (!overlaps(swept, panel.bounds)) continue;
        const hit = body ? sweepEllipsoidFace(from, to, body, panel) : sweepSphereFace(from, to, radius, panel);
        if (!consider(hit, roof.id, roof.id)) return undefined;
      }
    }
    return best;
  }

  return Object.freeze({
    supportAt,
    sweepBody: (from: Vec3, to: Vec3, body: NativeBody) => validBody(body) ? sweep(from, to, body) : undefined,
    sphereClear: (center: Vec3, radius: number) => {
      if (!validRadius(radius)) return undefined;
      const hit = sweep(center, center, radius);
      return hit === undefined ? undefined : hit === null;
    },
    sweepSphere: (from: Vec3, to: Vec3, radius: number) => validRadius(radius) ? sweep(from, to, radius) : undefined,
    waterAt: (feet: Vec3) => validPosition(feet) ? sampleWater(layout, feet.x, feet.y, feet.z) : undefined,
  });
}
