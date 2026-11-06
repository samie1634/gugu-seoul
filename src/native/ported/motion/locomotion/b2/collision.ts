import { Triangle, Vector3 } from 'three';
import type { NativeBody, NativeQueryResult, Vec3 } from './contracts.ts';

export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Contact {
  fraction: number;
  normal: Vec3;
}

export interface Face {
  readonly triangle: Triangle;
  readonly normal: Vec3;
  readonly bounds: Box;
}

const EPS = 1e-7;
const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function pointAt(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function axisNormal(axis: Axis, direction: number): Vec3 {
  return { x: 0, y: 0, z: 0, [axis]: direction };
}

export function segmentBounds(from: Vec3, to: Vec3, side: number, below: number, above: number): Box {
  return {
    min: { x: Math.min(from.x, to.x) - side, y: Math.min(from.y, to.y) - below, z: Math.min(from.z, to.z) - side },
    max: { x: Math.max(from.x, to.x) + side, y: Math.max(from.y, to.y) + above, z: Math.max(from.z, to.z) + side },
  };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

function boxDistance(center: Vec3, box: Box): { distance: number; normal: Vec3 } {
  const nearest = {
    x: Math.max(box.min.x, Math.min(box.max.x, center.x)),
    y: Math.max(box.min.y, Math.min(box.max.y, center.y)),
    z: Math.max(box.min.z, Math.min(box.max.z, center.z)),
  };
  const outward = subtract(center, nearest);
  const distance = Math.hypot(outward.x, outward.y, outward.z);
  if (distance > 0) return { distance, normal: unit(outward) };

  let depth = Infinity;
  let normal: Vec3 = { x: 0, y: 1, z: 0 };
  for (const axis of AXES) {
    const low = center[axis] - box.min[axis];
    const high = box.max[axis] - center[axis];
    if (Math.min(low, high) < depth) {
      depth = Math.min(low, high);
      normal = axisNormal(axis, low <= high ? -1 : 1);
    }
  }
  return { distance: -depth, normal };
}

// The current closest-feature plane is a lower bound on the distance to a convex obstacle.
function sweepDistance(
  from: Vec3, to: Vec3, radius: number,
  distanceAt: (point: Vec3) => { distance: number; normal: Vec3 },
): NativeQueryResult<Contact> {
  const delta = subtract(to, from);
  let fraction = 0;
  for (let i = 0; i < 32; i += 1) {
    const { distance, normal } = distanceAt(pointAt(from, to, fraction));
    const gap = distance - radius;
    const closing = -dot(normal, delta);
    if (gap < -EPS || (gap <= EPS && closing > EPS)) return { fraction, normal };
    if (closing <= EPS) return null;
    const next = fraction + gap / closing;
    if (next > 1) return null;
    if (next <= fraction) return undefined;
    fraction = next;
  }
  return undefined;
}

export function sweepSphereBox(from: Vec3, to: Vec3, radius: number, box: Box): NativeQueryResult<Contact> {
  return sweepDistance(from, to, radius, point => boxDistance(point, box));
}

export function sweepBodyBox(from: Vec3, to: Vec3, body: NativeBody, box: Box): Contact | null {
  const r = body.horizontalRadiusM;
  const expanded = {
    min: { x: box.min.x - r, y: box.min.y - (body.heightM - body.centreToSoleM), z: box.min.z - r },
    max: { x: box.max.x + r, y: box.max.y + body.centreToSoleM, z: box.max.z + r },
  };
  if (AXES.every(axis => from[axis] > expanded.min[axis] + EPS && from[axis] < expanded.max[axis] - EPS)) {
    return { fraction: 0, normal: boxDistance(from, expanded).normal };
  }

  let enter = -Infinity;
  let exit = Infinity;
  let normal: Vec3 = { x: 0, y: 1, z: 0 };
  for (const axis of AXES) {
    const delta = to[axis] - from[axis];
    if (delta === 0) {
      if (from[axis] <= expanded.min[axis] + EPS || from[axis] >= expanded.max[axis] - EPS) return null;
      continue;
    }
    const near = delta > 0 ? expanded.min[axis] : expanded.max[axis];
    const far = delta > 0 ? expanded.max[axis] : expanded.min[axis];
    const crossing = (near - from[axis]) / delta;
    if (crossing > enter) {
      enter = crossing;
      normal = axisNormal(axis, delta > 0 ? -1 : 1);
    }
    exit = Math.min(exit, (far - from[axis]) / delta);
  }
  if (enter > 1 || enter >= exit || exit <= 0) return null;
  if (enter < 0) {
    const { distance } = boxDistance(from, expanded);
    if (enter === -Infinity || distance > EPS || distance < -EPS) return null;
  }
  return { fraction: Math.max(0, enter), normal };
}

export function face(a: Vec3, b: Vec3, c: Vec3): Face {
  const triangle = new Triangle(new Vector3(a.x, a.y, a.z), new Vector3(b.x, b.y, b.z), new Vector3(c.x, c.y, c.z));
  const normal = triangle.getNormal(new Vector3());
  return {
    triangle, normal: { x: normal.x, y: normal.y, z: normal.z },
    bounds: {
      min: { x: Math.min(a.x, b.x, c.x), y: Math.min(a.y, b.y, c.y), z: Math.min(a.z, b.z, c.z) },
      max: { x: Math.max(a.x, b.x, c.x), y: Math.max(a.y, b.y, c.y), z: Math.max(a.z, b.z, c.z) },
    },
  };
}

export function sweepSphereFace(from: Vec3, to: Vec3, radius: number, panel: Face): NativeQueryResult<Contact> {
  const point = new Vector3();
  const closest = new Vector3();
  return sweepDistance(from, to, radius, center => {
    panel.triangle.closestPointToPoint(point.set(center.x, center.y, center.z), closest);
    const outward = subtract(center, closest);
    const distance = Math.hypot(outward.x, outward.y, outward.z);
    if (distance > 0) return { distance, normal: unit(outward) };
    return { distance, normal: panel.normal };
  });
}

export function sweepEllipsoidFace(from: Vec3, to: Vec3, body: NativeBody, panel: Face): NativeQueryResult<Contact> {
  const rx = body.horizontalRadiusM;
  const ry = body.heightM / 2;
  const origin = { x: from.x, y: from.y + ry - body.centreToSoleM, z: from.z };
  const scaled = (point: Vec3): Vec3 => ({
    x: (point.x - origin.x) / rx, y: (point.y - origin.y) / ry, z: (point.z - origin.z) / rx,
  });
  const triangle = panel.triangle;
  const hit = sweepSphereFace(
    { x: 0, y: 0, z: 0 },
    { x: (to.x - from.x) / rx, y: (to.y - from.y) / ry, z: (to.z - from.z) / rx },
    1, face(scaled(triangle.a), scaled(triangle.b), scaled(triangle.c)),
  );
  if (!hit) return hit;
  return { fraction: hit.fraction, normal: unit({ x: hit.normal.x / rx, y: hit.normal.y / ry, z: hit.normal.z / rx }) };
}
