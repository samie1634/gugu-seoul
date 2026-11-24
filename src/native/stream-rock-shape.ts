import * as THREE from 'three';
import { diskInside, type Rings } from './ported/map/real-map/geometry.ts';
import { face, overlaps, pointAt, segmentBounds, sweepEllipsoidFace, sweepSphereFace, type Box, type Face } from './ported/motion/locomotion/b2/collision.ts';
import type { NativeBody, NativeSupport, NativeSupportProbe, NativeWorldQueries, NativeSweepHit, Vec3 } from './ported/motion/locomotion/b2/contracts.ts';
import type { MapLayout } from './ported/map/contracts.ts';

const EPS = 1e-7;
const SEGMENTS = 12;
// One original weathered boulder, shared by all instances. The irregular polygon and
// broad fractured crown are used verbatim by rendering, landing and swept collision.
const rim = Array.from({ length: SEGMENTS }, (_, i) => {
  const a = i * Math.PI * 2 / SEGMENTS + .018 * Math.sin(i * 2.1);
  const r = 1 + .028 * Math.sin(i * 2.07) + .014 * Math.cos(i * 1.23);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
});
const rings = [[.82, 1], [1, .70], [1.08, .18], [.83, 0]];
const vertices: Vec3[] = rings.flatMap(([radius, y]) => rim.map(p => ({ x: p.x * radius, y, z: p.z * radius })));
vertices.push({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 });
const triangles: number[][] = [];
for (let i = 0; i < SEGMENTS; i++) {
  const next = (i + 1) % SEGMENTS;
  triangles.push([48, next, i], [49, 36 + i, 36 + next]);
  for (let ring = 0; ring < 3; ring++) {
    const a = ring * SEGMENTS + i, b = ring * SEGMENTS + next, c = a + SEGMENTS, d = b + SEGMENTS;
    triangles.push([a, b, c], [b, d, c]);
  }
}
export function createStreamRockGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(p => [p.x, p.y, p.z]), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertices.flatMap((p, i) => {
    const light = .70 + p.y * .22 + Math.sin(i * 2.137) * .045;
    return [light, light * .99, light * .95];
  }), 3));
  geometry.setIndex(triangles.flat()); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}
