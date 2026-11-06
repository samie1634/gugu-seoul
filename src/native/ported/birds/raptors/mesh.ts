
import { BufferGeometry, Color, Float32BufferAttribute } from 'three';

export type Vec = readonly [number, number, number];
export type Rgb = readonly [number, number, number];
export type Surface = (azimuth: number, elevation: number, lift?: number) => Vec;
export type Rib = readonly [center: Vec, width: number, depth: number, tint: Rgb];

export const TAU = 2 * Math.PI;
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function rgb(hex: string): Rgb {
  const { r, g, b } = new Color(hex);
  return [r, g, b];
}

export function tint(a: Rgb, b: Rgb, t: number): Rgb {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

export function shade(color: Rgb, k: number): Rgb {
  return [clamp01(color[0] * k), clamp01(color[1] * k), clamp01(color[2] * k)];
}

export function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec, b: Vec): Vec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec, k: number): Vec {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v: Vec): Vec {
  return scale(v, 1 / Math.hypot(...v));
}

/** The builder stores one indexed, opaque vertex-colored mesh per moving part. */
export class Part {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  vertex(p: Vec, c: Rgb): number {
    const id = this.positions.length / 3;
    this.positions.push(...p);
    this.colors.push(...c);
    return id;
  }

  triangle(a: number, b: number, c: number, flip = false): void {
    this.indices.push(a, flip ? c : b, flip ? b : c);
  }

  /** Connect closed rings, allowing a single vertex for a pole or feather tip. */
  bridge(from: readonly number[], to: readonly number[], flip = false): void {
    const count = Math.max(from.length, to.length);
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count;
      if (from.length > 1) this.triangle(from[i], from[j], to[to.length === 1 ? 0 : j], flip);
      if (to.length > 1) this.triangle(from[from.length === 1 ? 0 : i], to[j], to[i], flip);
    }
  }

  geometry(side: 1 | -1 = 1): BufferGeometry {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(this.positions);
    const indices = this.indices.slice();
    if (side === -1) {
      for (let i = 0; i < positions.length; i += 3) positions[i] *= -1;
      for (let i = 0; i < indices.length; i += 3) {
        [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
      }
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Angles start at -Z and run toward +X; pitch leans the crown toward -Z. */
export function ellipsoid(center: Vec, radii: Vec, pitch = 0, crown = 1): Surface {
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  return (u, v, lift = 0) => {
    const cv = Math.abs(v) >= Math.PI / 2 ? 0 : Math.cos(v);
    const x = (radii[0] + lift) * cv ** crown * Math.sin(u);
    const y = (radii[1] + lift) * Math.sin(v);
    const z = -(radii[2] + lift) * cv * Math.cos(u);
    return [center[0] + x, center[1] + y * cos - z * sin, center[2] + y * sin + z * cos];
  };
}

export function skin(
  part: Part, surface: Surface, around: number, rows: number,
  ink: (u: number, v: number) => Rgb,
): void {
  let previous = [part.vertex(surface(0, -Math.PI / 2), ink(0, -Math.PI / 2))];
  for (let j = 1; j <= rows; j += 1) {
    const v = Math.PI * (j / rows - 0.5);
    const count = j === rows ? 1 : around;
    const ring = Array.from({ length: count }, (_, i) => {
      const u = TAU * i / count;
      return part.vertex(surface(u, v), ink(u, v));
    });
    part.bridge(previous, ring, true);
    previous = ring;
  }
}

export function medallion(
  part: Part, steps: number, radii: readonly number[],
  point: (r: number, a: number) => Vec, ink: (r: number, a: number) => Rgb,
): void {
  let previous = [part.vertex(point(0, 0), ink(0, 0))];
  for (const r of radii) {
    const ring = Array.from({ length: steps }, (_, i) => {
      const a = TAU * i / steps;
      return part.vertex(point(r, a), ink(r, a));
    });
    part.bridge(previous, ring);
    previous = ring;
  }
}

/** Smooth cross sections for tapered, curved beaks, claws and feather shafts. */
export function sweep(
  part: Part, ribs: readonly Rib[], sides: number, widthHint: Vec = [1, 0, 0],
  pigment: (color: Rgb, angle: number) => Rgb = color => color,
  minY = -Infinity,
): void {
  let previous: number[] | undefined;
  for (let i = 0; i < ribs.length; i += 1) {
    const [center, width, depth, c] = ribs[i];
    const before = ribs[Math.max(0, i - 1)][0];
    const after = ribs[Math.min(i + 1, ribs.length - 1)][0];
    const tangent = unit(sub(after, before));
    const depthAxis = unit(cross(tangent, widthHint));
    const widthAxis = cross(depthAxis, tangent);
    const count = width === 0 && depth === 0 ? 1 : sides;
    const ring = Array.from({ length: count }, (_, j) => {
      const a = TAU * j / count;
      const p = add(center, add(scale(widthAxis, width * Math.cos(a)), scale(depthAxis, depth * Math.sin(a))));
      return part.vertex([p[0], Math.max(minY, p[1]), p[2]], pigment(c, a));
    });
    if (previous) part.bridge(previous, ring);
    else if (count > 1) part.bridge([part.vertex(center, c)], ring);
    previous = ring;
    if (i === ribs.length - 1 && count > 1) part.bridge(ring, [part.vertex(center, c)]);
  }
}
