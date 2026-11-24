import * as THREE from 'three';
import { Painter } from '../geometry.ts';
import type { MapLayout } from './ported/map/contracts.ts';
import type { RealMapData } from './ported/map/real-map/types.ts';
import { diskIntersects, footprintIndex, polygonContains } from './ported/map/real-map/geometry.ts';
import { roadTrafficRules } from './road-traffic-rules.ts';

type Point = { x: number; z: number };
type Pose = Point & { heading: number };
type Sample = Pose & { distance: number };
type Rules = Readonly<Record<string, Readonly<Record<string, string>>>>;
export interface TrafficLane {
  id: string; roadId: string; sourceId: string; bridge: boolean; layer: number;
  points: Sample[]; length: number; start: Point | null; end: Point | null;
  circulating: boolean; next: { lane: number; points: Sample[]; length: number }[];
}
export interface TrafficState extends Pose { id: string; x: number; y: number; z: number; visible: boolean; speed: number; roadId: string }
const motorRoads = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'service', 'living_street']);
const restricted = new Set(['no', 'private', 'delivery', 'destination', 'customers', 'agricultural', 'forestry', 'permit']);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const direction = (a: Point, b: Point): Point => { const d = distance(a, b) || 1; return { x: (b.x - a.x) / d, z: (b.z - a.z) / d }; };
const along = (p: Point, d: Point, length: number): Point => ({ x: p.x + d.x * length, z: p.z + d.z * length });
const facing = (heading: number): Point => ({ x: Math.sin(heading), z: Math.cos(heading) });
const nodeKey = (p: Point) => `${p.x.toFixed(3)}:${p.z.toFixed(3)}`;

function samplePath(points: Point[]): Sample[] {
  const result: Sample[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i) { const d = distance(points[i - 1], points[i]); if (d < 1e-6) continue; total += d; }
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    result.push({ ...points[i], heading: Math.atan2(b.x - a.x, b.z - a.z), distance: total });
  }
  return result;
}
function lineTo(points: Point[], end: Point) {
  const start = points[points.length - 1], count = Math.max(1, Math.ceil(distance(start, end) * 2));
  for (let i = 1; i <= count; i++) points.push(lerp(start, end, i / count));
}
function lanePath(line: Point[], offset: number): Sample[] {
  const shifted = line.map((p, i) => {
    const a = direction(line[Math.max(0, i - 1)], p), b = direction(p, line[Math.min(line.length - 1, i + 1)]);
    const d = i === 0 ? b : i === line.length - 1 ? a : direction({ x: 0, z: 0 }, { x: a.x + b.x, z: a.z + b.z });
    const scale = offset / Math.max(.75, i === 0 ? 1 : d.x * a.x + d.z * a.z);
    return { x: p.x - d.z * scale, z: p.z + d.x * scale };
  });
  // Reserve a few metres at source endpoints for tangent-continuous junctions.
  shifted[0] = along(shifted[0], direction(shifted[0], shifted[1]), Math.min(3, distance(shifted[0], shifted[1]) * .25));
  const last = shifted.length - 1;
  shifted[last] = along(shifted[last], direction(shifted[last], shifted[last - 1]), Math.min(3, distance(shifted[last], shifted[last - 1]) * .25));
  const points = [shifted[0]];
  for (let i = 1; i < last; i++) {
    const p = shifted[i], previous = shifted[i - 1], next = shifted[i + 1];
    const trim = Math.min(5, distance(previous, p) * .35, distance(p, next) * .35);
    const a = along(p, direction(p, previous), trim), b = along(p, direction(p, next), trim);
    lineTo(points, a);
    const count = Math.max(2, Math.ceil((distance(a, p) + distance(p, b)) * 2));
    for (let j = 1; j <= count; j++) { const t = j / count; points.push(lerp(lerp(a, p, t), lerp(p, b, t), t)); }
  }
  lineTo(points, shifted[last]);
  return samplePath(points);
}
function connector(a: Sample, b: Sample): Sample[] {
  const length = distance(a, b), reach = Math.min(6, length * .5), p = along(a, facing(a.heading), reach), q = along(b, facing(b.heading), -reach);
  const points: Point[] = [];
  for (let j = 0, n = Math.max(4, Math.ceil(length * 2)); j <= n; j++) {
    const t = j / n; points.push(lerp(lerp(lerp(a, p, t), lerp(p, q, t), t), lerp(lerp(p, q, t), lerp(q, b, t), t), t));
  }
  const samples = samplePath(points); samples[0].heading = a.heading; samples[samples.length - 1].heading = b.heading; return samples;
}
export function trafficPose(points: Sample[], at: number): Pose {
  if (at <= 0) return points[0];
  if (at >= points[points.length - 1].distance) return points[points.length - 1];
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (points[mid].distance <= at) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi], t = (at - a.distance) / (b.distance - a.distance), turn = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
  return { ...lerp(a, b, t), heading: a.heading + turn * t };
}