export function createStreamRockMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: '#a09e94', roughness: .98, vertexColors: true });
  // Original procedural mineral grain and weathering. No image download, texture
  // allocation, extra draw call, or per-frame CPU update is needed.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 stonePosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nstonePosition=position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 stonePosition;')
      .replace('#include <color_fragment>', `#include <color_fragment>
float grain=fract(sin(dot(floor(stonePosition*125.),vec3(127.1,311.7,74.7)))*43758.5453);
float mineral=sin(stonePosition.x*19.+stonePosition.z*23.)*sin(stonePosition.y*27.-stonePosition.x*12.);
diffuseColor.rgb*=.89+grain*.16+mineral*.055;`);
  };
  material.customProgramCacheKey = () => 'stream-weathered-stone-v1';
  return material;
}
export interface StreamRockPlacement { x: number; y: number; z: number; bedY: number; radiusX: number; radiusZ: number }
interface Solid { id: string; height: number; faces: Face[]; bounds: Box; crown: Rings }
const solids = new WeakMap<MapLayout, readonly Solid[]>();
export function registerStreamRocks(layout: MapLayout, placements: readonly StreamRockPlacement[]) {
  const registered = placements.map((p, index): Solid => {
    const points = vertices.map(v => ({ x: p.x + v.x * p.radiusX, y: p.bedY + v.y * (p.y - p.bedY), z: p.z + v.z * p.radiusZ }));
    const crown = points.slice(0, SEGMENTS).map(v => [v.x, v.z]); crown.push([...crown[0]]);
    return { id: `stream:stone:${index}`, height: p.y, crown: [crown], faces: triangles.map(t => face(points[t[0]], points[t[1]], points[t[2]])),
      bounds: { min: { x: Math.min(...points.map(v => v.x)), y: p.bedY, z: Math.min(...points.map(v => v.z)) }, max: { x: Math.max(...points.map(v => v.x)), y: p.y, z: Math.max(...points.map(v => v.z)) } } };
  });
  solids.set(layout, registered);
  return () => { if (solids.get(layout) === registered) solids.delete(layout); };
}
const QUERY_EPS = 2e-6; // Same contact tolerance as native motion and vehicle-world.
const finitePoint = (p: Vec3) => !!p && [p.x, p.y, p.z].every(Number.isFinite);
const unitNormal = (p: Vec3) => finitePoint(p) && Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < .001;
function validProbe(probe: NativeSupportProbe): boolean {
  return !!probe && finitePoint(probe.at) && [probe.previousFeetY, probe.footRadiusM, probe.heightM, probe.maxRiseM, probe.maxDropM].every(Number.isFinite) &&
    probe.footRadiusM >= 0 && probe.heightM > 0 && probe.maxRiseM >= 0 && probe.maxDropM >= 0;
}
function validSupport(value: NativeSupport | null | undefined, probe: NativeSupportProbe): boolean {
  if (!validProbe(probe)) return false;
  if (value === null) return true;
  return !!value && typeof value.id === 'string' && !!value.id && typeof value.layerId === 'string' && !!value.layerId &&
    typeof value.surface === 'string' && !!value.surface && typeof value.walkable === 'boolean' && typeof value.landable === 'boolean' &&
    unitNormal(value.normal) && value.normal.y > 0 && Number.isFinite(value.height) &&
    value.height >= Math.min(probe.previousFeetY, probe.at.y) - probe.maxDropM - QUERY_EPS && value.height <= probe.previousFeetY + probe.maxRiseM + QUERY_EPS;
}
function checkedHit(value: NativeSweepHit | null | undefined, from: Vec3, to: Vec3): NativeSweepHit | null | undefined {
  if (!finitePoint(from) || !finitePoint(to)) return undefined;
  if (value === null) return null;
  if (!value || !Number.isFinite(value.fraction) || value.fraction < 0 || value.fraction > 1 || !finitePoint(value.point) || !unitNormal(value.normal) ||
    typeof value.colliderId !== 'string' || !value.colliderId || (value.layerId !== undefined && typeof value.layerId !== 'string')) return undefined;
  if (value.edgeSlide !== undefined && (!unitNormal(value.edgeSlide) || Math.abs(value.edgeSlide.y) > EPS)) return undefined;
  const expected = pointAt(from, to, value.fraction);
  return Math.hypot(expected.x - value.point.x, expected.y - value.point.y, expected.z - value.point.z) <= QUERY_EPS ? value : undefined;
}
const select = (base: NativeSweepHit | null | undefined, other: NativeSweepHit | null | undefined) => base === undefined || other === undefined ? undefined : !base ? other : !other || base.fraction <= other.fraction ? base : other;
function edgeOutward(solid: Solid, at: Vec3): Vec3 {
  const rim = solid.crown[0]; let nearest = Infinity, direction = { x: 1, y: 0, z: 0 };
  for (let i = 1; i < rim.length; i++) {
    const a = rim[i - 1], b = rim[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((at.x - a[0]) * dx + (at.z - a[1]) * dz) / (length * length)));
    const distance = Math.hypot(at.x - a[0] - dx * t, at.z - a[1] - dz * t);
    if (distance < nearest) { nearest = distance; direction = { x: dz / length, y: 0, z: -dx / length }; }
  }
  return direction;
}
/** Compose without hiding unavailable queries or removing dynamic-world methods. */
export function withStreamStoneSupport<T extends NativeWorldQueries>(world: T, layout: MapLayout): T {
  const sweep = (from: Vec3, to: Vec3, shape: NativeBody | number): NativeSweepHit | null | undefined => {
    if (!finitePoint(from) || !finitePoint(to)) return undefined;
    if (typeof shape === 'number') { if (!Number.isFinite(shape) || shape <= 0) return undefined; }
    else if (!shape || ![shape.horizontalRadiusM, shape.heightM, shape.centreToSoleM, shape.footSupportRadiusM].every(Number.isFinite) ||
      shape.horizontalRadiusM <= 0 || shape.centreToSoleM <= 0 || shape.heightM <= shape.centreToSoleM || shape.footSupportRadiusM < 0 || !finitePoint(shape.eyeFromSoleM)) return undefined;
    const body = typeof shape === 'number' ? undefined : shape, radius = typeof shape === 'number' ? shape : shape.horizontalRadiusM;
    const broad = segmentBounds(from, to, radius, body?.centreToSoleM ?? radius, body ? body.heightM - body.centreToSoleM : radius);
    let best: NativeSweepHit | null = null;
    for (const solid of solids.get(layout) ?? []) {
      if (!overlaps(broad, solid.bounds)) continue;
      // A shell sweep alone cannot see a camera fully enclosed inside a boulder.
      const inside = solid.faces.every(f => { const a = f.triangle.a; return (from.x - a.x) * f.normal.x + (from.y - a.y) * f.normal.y + (from.z - a.z) * f.normal.z < -EPS; });
      if (inside) return { fraction: 0, point: { ...from }, normal: { x: 0, y: 1, z: 0 }, colliderId: solid.id, layerId: solid.id };
      for (const panel of solid.faces) {
        if (!overlaps(broad, panel.bounds)) continue;
        const hit = body ? sweepEllipsoidFace(from, to, body, panel) : sweepSphereFace(from, to, radius, panel);
        if (hit === undefined) return undefined;
        if (hit && (!best || hit.fraction < best.fraction)) {
          const point = pointAt(from, to, hit.fraction);
          // Keep the real normal/contact and full-foot support contract. A bird
          // balancing on an unsupported flat lip slides off via the normal sweep.
          const edgeSlide = body && hit.normal.y > .999 && !diskInside(solid.crown, point.x, point.z, body.footSupportRadiusM)
            ? edgeOutward(solid, point) : undefined;
          best = { ...hit, point, colliderId: solid.id, layerId: solid.id, ...(edgeSlide ? { edgeSlide } : {}) };
        }
      }
    }
    return best;
  };
  const support = (base: NativeSupport | null | undefined, probe: Parameters<T['supportAt']>[0]) => {
    // Validate before selection: even a nearer valid stone must not hide a broken world.
    if (!validSupport(base, probe)) return undefined;
    let best = base;
    const low = Math.min(probe.previousFeetY, probe.at.y) - probe.maxDropM, high = probe.previousFeetY + probe.maxRiseM;
    for (const solid of solids.get(layout) ?? []) {
      if (solid.height < low - EPS || solid.height > high + EPS || (best && best.height >= solid.height) || !diskInside(solid.crown, probe.at.x, probe.at.z, probe.footRadiusM)) continue;
      best = { id: solid.id, layerId: solid.id, height: solid.height, normal: { x: 0, y: 1, z: 0 }, surface: 'stone', walkable: true, landable: true };
    }
    return best;
  };
  return { ...world,
    supportAt: probe => support(world.supportAt(probe), probe),
    ...(world.supportAtTime ? { supportAtTime: (probe, time) => support(world.supportAtTime!(probe, time), probe) } : {}),
    sweepBody(from, to, body) { const base = checkedHit(world.sweepBody(from, to, body), from, to); return base === undefined ? undefined : select(base, sweep(from, to, body)); },
    sweepSphere(from, to, radius) { const base = checkedHit(world.sweepSphere(from, to, radius), from, to); return base === undefined ? undefined : select(base, sweep(from, to, radius)); },
    ...(world.sweepCameraMotion ? { sweepCameraMotion(from: Vec3, to: Vec3, radius: number) { const base = checkedHit(world.sweepCameraMotion!(from, to, radius), from, to); return base === undefined ? undefined : select(base, sweep(from, to, radius)); } } : {}),
    sphereClear(center, radius) { const base = world.sphereClear(center, radius); if (base !== true) return base === false ? false : undefined; const hit = sweep(center, center, radius); return hit === undefined ? undefined : hit === null; },
  };
}
