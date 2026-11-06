
import type { BirdLod } from '../rig-core/contract.ts';
import type { Palette } from './anatomy.ts';
import { Part, TAU, clamp01, mix, rgb, shade, smooth, sweep, tint } from './mesh.ts';
import type { Rgb, Rib, Vec } from './mesh.ts';
import type { Profile, RaptorSpecies, WingStation } from './profiles.ts';

const FLIGHT_TIP = rgb('#333039');
const TAIL_SLATE = rgb('#758692');
const TAIL_BAND = rgb('#2b2932');

type Face = 1 | -1;
type WingPoint = (u: number, chord: number, face: Face, lift?: number) => Vec;
type WingInk = (u: number, chord: number, face: Face) => Rgb;

function wingSurface(profile: Profile): WingPoint {
  const { stations, pivot, scallop } = profile.wing;
  const reach = profile.wingspan * 0.5 - pivot[0];
  return (u, chord, face, lift = 0) => {
    const next = stations.findIndex(row => row[0] >= u);
    const a = stations[Math.max(0, next - 1)];
    const b = stations[Math.max(0, next)];
    const t = a === b ? 0 : (u - a[0]) / (b[0] - a[0]);
    const sample = (column: 1 | 2 | 3 | 4) => mix(a[column], b[column], t);
    const outer = 0.28 + 0.72 * smooth(0.50, 0.84, u);
    const scallops = Math.sin(TAU * (u * 4.8 + 0.08 * Math.sin(7 * u))) ** 2;
    const trailing = sample(2) - scallop * scallops * outer
      * smooth(0.09, 0.34, u) * (1 - smooth(0.90, 0.99, u));
    const arc = Math.max(0, Math.sin(Math.PI * chord));
    const camber = sample(4) * (1 - 0.54 * chord) * arc ** 0.86;
    const y = sample(3) + face * (camber * (face === 1 ? 1 : 0.63) + lift);
    return [reach * u, y, mix(sample(1), trailing, chord)];
  };
}

function wingPigment(species: RaptorSpecies, p: Palette): WingInk {
  return (u, chord, face) => {
    const kestrel = species === 'kestrel';
    const front = face === 1 ? tint(p.back, p.flank, 0.20) : tint(p.breast, p.flank, 0.22);
    const coverts = tint(front, face === 1 ? p.flight : p.breast, smooth(0.24, 0.66, chord) * 0.53);
    const bands = smooth(0.13, 0.74, Math.sin(TAU * (chord * (kestrel ? 2.6 : 3.8) - u * 0.83)));
    const arm = tint(coverts, p.ink, bands * (kestrel ? 0.22 : 0.36) * smooth(0.19, 0.82, chord));
    const hand = smooth(0.48, 0.95, u + 0.22 * chord);
    const margin = smooth(0.72, 1, chord);
    const tip = kestrel ? FLIGHT_TIP : p.flight;
    const amount = kestrel ? clamp01(0.92 * hand + 0.46 * margin) : clamp01(hand * 0.26 + margin * 0.48);
    return shade(tint(arm, tip, amount), 0.98 + 0.065 * Math.sin(17 * u + 11 * chord));
  };
}

function wingRibbon(
  part: Part, surface: WingPoint, ink: WingInk, p: Palette, face: Face, lod: BirdLod,
  startU: number, endU: number, startChord: number, endChord: number, halfWidth: number,
  lift: number, covert: boolean, phase: number, species: RaptorSpecies,
): void {
  const rows = lod === 0 ? [0, 0.18, 0.33, 0.46, 0.58, 0.71, 0.82, 0.92, 1]
    : lod === 1 ? [0, 0.30, 0.49, 0.64, 0.79, 0.91, 1] : [0, 0.49, 0.78, 1];
  const kestrel = species === 'kestrel';
  let previous: number[] | undefined;
  for (const s of rows) {
    const u = mix(startU, endU, s) + 0.013 * Math.sin(Math.PI * s);
    const chord = mix(startChord, endChord, s);
    const width = halfWidth * (0.18 + 0.82 * Math.sin(Math.PI * s ** 1.29) ** 0.58);
    const row = [-1, 0, 1].map(column => {
      const x = u + width * column;
      const t = chord - 0.043 * s * Math.abs(column);
      const background = ink(x, t, face);
      const bars = smooth(0.12, 0.87, Math.cos(TAU * (s * (covert ? 1.08 : 3.10) + phase)));
      const mark = kestrel && covert ? 0.80 * smooth(0.44, 0.80, s) * (1 - smooth(0.84, 1, s))
        : (kestrel ? 0.17 : 0.41) * bars * smooth(0.14, 0.55, s);
      const quill = lod === 2 ? 0.039 : 0.095;
      const color = shade(tint(background, p.ink, mark * (lod === 2 ? 0.51 : 1)),
        1 + quill * (column === 0 ? 1 : column < 0 ? -1.35 : -0.35));
      return part.vertex(surface(x, t, face, lift * (column === 0 ? 1.3 : 0.76)), color);
    });
    if (previous) {
      for (let i = 0; i < 2; i += 1) {
        part.triangle(previous[i], row[i], row[i + 1], face === -1);
        part.triangle(previous[i], row[i + 1], previous[i + 1], face === -1);
      }
    }
    previous = row;
  }
}