/** Only actual source-node endpoints connect; crossing drawn lines never invent junctions. */
export function buildTrafficNetwork(data: RealMapData, rules: Rules = roadTrafficRules): TrafficLane[] {
  const eligible = data.roads.filter(road => {
    const tags = rules[road.sourceId] ?? {}, access = tags.motorcar ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access;
    return motorRoads.has(road.highway) && !road.walkable && !road.underground && road.width >= 5 && !!road.centerline
      && Number(tags.layer ?? 0) >= 0 && (!tags.tunnel || tags.tunnel === 'no') && !restricted.has(access);
  });
  const roadsAt = footprintIndex(eligible), buildingsAt = footprintIndex(data.buildings), waterAt = footprintIndex(data.water);
  // All rendered road/bridge surfaces in this map are y=0. Layer tags constrain
  // topology only; inventing layer*height would make vehicles float above decks.
  const clear = (p: Pose, layer: number, bridge: boolean) => {
    const f = facing(p.heading), right = { x: -f.z, z: f.x }, bound = 2.45;
    const buildings = buildingsAt(p.x, p.z, bound).filter(b => b.minY < 1.65 && b.height > 0);
    if (buildings.some(b => diskIntersects(b.rings, p.x, p.z, bound))) return false;
    const roads = roadsAt(p.x, p.z, bound).filter(r => Number(rules[r.sourceId]?.layer ?? 0) === layer || r.bridge || bridge);
    const water = waterAt(p.x, p.z, bound);
    // A padded oriented footprint, including midpoints, stays on the union of
    // eligible road polygons. No pedestrian-only polygons can support a car.
    for (const longitudinal of [-2.4, -2, -1.6, -1.2, -.8, -.4, 0, .4, .8, 1.2, 1.6, 2, 2.4]) for (const lateral of [-1.15, 0, 1.15]) {
      const x = p.x + f.x * longitudinal + right.x * lateral, z = p.z + f.z * longitudinal + right.z * lateral;
      if (!roads.some(r => polygonContains(r.rings, x, z))) return false;
      if (water.some(w => polygonContains(w.rings, x, z)) && !roads.some(r => r.bridge && polygonContains(r.rings, x, z))) return false;
    }
    return true;
  };
  const lanes: TrafficLane[] = [];
  const sharedVertices = new Map<string, Set<string>>();
  for (const road of eligible) for (const [x, z] of road.centerline!) {
    const key = nodeKey({ x, z }), owners = sharedVertices.get(key) ?? new Set<string>();
    owners.add(road.id); sharedVertices.set(key, owners);
  }
  const sections = eligible.flatMap(road => {
    const line = road.centerline!, cuts = [0];
    for (let i = 1; i < line.length - 1; i++) if ((sharedVertices.get(nodeKey({ x: line[i][0], z: line[i][1] }))?.size ?? 0) > 1) cuts.push(i);
    cuts.push(line.length - 1);
    return cuts.slice(1).map((end, i) => ({ road, section: i, line: line.slice(cuts[i], end + 1) }));
  });
  for (const { road, section, line: sectionLine } of sections) {
    const tags = rules[road.sourceId] ?? {}, layer = Number(tags.layer ?? 0), oneWay = tags.oneway ?? (tags.junction === 'roundabout' ? 'yes' : 'no');
    const directions = oneWay === '-1' ? [-1] : ['yes', '1', 'true'].includes(oneWay) ? [1] : [1, -1];
    for (const sign of directions) {
      const line = sectionLine.map(p => ({ x: p[0], z: p[1] })).filter((p, i, all) => !i || distance(p, all[i - 1]) > .05);
      if (line.length < 2) continue;
      if (sign < 0) line.reverse();
      const offset = directions.length === 1 ? 0 : Math.min(1.65, road.width * .24);
      const samples = lanePath(line, offset);
      let run: Sample[] = [], start = 0;
      const flush = (end: number) => {
        if (run.length > 1 && run[run.length - 1].distance - run[0].distance >= 6) {
          const base = run[0].distance, points = run.map(p => ({ ...p, distance: p.distance - base }));
          lanes.push({ id: `${road.id}:${section}:${sign}:${start}`, roadId: road.id, sourceId: road.sourceId, bridge: road.bridge, layer, points, length: points[points.length - 1].distance,
            start: start === 0 ? line[0] : null, end: end === samples.length ? line[line.length - 1] : null, circulating: false, next: [] });
        }
        run = [];
      };
      for (let i = 0; i < samples.length; i++) {
        if (clear(samples[i], layer, road.bridge)) { if (!run.length) start = i; run.push(samples[i]); } else flush(i);
      }
      flush(samples.length);
    }
  }
  const starts = new Map<string, number[]>();
  lanes.forEach((lane, i) => { if (lane.start) { const key = nodeKey(lane.start), list = starts.get(key) ?? []; list.push(i); starts.set(key, list); } });
  for (const lane of lanes) {
    if (!lane.end) continue;
    for (const i of starts.get(nodeKey(lane.end)) ?? []) {
      const target = lanes[i];
      if (target.layer !== lane.layer && !(target.bridge !== lane.bridge && Math.abs(target.layer - lane.layer) <= 1)) continue;
      const a = lane.points[lane.points.length - 1], b = target.points[0];
      if (Math.cos(a.heading - b.heading) < -.35) continue;
      const points = connector(a, b);
      if (points.every(p => clear(p, lane.layer, lane.bridge || target.bridge))) lane.next.push({ lane: i, points, length: points[points.length - 1].distance });
    }
  }
  // Keep circulating routes from choosing known dead ends. Upstream lanes that
  // can reach a cycle remain usable; isolated terminal lanes are not populated.
  const live = new Set(lanes.map((_, i) => i));
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of live) if (!lanes[i].next.some(next => live.has(next.lane))) { live.delete(i); changed = true; }
  }
  lanes.forEach((lane, i) => { lane.circulating = live.has(i); if (live.size) lane.next = live.has(i) ? lane.next.filter(next => live.has(next.lane)) : []; });
  return lanes;
}

