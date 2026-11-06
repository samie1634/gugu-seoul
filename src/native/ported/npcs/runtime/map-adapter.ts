import type { MapLayout, NavEdge } from '../../map/contracts.ts';
import { MAP_CONTRACT_VERSION } from '../../map/contracts.ts';
import { isSpawnClear, sampleGround, sejongRoad } from '../../map/layout.ts';
import { BOUNDS } from '../../../../simulation.ts';
import type { NpcNavigation, NpcRoute, Point2, SpawnZone } from '../src/contracts.ts';
import { createAabbNavigation } from './legacy-adapter.ts';
import { HARD_MAX_NPCS, NPC_KINDS, scaleProfiles } from '../src/profiles.ts';

export interface MapNpcAdapterOptions {
  readonly bodyScale?: number;
  readonly spawnRadius?: number;
  readonly zoneCapacity?: number;
}
export interface MapNpcAdapter {
  readonly navigation: NpcNavigation;
  /** Exact map-owned nominal lane contract, never the old reference 4-lane list. */
  readonly road: Readonly<{ width: number; minX: number; maxX: number; laneCentres: readonly number[] }>;
  readonly excludedEdges: readonly { readonly a: string; readonly b: string; readonly reason: 'traffic' | 'clearance' }[];
}

function projection(p: Point2, a: Point2, b: Point2): { distance: number; x: number; z: number } {
  const dx = b.x - a.x; const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq)) : 0;
  const x = a.x + dx * t; const z = a.z + dz * t;
  return { distance: Math.hypot(p.x - x, p.z - z), x, z };
}

/** Candidate-only bridge for the actual map v2 graph/ground/lane APIs. */
export function createMapNpcAdapter(layout: MapLayout, options: MapNpcAdapterOptions = {}): MapNpcAdapter {
  if (MAP_CONTRACT_VERSION !== 2) throw new Error('NPC adapter requires map contract v2');
  const profiles = scaleProfiles(options.bodyScale ?? 1);
  const spawnRadius = options.spawnRadius ?? 12;
  const zoneCapacity = options.zoneCapacity ?? 8;
  if (!Number.isFinite(spawnRadius) || spawnRadius <= 0 || !Number.isInteger(zoneCapacity)
    || zoneCapacity < 1 || zoneCapacity > HARD_MAX_NPCS) throw new RangeError('Invalid map NPC spawn options');
  const nodes = new Map(layout.navNodes.map(n => [n.id, n]));
  const routes: NpcRoute[] = [];
  const accepted: { route: NpcRoute; edge: NavEdge }[] = [];
  const excludedEdges: { a: string; b: string; reason: 'traffic' | 'clearance' }[] = [];
  const raw = createAabbNavigation({
    obstacles: layout.colliders, routes, spawnZones: [], bounds: BOUNDS,
    terrainAt(p, context, probe) {
      // Missing feet context at a bridge is ambiguous: fail closed.
      if (context?.referenceY === undefined || !probe) return undefined;
      const sample = sampleGround(layout, p.x, p.z, { feetY: context.referenceY,
        height: probe.height, maxStep: probe.maxStep ?? profiles[probe.kind].maxStep });
      // sampleGround calls asphalt walkable; traffic safety remains a separate
      // policy. No road/crossing is enabled by this adapter.
      if (!sample.walkable || sample.surface === 'water' || sample.surface === 'asphalt') return undefined;
      return { height: sample.y, walkable: true, surface: sample.surface, layerId: sample.zone };
    },
  });
  for (const edge of layout.navEdges) {
    if (edge.requiresTrafficCheck || edge.kind === 'crossing') {
      excludedEdges.push({ a: edge.a, b: edge.b, reason: 'traffic' }); continue;
    }
    const a = nodes.get(edge.a); const b = nodes.get(edge.b);
    if (!a || !b || !Number.isFinite(edge.width) || edge.width <= 0) {
      excludedEdges.push({ a: edge.a, b: edge.b, reason: 'clearance' }); continue;
    }
    const kinds = NPC_KINDS.filter(kind => {
      const probe = profiles[kind];
      return edge.width >= probe.radius * 2 + 0.06
        && raw.canTraverse(a, b, probe, { referenceY: a.y, layerId: a.zone });
    });
    if (!kinds.length) { excludedEdges.push({ a: edge.a, b: edge.b, reason: 'clearance' }); continue; }
    const route: NpcRoute = { id: `map-edge:${edge.a}->${edge.b}`, kinds, loop: false,
      points: [{ x: a.x, y: a.y, z: a.z, layerId: a.zone }, { x: b.x, y: b.y, z: b.z, layerId: b.zone }] };
    routes.push(route); accepted.push({ route, edge });
  }
  const spawnZones: SpawnZone[] = [];
  for (const spawn of layout.spawns) {
    const nearest = accepted.map(item => ({ ...item,
      distance: projection(spawn, item.route.points[0], item.route.points[1]).distance }))
      .filter(item => item.distance <= item.edge.width / 2)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) continue;
    const kinds = nearest.route.kinds.filter(kind => spawn.for.includes(kind)
      && spawn.clearance >= profiles[kind].radius
      && isSpawnClear(layout, spawn, profiles[kind].radius, profiles[kind].height));
    if (!kinds.length) continue;
    const ground = sampleGround(layout, spawn.x, spawn.z, { feetY: spawn.y });
    spawnZones.push({ id: `map-spawn:${spawn.id}`, routeId: nearest.route.id, kinds,
      center: { x: spawn.x, z: spawn.z }, radius: spawnRadius, capacity: zoneCapacity,
      referenceY: spawn.y, layerId: ground.zone });
  }
  const navigation: NpcNavigation = {
    routes, spawnZones,
    groundAt(p, probe, context) {
      // Keep local detours inside a validated nontraffic graph corridor.
      const inCorridor = accepted.some(({ route, edge }) => route.kinds.includes(probe.kind)
        && projection(p, route.points[0], route.points[1]).distance <= edge.width / 2 - probe.radius);
      return inCorridor ? raw.groundAt(p, probe, context) : undefined;
    },
    canTraverse(from, to, probe, context) {
      const slices = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1));
      let referenceY = from.y; let layerId = context?.layerId;
      for (let i = 0; i <= slices; i += 1) {
        const p = { x: from.x + (to.x - from.x) * i / slices, z: from.z + (to.z - from.z) * i / slices };
        const ground = navigation.groundAt(p, probe, { referenceY, layerId });
        if (!ground) return false;
        referenceY = ground.height; layerId = ground.layerId;
      }
      return raw.canTraverse(from, to, probe, context);
    },
  };
  const road = sejongRoad(layout);
  return { navigation, road: Object.freeze({ ...road, laneCentres: Object.freeze([...road.laneCentres]) }), excludedEdges };
}
