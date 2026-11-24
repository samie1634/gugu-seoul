import type { NativeBody, Vec3 } from './ported/motion/locomotion/b2/contracts.ts';
import { sweepBodyBox, sweepSphereBox, type Box, type Contact } from './ported/motion/locomotion/b2/collision.ts';

// These are the solid parts painted in road-traffic.ts, in car-local metres.
// In particular the chassis starts at .35 m; neither axle nor undertray is drawn.
const boxes: readonly Box[] = [
  { min: { x: -.89, y: .35, z: -2.075 }, max: { x: .89, y: .99, z: 2.075 } },
  { min: { x: -.76, y: .78, z: -1.185 }, max: { x: .76, y: 1.44, z: .865 } },
  { min: { x: -.775, y: 1.41, z: -1.04 }, max: { x: .775, y: 1.51, z: .72 } },
  ...[-.57, .57].flatMap(x => [
    { min: { x: x - .195, y: .625, z: 2.0725 }, max: { x: x + .195, y: .815, z: 2.1075 } },
    { min: { x: x - .175, y: .65, z: -2.1075 }, max: { x: x + .175, y: .83, z: -2.0725 } },
  ]),
];
const wheels = [-.9, .9].flatMap(x => [-1.28, 1.28].map(z => ({ x, y: .31, z })));
const radius = .31, halfAxle = .095, EPS = 1e-7;
const vertices = Array.from({ length: 8 }, (_, i) => ({ y: Math.sin(i * Math.PI / 4) * radius, z: Math.cos(i * Math.PI / 4) * radius }));
const sides = vertices.map((_, i) => ({ y: Math.sin((i + .5) * Math.PI / 4), z: Math.cos((i + .5) * Math.PI / 4) }));
const apothem = radius * Math.cos(Math.PI / 8);
const wheelPlanes = [
  { x: 1, y: 0, z: 0, d: halfAxle }, { x: -1, y: 0, z: 0, d: halfAxle },
  ...sides.map(n => ({ x: 0, ...n, d: apothem })),
  // Adding the upright body rectangle adds these axis-aligned faces too.
  { x: 0, y: 1, z: 0, d: radius }, { x: 0, y: -1, z: 0, d: radius },
  { x: 0, y: 0, z: 1, d: radius }, { x: 0, y: 0, z: -1, d: radius },
];

/** Exact distance to the rendered eight-sided wheel prism, including its caps. */
function wheelDistance(point: Vec3, wheel: Vec3): { distance: number; normal: Vec3 } {
  const x = point.x - wheel.x, y = point.y - wheel.y, z = point.z - wheel.z;
  let edgeGap = -Infinity, edgeNormal = sides[0];
  for (const n of sides) {
    const gap = n.y * y + n.z * z - apothem;
    if (gap > edgeGap) { edgeGap = gap; edgeNormal = n; }
  }
  const capGap = Math.abs(x) - halfAxle, capNormal = x < 0 ? -1 : 1;
  if (edgeGap <= 0 && capGap <= 0) return capGap > edgeGap
    ? { distance: capGap, normal: { x: capNormal, y: 0, z: 0 } }
    : { distance: edgeGap, normal: { x: 0, ...edgeNormal } };
  let dy = 0, dz = 0;
  if (edgeGap > 0) {
    let squared = Infinity;
    for (let i = 0; i < 8; i++) {
      const a = vertices[i], b = vertices[(i + 1) % 8], vy = b.y - a.y, vz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((y - a.y) * vy + (z - a.z) * vz) / (vy * vy + vz * vz)));
      const cy = y - a.y - vy * t, cz = z - a.z - vz * t, d = cy * cy + cz * cz;
      if (d < squared) { squared = d; dy = cy; dz = cz; }
    }
  }
  const dx = Math.max(0, capGap) * capNormal, distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-14) return { distance: 0, normal: capGap > edgeGap ? { x: capNormal, y: 0, z: 0 } : { x: 0, ...edgeNormal } };
  return { distance, normal: { x: dx / distance, y: dy / distance, z: dz / distance } };
}