/** Padded oriented boxes allow opposing lanes to pass without interpenetration. */
export function trafficOverlaps(a: Pose, b: Pose): boolean {
  if (distance(a, b) > 6) return false;
  const af = facing(a.heading), ar = { x: -af.z, z: af.x }, bf = facing(b.heading), br = { x: -bf.z, z: bf.x };
  return [af, ar, bf, br].every(axis => {
    const separation = Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z);
    const reach = 2.65 * (Math.abs(af.x * axis.x + af.z * axis.z) + Math.abs(bf.x * axis.x + bf.z * axis.z))
      + 1.04 * (Math.abs(ar.x * axis.x + ar.z * axis.z) + Math.abs(br.x * axis.x + br.z * axis.z));
    return separation < reach;
  });
}

/** A single source-valid local circuit avoids competing intersection streams. */
export function selectTrafficCircuit(lanes: TrafficLane[], origin: Point): number[] {
  const candidates = lanes.map((lane, i) => ({ lane, i, near: Math.min(...lane.points.map(p => distance(p, origin))) }))
    .filter(v => v.lane.circulating).sort((a, b) => a.near - b.near).slice(0, 40);
  let chosen: number[] = [], best = Infinity;
  for (const { i, near } of candidates) {
    const queue: number[][] = [[i]], seen = new Set([i]);
    let circuit: number[] | undefined;
    for (let head = 0; head < queue.length && !circuit; head++) {
      const path = queue[head];
      for (const next of lanes[path[path.length - 1]].next) {
        if (next.lane === i) { circuit = path; break; }
        if (!seen.has(next.lane)) { seen.add(next.lane); queue.push([...path, next.lane]); }
      }
    }
    if (!circuit) continue;
    const length = circuit.reduce((sum, id, j) => sum + lanes[id].length + lanes[id].next.find(n => n.lane === circuit![(j + 1) % circuit!.length])!.length, 0);
    const radius = Math.max(...circuit.flatMap(id => lanes[id].points.map(p => distance(p, origin))));
    if (length < 140 || length > 1500 || near > 120 || radius > 240) continue;
    const score = radius + near * 2 + length * .04;
    if (score < best) { chosen = circuit; best = score; }
  }
  return chosen;
}

