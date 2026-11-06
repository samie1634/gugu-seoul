import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Point = readonly [x: number, y: number, z: number];
// Elliptical cross-section perpendicular to +Z. The first and last sections are poles.
export type Section = readonly [z: number, bottom: number, top: number, halfWidth: number, centerX?: number];
export type Form = readonly Section[];
type Paint = (point: Point, angle: number, z: number) => THREE.Color;
type Transform = (point: Point) => Point;
const TAU = Math.PI * 2;

function interpolate(before: number, a: number, b: number, after: number, t: number): number {
  const slopeA = (b - before) / 2;
  const slopeB = (after - a) / 2;
  const t2 = t * t;
  const t3 = t2 * t;
  const value = (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * slopeA
    + (-2 * t3 + 3 * t2) * b + (t3 - t2) * slopeB;
  return THREE.MathUtils.clamp(value, Math.min(a, b), Math.max(a, b));
}

function sectionAt(form: Form, z: number): Section {
  const first = form[0];
  const last = form[form.length - 1];
  if (z <= first[0]) return first;
  if (z >= last[0]) return last;
  const i = form.findIndex(section => section[0] >= z) - 1;
  const a = form[i];
  const b = form[i + 1];
  const t = (z - a[0]) / (b[0] - a[0]);
  const before = form[Math.max(0, i - 1)];
  const after = form[Math.min(form.length - 1, i + 2)];
  const sample = (j: 1 | 2 | 3 | 4) => interpolate(before[j] ?? 0, a[j] ?? 0, b[j] ?? 0, after[j] ?? 0, t);
  return [z, sample(1), sample(2), sample(3), sample(4)];
}

function sectionPoint([z, bottom, top, halfWidth, centerX = 0]: Section, angle: number): Point {
  return [
    centerX + halfWidth * Math.cos(angle),
    (top + bottom) / 2 + (top - bottom) / 2 * Math.sin(angle),
    z,
  ];
}

export function formPoint(form: Form, z: number, angle: number): Point {
  return sectionPoint(sectionAt(form, z), angle);
}

export function formNormal(form: Form, z: number, angle: number): THREE.Vector3 {
  const tangent = new THREE.Vector3(...formPoint(form, z, angle + 0.005))
    .sub(new THREE.Vector3(...formPoint(form, z, angle - 0.005)));
  const axis = new THREE.Vector3(...formPoint(form, z + 0.0001, angle))
    .sub(new THREE.Vector3(...formPoint(form, z - 0.0001, angle)));
  return tangent.cross(axis).normalize();
}

function surfaceGeometry(positions: number[], colors: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

interface LoftOptions {
  sides: number;
  subdivisions?: number;
  paint: Paint;
  transform?: Transform;
  extraAngles?: readonly number[];
}

interface Mark {
  z: number;
  angle: number;
  halfDepth: number;
  halfArc: number;
  lift: number;
  sides: number;
  color: THREE.Color;
}

/** Bake all surfaces for an articulated part into one indexed, vertex-colored mesh. */
export class Part {
  private readonly pieces: THREE.BufferGeometry[] = [];

  loft(form: Form, { sides, subdivisions = 1, paint, transform, extraAngles = [] }: LoftOptions): void {
    const angles = Array.from({ length: sides }, (_, i) => i * TAU / sides);
    for (const angle of extraAngles) {
      if (angles.every(value => Math.abs(value - angle) > 1e-6)) angles.push(angle);
    }
    angles.sort((a, b) => a - b);
    const stride = angles.length;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const append = (section: Section, angle: number) => {
      const point = sectionPoint(section, angle);
      positions.push(...(transform ? transform(point) : point));
      const c = paint(point, angle, section[0]);
      colors.push(c.r, c.g, c.b);
    };
    const sections = [form[0]];
    for (let i = 1; i < form.length; i += 1) {
      const start = form[i - 1][0];
      const end = form[i][0];
      for (let j = 1; j < subdivisions; j += 1) {
        sections.push(sectionAt(form, THREE.MathUtils.lerp(start, end, j / subdivisions)));
      }
      sections.push(form[i]);
    }
    append(sections[0], 0);
    for (const section of sections.slice(1, -1)) {
      for (const angle of angles) append(section, angle);
    }
    const back = positions.length / 3;
    append(sections[sections.length - 1], 0);

    for (let j = 0; j < stride; j += 1) {
      const next = (j + 1) % stride;
      indices.push(0, 1 + next, 1 + j);
      for (let ring = 0; ring < sections.length - 3; ring += 1) {
        const a = 1 + ring * stride;
        const b = a + stride;
        indices.push(a + j, a + next, b + j, a + next, b + next, b + j);
      }
      indices.push(back - stride + j, back - stride + next, back);
    }
    this.pieces.push(surfaceGeometry(positions, colors, indices));
  }

  // A pigmented patch follows the underlying head surface without adding a bulge to the silhouette.
  mark(form: Form, side: -1 | 1, mark: Mark): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const append = (distance: number, phase: number) => {
      const z = mark.z + mark.halfDepth * distance * Math.cos(phase);
      const angle = mark.angle + mark.halfArc * distance * Math.sin(phase);
      const [x, y] = formPoint(form, z, angle);
      positions.push(side * (x + mark.lift), y, z);
      colors.push(mark.color.r, mark.color.g, mark.color.b);
    };
    const triangle = (a: number, b: number, c: number) => {
      indices.push(a, side === 1 ? c : b, side === 1 ? b : c);
    };
    append(0, 0);
    for (const radius of [0.52, 1]) {
      for (let j = 0; j < mark.sides; j += 1) append(radius, j * TAU / mark.sides);
    }
    for (let j = 0; j < mark.sides; j += 1) {
      const next = (j + 1) % mark.sides;
      const a = 1 + j;
      const b = 1 + next;
      const c = a + mark.sides;
      const d = b + mark.sides;
      triangle(0, a, b);
      triangle(a, c, b);
      triangle(b, c, d);
    }
    this.pieces.push(surfaceGeometry(positions, colors, indices));
  }

  ellipsoid(
    center: Point, radii: Point, color: THREE.Color, detail: number, axis?: THREE.Vector3,
  ): void {
    const geometry = new THREE.SphereGeometry(1, detail, Math.max(4, detail / 2));
    geometry.scale(...radii);
    if (axis) geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis));
    geometry.translate(...center);
    this.solid(geometry, color);
  }

  taper(start: Point, end: Point, startRadius: number, endRadius: number, color: THREE.Color, sides: number): void {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const axis = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(endRadius, startRadius, axis.length(), sides);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
    const midpoint = a.lerp(b, 0.5);
    geometry.translate(midpoint.x, midpoint.y, midpoint.z);
    this.solid(geometry, color);
  }

  finish(): THREE.BufferGeometry {
    const geometry = mergeGeometries(this.pieces);
    for (const piece of this.pieces) piece.dispose();
    this.pieces.length = 0;
    if (!geometry) throw new Error('Unable to merge urban bird part');
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private solid(geometry: THREE.BufferGeometry, color: THREE.Color): void {
    geometry.deleteAttribute('uv');
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.pieces.push(geometry);
  }
}