function sweepWheelSphere(from: Vec3, to: Vec3, sphere: number, wheel: Vec3): Contact | null | undefined {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  let fraction = 0;
  for (let i = 0; i < 32; i++) {
    const { distance, normal } = wheelDistance({ x: from.x + dx * fraction, y: from.y + dy * fraction, z: from.z + dz * fraction }, wheel);
    const gap = distance - sphere, closing = -(normal.x * dx + normal.y * dy + normal.z * dz);
    if (gap < -EPS || (gap <= EPS && closing > EPS)) return { fraction, normal };
    if (closing <= EPS) return null;
    const next = fraction + gap / closing;
    if (next > 1) return null;
    if (next <= fraction) return undefined;
    fraction = next;
  }
  return undefined;
}

/** Same upright box body proxy as sweepBodyBox, against the actual wheel prism. */
function sweepWheelBody(from: Vec3, to: Vec3, body: NativeBody, wheel: Vec3): Contact | null {
  const side = body.horizontalRadiusM;
  let enter = -Infinity, exit = Infinity, inside = true, shallow = -Infinity;
  let normal: Vec3 = { x: 0, y: 1, z: 0 }, shallowNormal = normal;
  for (const n of wheelPlanes) {
    const expanded = n.d + (Math.abs(n.x) + Math.abs(n.z)) * side
      + (n.y > 0 ? n.y * body.centreToSoleM : -n.y * (body.heightM - body.centreToSoleM));
    const gap = n.x * (from.x - wheel.x) + n.y * (from.y - wheel.y) + n.z * (from.z - wheel.z) - expanded;
    const delta = n.x * (to.x - from.x) + n.y * (to.y - from.y) + n.z * (to.z - from.z);
    if (gap >= -EPS) inside = false;
    if (gap > shallow) { shallow = gap; shallowNormal = { x: n.x, y: n.y, z: n.z }; }
    if (Math.abs(delta) <= 1e-15) { if (gap >= -EPS) return null; continue; }
    const crossing = -gap / delta;
    if (delta < 0 && crossing > enter) { enter = crossing; normal = { x: n.x, y: n.y, z: n.z }; }
    if (delta > 0) exit = Math.min(exit, crossing);
  }
  if (inside) return { fraction: 0, normal: shallowNormal };
  if (enter > 1 || enter >= exit || exit <= 0 || enter < -EPS) return null;
  return { fraction: Math.max(0, enter), normal };
}

export function sweepVehicleParts(from: Vec3, to: Vec3, body: NativeBody | number): Contact | null | undefined {
  let best: Contact | null = null;
  const side = typeof body === 'number' ? body : body.horizontalRadiusM;
  const below = typeof body === 'number' ? body : body.centreToSoleM;
  const above = typeof body === 'number' ? body : body.heightM - body.centreToSoleM;
  const minX = Math.min(from.x, to.x) - side, maxX = Math.max(from.x, to.x) + side;
  const minY = Math.min(from.y, to.y) - below, maxY = Math.max(from.y, to.y) + above;
  const minZ = Math.min(from.z, to.z) - side, maxZ = Math.max(from.z, to.z) + side;
  const accept = (hit: Contact | null | undefined): boolean => {
    if (hit === undefined) return false;
    if (hit && (!best || hit.fraction < best.fraction)) best = hit;
    return true;
  };
  for (const box of boxes) {
    if (maxX < box.min.x || minX > box.max.x || maxY < box.min.y || minY > box.max.y || maxZ < box.min.z || minZ > box.max.z) continue;
    if (!accept(typeof body === 'number' ? sweepSphereBox(from, to, body, box) : sweepBodyBox(from, to, body, box))) return undefined;
  }
  for (const wheel of wheels) {
    if (maxX < wheel.x - halfAxle || minX > wheel.x + halfAxle || maxY < 0 || minY > .62 || maxZ < wheel.z - radius || minZ > wheel.z + radius) continue;
    if (!accept(typeof body === 'number' ? sweepWheelSphere(from, to, body, wheel) : sweepWheelBody(from, to, body, wheel))) return undefined;
  }
  return best;
}