type Car = { root: THREE.Group; lane: number; at: number; turn: TrafficLane['next'][number] | null; speed: number; cruise: number; seed: number; travelled: number };
export function createRoadTraffic(parent: THREE.Scene, layout: MapLayout) {
  const lanes = layout.realMap ? buildTrafficNetwork(layout.realMap) : [];
  const origin = layout.spawns[0] ?? { x: 0, y: 0, z: 0 }, circuit = selectTrafficCircuit(lanes, origin);
  for (let i = 0; i < circuit.length; i++) { const lane = lanes[circuit[i]]; lane.next = lane.next.filter(next => next.lane === circuit[(i + 1) % circuit.length]); }
  const root = new THREE.Group(); root.name = 'road-traffic'; parent.add(root);
  const resources: (THREE.BufferGeometry | THREE.Material)[] = [];
  const own = <T extends THREE.BufferGeometry | THREE.Material>(r: T): T => { resources.push(r); return r; };
  const bodyMaterial = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .46, metalness: .18 }));
  const glassMaterial = own(new THREE.MeshStandardMaterial({ color: '#59747e', roughness: .22, metalness: .35 }));
  const glassGeometry = own(new THREE.BoxGeometry(1.52, .66, 2.05));
  const geometries = ['#d9dddf', '#4c656b', '#e9e2d4', '#a54a43', '#d8b255', '#333e50'].map(color => {
    const painter = new Painter();
    painter.box(0, .67, 0, 1.78, .64, 4.15, color);
    painter.box(0, 1.46, -.16, 1.55, .10, 1.76, color);
    for (const x of [-.57, .57]) { painter.box(x, .72, 2.09, .39, .19, .035, '#fff0c0'); painter.box(x, .74, -2.09, .35, .18, .035, '#a52e29'); }
    for (const x of [-.9, .9]) for (const z of [-1.28, 1.28]) painter.add(new THREE.CylinderGeometry(.31, .31, .19, 8), '#20272b', new THREE.Vector3(x, .31, z), undefined, new THREE.Euler(0, 0, Math.PI / 2));
    return own(painter.geometry());
  });
  function makeCar(i: number): Pick<Car, 'root'> {
    const group = new THREE.Group(); group.name = `road-car:${i}`;
    group.add(new THREE.Mesh(geometries[i % geometries.length], bodyMaterial));
    const glass = new THREE.Mesh(glassGeometry, glassMaterial); glass.position.set(0, 1.11, -.16); group.add(glass);
    root.add(group); return { root: group };
  }
  const cars: Car[] = [], limit = layout.quality === 'mobile' ? 14 : 20, renderRadius = layout.quality === 'mobile' ? 190 : 270;
  const circuitLength = circuit.reduce((sum, i) => sum + lanes[i].length + lanes[i].next[0].length, 0);
  const pose = (car: Car) => trafficPose(car.turn?.points ?? lanes[car.lane].points, car.at);
  const paint = (car: Car, observer: { x: number; y: number; z: number }) => {
    const p = pose(car); car.root.position.set(p.x, 0, p.z); car.root.rotation.y = p.heading;
    car.root.visible = Math.hypot(p.x - observer.x, observer.y, p.z - observer.z) <= renderRadius;
  };
  // Even arc-length spacing on one directed loop removes crossing competition.
  // Cars never despawn/reappear to hide a blocked road, including off screen.
  const count = Math.min(limit, Math.floor(circuitLength / 18));
  for (let i = 0; i < count; i++) {
    let at = i * circuitLength / count, lane = circuit[0], turn: Car['turn'] = null;
    for (const id of circuit) {
      lane = id;
      if (at <= lanes[id].length) break;
      at -= lanes[id].length;
      if (at <= lanes[id].next[0].length) { turn = lanes[id].next[0]; break; }
      at -= lanes[id].next[0].length;
    }
    const candidate = trafficPose(turn?.points ?? lanes[lane].points, at);
    if (cars.some(other => trafficOverlaps(candidate, pose(other)))) continue;
    const car: Car = { ...makeCar(i), lane, at, turn, speed: 0, cruise: 6, seed: i, travelled: 0 };
    cars.push(car); paint(car, origin);
  }
  let disposed = false, time = 0;
  const segmentLength = (car: Car) => car.turn?.length ?? lanes[car.lane].length;
  function future(car: Car, amount: number): Pose { return trafficPose(car.turn?.points ?? lanes[car.lane].points, Math.min(segmentLength(car), car.at + amount)); }
  function occupied(car: Car, p: Pose, fleet = cars) { return fleet.some(other => other !== car && trafficOverlaps(p, pose(other))); }
  function advance(car: Car, amount: number) {
    const remaining = segmentLength(car) - car.at;
    if (amount <= remaining) { car.at += amount; return; }
    car.at = segmentLength(car);
    if (car.turn) { car.lane = car.turn.lane; car.turn = null; car.at = 0; }
    else {
      const next = lanes[car.lane].next;
      if (!next.length) return;
      car.turn = next[car.seed++ % next.length]; car.at = 0;
    }
    // At most 0.9 m per substep. Junctions and lanes exceed this distance.
    car.at = Math.min(segmentLength(car), amount - remaining);
  }
  let revision = 0;
  const states = (fleet: Car[]): TrafficState[] => fleet.map(car => ({ id: car.root.name, ...pose(car), y: 0,
    visible: car.root.visible, speed: car.speed, roadId: lanes[car.lane].roadId }));
  function prepare(seconds: number) {
    if (disposed || !Number.isFinite(seconds) || seconds <= 0 || seconds > .1) return null;
    const before = revision, draft = cars.map(car => ({ ...car }));
    const start = states(cars);
    const steps = Math.ceil(seconds / .025), dt = seconds / steps;
    const samples = [{ seconds: 0, states: start }];
    for (let step = 0; step < steps; step++) {
      for (const car of draft) {
        const remaining = segmentLength(car) - car.at, canContinue = !!car.turn || lanes[car.lane].next.length > 0;
        let desired = car.turn ? 3.5 : car.cruise;
        const bend = Math.abs(Math.atan2(Math.sin(future(car, 7).heading - pose(car).heading), Math.cos(future(car, 7).heading - pose(car).heading)));
        if (bend > .18) desired = Math.min(desired, 3.5);
        if (!canContinue) desired = Math.min(desired, Math.sqrt(Math.max(0, remaining) * 5));
        for (const look of [2, 5, 9]) if (occupied(car, future(car, look), draft)) desired = Math.min(desired, Math.sqrt(Math.max(0, look - 2) * 4));
        car.speed += Math.max(-3 * dt, Math.min(1.7 * dt, desired - car.speed));
        const amount = car.speed * dt, old = { lane: car.lane, at: car.at, turn: car.turn, seed: car.seed };
        advance(car, amount);
        if (occupied(car, pose(car), draft)) { Object.assign(car, old); car.speed = 0; } else car.travelled += amount;
      }
      samples.push({ seconds: (step + 1) * dt, states: states(draft) });
    }
    let used = false;
    const isCurrent = () => !used && !disposed && before === revision;
    return { samples, isCurrent, commit(observer: {x:number;y:number;z:number}) {
      if (!isCurrent()) throw new Error('Stale traffic proposal');
      used = true; revision++; time += seconds;
      for (let i = 0; i < cars.length; i++) { Object.assign(cars[i], draft[i]); paint(cars[i], observer); }
    } };
  }
  return {
    root, prepare,
    update(seconds: number, observer: { x: number; y: number; z: number }) {
      if (![observer.x, observer.y, observer.z].every(Number.isFinite)) return;
      prepare(seconds)?.commit(observer);
    },
    snapshot(): { time: number; count: number; laneCount: number; circuitLength: number; circuitRoads: string[]; states: TrafficState[] } {
      return { time, count: cars.length, laneCount: lanes.length, circuitLength, circuitRoads: circuit.map(i => lanes[i].roadId), states: disposed ? [] : cars.map(car => ({ id: car.root.name, x: car.root.position.x, y: car.root.position.y, z: car.root.position.z,
        visible: car.root.visible, heading: car.root.rotation.y, speed: car.speed, roadId: lanes[car.lane].roadId })) };
    },
    dispose() { if (disposed) return; disposed = true; root.removeFromParent(); root.clear(); for (const r of resources) r.dispose(); cars.length = 0; },
  };
}