export function buildWing(species: RaptorSpecies, profile: Profile, p: Palette, lod: BirdLod): Part {
  const part = new Part();
  const surface = wingSurface(profile);
  const ink = wingPigment(species, p);
  const spanSteps = [44, 24, 12][lod];
  const crossSteps = [24, 16, 10][lod];
  const root: WingStation = profile.wing.stations[0];
  const cap = part.vertex([-profile.wingspan * 0.018, 0, (root[1] + root[2]) * 0.5], p.back);
  let previous = [cap];
  for (let row = 0; row <= spanSteps; row += 1) {
    const u = row / spanSteps;
    const count = row === spanSteps ? 1 : crossSteps;
    const ring = Array.from({ length: count }, (_, j) => {
      const a = TAU * j / count;
      const chord = (1 - Math.cos(a)) * 0.5;
      const face = a <= Math.PI ? 1 : -1;
      return part.vertex(surface(u, chord, face), ink(u, chord, face));
    });
    part.bridge(previous, ring);
    previous = ring;
  }
  const kestrel = species === 'kestrel';
  const layerLift = profile.wingspan * [0.0009, 0.0018, 0.0024][lod];
  const count = [18, 11, 5][lod];
  for (let i = 0; i < count; i += 1) {
    const endU = 0.098 + 0.852 * i / (count - 1);
    const startU = endU * (kestrel ? 0.73 : 0.79);
    const width = (kestrel ? 0.36 : 0.41) / count * (1 - 0.25 * endU);
    const phase = i * 0.031 + 0.067 * Math.sin(i * 1.73);
    wingRibbon(part, surface, ink, p, 1, lod, startU, endU, 0.36 - 0.11 * endU, 0.985,
      width, layerLift, false, phase, species);
    if (lod < 2) {
      wingRibbon(part, surface, ink, p, -1, lod, startU, endU, 0.36 - 0.11 * endU, 0.985,
        width, layerLift * 1.09, false, phase + 0.12, species);
    }
  }
  if (lod < 2) {
    const covertCount = lod === 0 ? 11 : 8;
    for (let i = 0; i < covertCount; i += 1) {
      const u = 0.085 + i / (covertCount - 1) * (kestrel ? 0.59 : 0.79);
      wingRibbon(part, surface, ink, p, 1, lod, u * 0.87, u, 0.10, 0.51,
        (kestrel ? 0.30 : 0.35) / covertCount, layerLift * 1.38, true, i * 0.076, species);
    }
  }
  return part;
}

export function buildTail(species: RaptorSpecies, profile: Profile, p: Palette, lod: BirdLod): Part {
  const part = new Part();
  const { lengthZ, endY, halfWidth, edgeShortening } = profile.tail;
  const kestrel = species === 'kestrel';
  const count = [9, 7, 5][lod];
  const samples = kestrel
    ? [0, 0.33, 0.63, 0.758, 0.793, 0.93, 0.968, 1]
    : lod === 2 ? [0, 0.38, 0.49, 0.66, 0.80, 1] : [0, 0.23, 0.34, 0.46, 0.54, 0.67, 0.75, 0.89, 0.96, 1];
  for (let i = 0; i < count; i += 1) {
    const spread = (2 * i) / (count - 1) - 1;
    const edge = Math.abs(spread);
    const shorten = 1 - edgeShortening * edge ** (kestrel ? 1.4 : 2.2);
    const ribs = samples.map((s): Rib => {
      const x = halfWidth * spread * mix(0.31, 0.78, s ** 0.74);
      const y = endY * s - halfWidth * 0.082 * edge * s;
      const z = lengthZ * shorten * s;
      const width = halfWidth * (1.13 / count) * (s === 1 ? 0.75 : mix(0.80, 1.22, Math.sin(Math.PI * s ** 1.12)));
      const depth = halfWidth * (s === 1 ? 0.011 : mix(0.071, 0.019, s));
      let color: Rgb;
      if (kestrel) {
        color = tint(TAIL_SLATE, TAIL_BAND, smooth(0.758, 0.793, s) * (1 - smooth(0.930, 0.968, s)));
        if (s >= 0.968) color = tint(color, p.face, smooth(0.968, 1, s) * 0.64);
      } else {
        const bar = lod === 2 ? (s === 0.49 || s === 0.80 ? 1 : 0.20)
          : smooth(-0.17, 0.79, Math.cos(TAU * (3.8 * s - 0.285 + 0.055 * edge)));
        color = tint(tint(p.flight, p.flank, 0.41), p.ink, bar * 0.79);
      }
      return [[x, y, z], width, depth, shade(color, 1.04 - 0.16 * edge)];
    });
    sweep(part, ribs, [8, 6, 4][lod], [1, 0, 0], (c, a) => shade(c, 0.89 + 0.14 * Math.sin(a)));
  }
  return part;
}

export function buildFoot(species: RaptorSpecies, profile: Profile, p: Palette, lod: BirdLod): Part {
  const part = new Part();
  const { pivot, reach, spread, thickness: r } = profile.foot;
  const floor = -pivot[1];
  const kestrel = species === 'kestrel';
  const pads = kestrel ? p.feet : tint(p.feet, p.horn, 0.29);
  const digitSides = [8, 6, 4][lod];
  const trouser = tint(p.flank, p.breast, kestrel ? 0.35 : 0.46);
  const shank: Rib[] = [
    [[kestrel ? 0 : -0.44 * r, pivot[1] * 0.28, 0.007], r * (kestrel ? 3.03 : 2.77), r * (kestrel ? 2.16 : 2.58), trouser],
    [[kestrel ? 0 : -0.20 * r, -pivot[1] * (kestrel ? 0.46 : 0.34), 0.005],
      r * (kestrel ? 1.23 : 2.11), r * (kestrel ? 1.19 : 1.88), trouser],
    [[kestrel ? 0 : 0.08 * r, floor + r * (kestrel ? 1.3 : 1.57), -r * 0.11],
      r * (kestrel ? 1.34 : 1.43), r * (kestrel ? 1.39 : 1.51), kestrel ? p.feet : tint(trouser, p.feet, 0.27)],
    [[0, floor + r * 0.70, -r * 0.69], r * 1.23, r * 0.93, pads],
  ];
  if (kestrel) shank.splice(2, 0, [[0, -pivot[1] * 0.51, 0.003], r * 0.96, r * 0.94, p.feet]);
  sweep(part, shank, [10, 7, 5][lod], [1, 0, 0], (c, a) => shade(c,
    0.94 + 0.065 * Math.cos(a) + (kestrel ? 0 : 0.068 * Math.sin(4 * a) - 0.055 * Math.cos(2 * a))), floor);
  // Owl digits are shown two forward and two back; kestrel has three forward.
  const digits = kestrel ? [[-0.72, -0.74], [0.02, -1], [0.78, -0.67], [0.21, 0.70]]
    : [[-0.77, -0.74], [0.52, -1], [0.94, 0.47], [-0.59, 0.64]];
  const horn = shade(p.horn, 0.82);
  for (let i = 0; i < digits.length; i += 1) {
    const [dx, dz] = digits[i];
    const point = (s: number, y: number): Vec => [dx * spread * s, floor + y, dz * reach * s - r * 0.36];
    const w = r * (i === 1 ? 0.81 : 0.68);
    const ribs: Rib[] = [
      [point(0.04, r * 1.16), w, r * 0.77, pads],
      [point(0.44, r * 0.59), w * 0.96, r * 0.85, p.feet],
      [point(0.72, r * 0.71), w * 0.77, r * 0.56, pads],
      [point(0.94, r * 0.87), w * 0.51, r * 0.50, horn],
      [point(1.15, r * 0.14), 0, 0, horn],
    ];
    if (lod === 0) {
      ribs.splice(3, 0, [point(0.83, r * 0.76), w * 0.64, r * 0.52, pads]);
      ribs.splice(-1, 0, [point(1.055, r * 0.57), w * 0.32, r * 0.30, horn]);
    }
    sweep(part, ribs, digitSides, [1, 0, 0], (c, a) => shade(c, 0.92 + 0.13 * Math.sin(a)), floor);
  }
  return part;
}
