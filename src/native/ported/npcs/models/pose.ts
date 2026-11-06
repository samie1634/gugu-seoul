import type { NpcKind, NpcState } from '../src/contracts.ts';
import { PROFILES } from '../src/profiles.ts';

export const SHAPES = ['round', 'block', 'taper', 'point'] as const;
export type Shape = (typeof SHAPES)[number];
export type PoseInput = Pick<NpcState, 'kind' | 'variant' | 'action' | 'speed' | 'gaitDistance' | 'age' | 'bodyScale'>;
export type BodyRegion = 'torso' | 'head' | 'limbs' | 'tail';
type AnchorName = 'body' | 'eye' | 'voice';
type Anchor = readonly [x: number, y: number, z: number];

export interface Painter {
  region?(region: BodyRegion): void;
  anchor?(name: AnchorName, x: number, y: number, z: number): void;
  part(shape: Shape, x: number, y: number, z: number, w: number, h: number, d: number,
    color: number, pitch?: number, yaw?: number, roll?: number): void;
  link(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    width: number, depth: number, color: number): void;
}

const TAU = 2 * Math.PI;
const SIDES = [-1, 1] as const;
const HUMAN_SCALE = [0.987, 1.065, 0.924, 0.998, 0.952, 1.018, 0.938, 1.006];
const ANIMAL_SCALE = [0.96, 1, 0.93, 0.98, 0.95, 0.99, 0.94, 0.97];
const CLOTHES = [0x627383, 0x905f50, 0x55786f, 0x555977, 0x856b50, 0x69795a, 0x8e777e, 0x4c6571];
const PANTS = [0x383e46, 0x44464a, 0x484e57, 0x383d49, 0x484a40, 0x424851, 0x48404c, 0x383e3e];
const CAPS = [0x34424f, 0x624940, 0x3e514a, 0x404055, 0x674f3e, 0x434e38, 0x58464c, 0x34454e];
const CLAY = [0xc7a590, 0xb68d72, 0xd6b89d, 0xbd9a82, 0xa9826c, 0xc7a590, 0xd0ad98, 0xc09a81];
const SOLE = 0x30333a;

function sizeVariant(s: PoseInput): number {
  return (s.kind === 'human' ? HUMAN_SCALE : ANIMAL_SCALE)[s.variant];
}

export function variantScale(s: PoseInput): number { return sizeVariant(s) * s.bodyScale; }

function wave(age: number, period: number): number {
  return Math.sin((age % period) / period * TAU);
}

function cycle(s: PoseInput): number {
  const stride = PROFILES[s.kind].stride * s.bodyScale;
  return (s.gaitDistance % stride) / stride;
}

function pace(s: PoseInput): number {
  return s.speed <= 0.025 * s.bodyScale ? 0 : Math.min(1, s.speed / (PROFILES[s.kind].walkSpeed * s.bodyScale));
}

// During steady straight walking, the sole moves back by the root's travelled
// distance during stance. Crouch, turning and terrain have no world-space IK.
const STANCE = 0.58;
function reach(s: PoseInput): number { return PROFILES[s.kind].stride * STANCE * 0.5 / sizeVariant(s); }
function footZ(p: number): number {
  if (p < STANCE) return 2 * p / STANCE - 1;
  const t = (p - STANCE) / (1 - STANCE);
  return 1 - 2 * t * t * (3 - 2 * t);
}
function footY(p: number): number {
  return p < STANCE ? 0 : Math.sin(Math.PI * (p - STANCE) / (1 - STANCE)) ** 2;
}

function shoePitch(p: number): number {
  if (p < 0.13) return 0.18 * (1 - p / 0.13) ** 2;
  if (p < 0.39) return 0;
  if (p < STANCE) return -0.24 * ((p - 0.39) / (STANCE - 0.39)) ** 2;
  const t = (p - STANCE) / (1 - STANCE);
  return -0.24 + 0.42 * t * t * (3 - 2 * t);
}

function hipCeiling(az: number, by: number, bz: number, length: number): number {
  return by + Math.sqrt(Math.max(0, length * length - (bz - az) ** 2));
}

// Two links in the sagittal plane, with the bend toward front (+1) or back (-1).
function hinge(ay: number, az: number, by: number, bz: number, length: number, share: number, side: number, floor = 0) {
  const dy = by - ay;
  const dz = bz - az;
  const d = Math.max(0.000001, Math.hypot(dy, dz));
  const upper = length * share;
  const lower = length - upper;
  const along = Math.max(0, Math.min(d, (d * d + upper * upper - lower * lower) / (2 * d)));
  const centerY = ay + dy * along / d;
  let across = side * Math.sqrt(Math.max(0, upper * upper - along * along));
  const bendY = -dz * across / d;
  if (bendY < 0) across *= Math.min(1, Math.max(0, (centerY - floor) / -bendY));
  return [Math.max(floor, centerY - dz * across / d), az + (dz * along + dy * across) / d] as const;
}

function headYaw(s: PoseInput): number {
  const side = s.variant % 2 === 0 ? 1 : -1;
  switch (s.action) {
    case 'look': return side * (0.36 + 0.19 * wave(s.age, 2.3));
    case 'avoid': return side * -0.23;
    case 'startle': return side * 0.16;
    default: return 0.045 * wave(s.age, 3.8);
  }
}

function headPoint(hy: number, hz: number, yaw: number, pitch: number, x: number, y: number, z: number): Anchor {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const pz = y * sp + z * cp;
  return [x * cy + pz * sy, hy + y * cp - z * sp, hz + pz * cy - x * sy];
}

function headPart(out: Painter, hy: number, hz: number, yaw: number, pitch: number,
  shape: Shape, x: number, y: number, z: number, w: number, h: number, d: number,
  color: number, tilt = 0, roll = 0): void {
  out.part(shape, ...headPoint(hy, hz, yaw, pitch, x, y, z), w, h, d, color, pitch + tilt, yaw, roll);
}

function eyeAnchor(out: Painter, hy: number, hz: number, yaw: number, pitch: number, y: number, z: number): void {
  out.anchor?.('eye', ...headPoint(hy, hz, yaw, pitch, 0, y, z));
}

function mouthPart(out: Painter, hy: number, hz: number, yaw: number, pitch: number,
  shape: 'round' | 'taper', y: number, z: number, w: number, h: number, d: number, color: number): void {
  const forwardTaper = shape === 'taper';
  headPart(out, hy, hz, yaw, pitch, shape, 0, y, z, w, h, d, color, forwardTaper ? -Math.PI / 2 : 0);
  if (!out.anchor) return;
  // Lower front of the jaw/muzzle. The tapered snout's local +Y faces forward.
  const mouthY = forwardTaper ? y - d * 0.16 : y - h * 0.17;
  const mouthZ = forwardTaper ? z - h * 0.47 : z - d * 0.42;
  out.anchor('voice', ...headPoint(hy, hz, yaw, pitch, 0, mouthY, mouthZ));
}

function human(s: PoseInput, out: Painter): void {
  const i = s.variant;
  const phase = cycle(s);
  const moving = pace(s);
  const reachZ = reach(s);
  const legLength = 0.832;
  let hip = 0.875 - (s.action === 'startle' ? 0.047 : s.action === 'avoid' ? 0.025 : 0)
    + 0.014 * moving * Math.cos(phase * TAU * 2);
  const feet = SIDES.map((side) => {
    const p = (phase + (side === 1 ? 0.5 : 0)) % 1;
    const travel = reachZ * moving * footZ(p);
    const lift = 0.082 * moving * footY(p);
    const shoe = moving * shoePitch(p);
    const cs = Math.cos(shoe);
    const sn = Math.sin(shoe);
    // Roll about the lowest sole corner so heel strike and toe off touch the same floor.
    const soleY = lift + 0.037 * cs + 0.0905 * Math.abs(sn);
    const ankleY = soleY + 0.038 * cs - 0.024 * sn;
    const ankleZ = travel + 0.038 * sn + 0.024 * cs;
    hip = Math.min(hip, hipCeiling(0.014, ankleY, ankleZ, legLength) - 0.018);
    return { side, p, travel, soleY, ankleY, ankleZ, shoe };
  });
  const jacket = CLOTHES[i];
  const pants = PANTS[i];
  const clay = CLAY[i];
  const cap = CAPS[i];

  out.region?.('torso');
  out.anchor?.('body', 0, hip, 0.015);
  out.part('round', 0, hip, 0.015, 0.323, 0.235, 0.225, pants);
  // Broader end of the tapered jacket is at the shoulders.
  const twist = 0.066 * moving * Math.sin(phase * TAU);
  out.part('taper', 0, hip + 0.245, 0, 0.447, 0.482, 0.251, jacket, 0, twist, Math.PI);
  out.part('block', -0.107 * Math.sin(twist), hip + 0.276, -0.107 * Math.cos(twist),
    0.058, 0.294, 0.023, cap, 0, twist);
  out.part('taper', 0, hip + 0.516, 0, 0.117, 0.139, 0.114, clay);
  const hy = hip + 0.665;
  const yaw = headYaw(s);
  const pitch = s.action === 'startle' ? 0.15 : s.action === 'look' ? 0.085 : 0;
  out.region?.('head');
  eyeAnchor(out, hy, -0.014, yaw, pitch, 0.027, -0.081);
  headPart(out, hy, -0.014, yaw, pitch, 'round', 0, 0, 0, 0.176, 0.234, 0.189, clay);
  mouthPart(out, hy, -0.014, yaw, pitch, 'round', -0.044, -0.016, 0.139, 0.133, 0.156, clay);
  headPart(out, hy, -0.014, yaw, pitch, 'round', 0, 0.081, 0.005, 0.21, 0.13, 0.204, cap);
  headPart(out, hy, -0.014, yaw, pitch, 'block', 0, 0.063, -0.071, 0.173, 0.019, 0.109, cap);

  out.region?.('limbs');
  for (const { side, p, travel, soleY, ankleY, ankleZ, shoe } of feet) {
    const x = side * 0.097;
    const hipY = hip + 0.018;
    const [kneeY, kneeZ] = hinge(hipY, 0.014, ankleY, ankleZ, legLength, 0.51, 1);
    out.link(x, hipY, 0.014, x, kneeY, kneeZ, 0.144, 0.150, pants);
    out.link(x, kneeY, kneeZ, x, ankleY, ankleZ, 0.117, 0.113, pants);
    out.part('block', x, soleY, travel, 0.092, 0.074, 0.181, SOLE, shoe);
    const shoulder = side * 0.186;
    const elbow = side * 0.213;
    const wrist = side * 0.214;
    const raise = s.action === 'startle' ? 0.10 : 0;
    const swing = -0.113 * moving * footZ(p);
    out.link(shoulder, hip + 0.429, 0.011, elbow, hip + 0.207 + raise * 0.4, 0.022 + swing * 0.48,
      0.123, 0.125, jacket);
    out.link(elbow, hip + 0.207 + raise * 0.4, 0.022 + swing * 0.48,
      wrist, hip - 0.018 + raise, swing - 0.014, 0.101, 0.099, jacket);
    out.part('round', wrist, hip - 0.026 + raise, swing - 0.014, 0.073, 0.118, 0.076, clay);
  }
}

type Animal = Exclude<NpcKind, 'human'>;
type Mass = readonly [y: number, z: number, w: number, h: number, d: number];
type TailPoint = readonly [x: number, y: number, z: number];
interface Quadruped {
  readonly masses: readonly [Mass, Mass, Mass];
  readonly skull: Mass;
  readonly coat: readonly number[];
  readonly trim: readonly number[];
  readonly legs: readonly [x: number, fy: number, fz: number, hy: number, hz: number];
  readonly foot: readonly [w: number, h: number, d: number];
  readonly lift: number;
  readonly limb: number;
  readonly lengths: readonly [fore: number, hind: number];
  readonly hindPhase: number;
  readonly tail: readonly TailPoint[];
  readonly tailWidths: readonly number[];
  readonly wag: number;
}
const RIGS: Readonly<Record<Animal, Quadruped>> = {
  dog: {
    masses: [[0.405, 0.025, 0.263, 0.265, 0.439], [0.443, -0.138, 0.261, 0.271, 0.234],
      [0.380, 0.125, 0.240, 0.210, 0.220]],
    skull: [0.576, -0.179, 0.187, 0.171, 0.185],
    coat: [0xc49a69, 0x927052, 0x6e635d, 0xcebc9a, 0x9b7e64, 0x7e5a48, 0xb4875d, 0x858284],
    trim: [0x845b42, 0x614c40, 0x514741, 0xa1836a, 0x71564b, 0x594234, 0x876449, 0x58555a],
    legs: [0.087, 0.387, -0.112, 0.35, 0.134], foot: [0.060, 0.048, 0.066],
    lift: 0.065, limb: 0.091, lengths: [0.422, 0.386], hindPhase: 0.25,
    tail: [[0, 0.446, 0.195], [0, 0.482, 0.256], [0, 0.530, 0.316], [0, 0.577, 0.358], [0, 0.625, 0.378]],
    tailWidths: [0.057, 0.044, 0.032, 0.020], wag: 0.091,
  },
  cat: {
    masses: [[0.239, 0.021, 0.155, 0.145, 0.333], [0.255, -0.095, 0.154, 0.171, 0.158],
      [0.234, 0.124, 0.157, 0.165, 0.160]],
    skull: [0.319, -0.134, 0.148, 0.133, 0.135],
    coat: [0xb8a891, 0x666875, 0xba8861, 0x8d857d, 0xb9aaa4, 0x686767, 0x9d8271, 0xc0ad82],
    trim: [0x8b7666, 0x4d5060, 0x905f45, 0x6c6560, 0x927b76, 0x4c4c52, 0x745b54, 0x96805f],
    legs: [0.055, 0.242, -0.093, 0.226, 0.113], foot: [0.042, 0.034, 0.048],
    lift: 0.048, limb: 0.049, lengths: [0.263, 0.252], hindPhase: 0.19,
    tail: [[0, 0.249, 0.166], [0.008, 0.298, 0.224], [0.018, 0.364, 0.262],
      [0.034, 0.439, 0.271], [0.049, 0.483, 0.234]],
    tailWidths: [0.036, 0.031, 0.025, 0.019], wag: 0.038,
  },
  rat: {
    masses: [[0.093, 0.022, 0.095, 0.120, 0.150], [0.094, -0.031, 0.080, 0.082, 0.088],
      [0.096, 0.058, 0.092, 0.102, 0.083]],
    skull: [0.127, -0.052, 0.089, 0.079, 0.081],
    coat: [0x7c7671, 0x6b6563, 0x917f73, 0xa19283, 0x77737c, 0x736962, 0x8a8582, 0x857269],
    trim: [0xb19088, 0xa98582, 0xbf9a88, 0xbe9f93, 0xaf8c8e, 0xac8c86, 0xb79d99, 0xb59288],
    legs: [0.027, 0.068, -0.029, 0.061, 0.051], foot: [0.022, 0.016, 0.027],
    lift: 0.021, limb: 0.026, lengths: [0.105, 0.103], hindPhase: 0.44,
    tail: [[0, 0.083, 0.082], [0.010, 0.057, 0.118], [0.022, 0.035, 0.154],
      [0.035, 0.020, 0.190], [0.048, 0.018, 0.224], [0.061, 0.022, 0.257]],
    tailWidths: [0.018, 0.015, 0.012, 0.009, 0.006], wag: 0.018,
  },
};

function animalHead(kind: Animal, s: PoseInput, out: Painter, rig: Quadruped, offset: number): void {
  const [y, z, w, h, d] = rig.skull;
  const hy = y + offset;
  const yaw = headYaw(s);
  const pitch = s.action === 'startle' ? 0.17 : s.action === 'avoid' ? -0.085 : 0;
  const coat = rig.coat[s.variant];
  const trim = rig.trim[s.variant];
  out.part('round', 0, hy, z, w, h, d, coat, pitch, yaw);
  if (kind === 'dog') {
    eyeAnchor(out, hy, z, yaw, pitch, 0.020, -0.067);
    mouthPart(out, hy, z, yaw, pitch, 'round', -0.037, -0.079, 0.128, 0.096, 0.132, trim);
    headPart(out, hy, z, yaw, pitch, 'round', 0, -0.027, -0.128, 0.064, 0.046, 0.031, 0x443b37);
    for (const side of SIDES) {
      headPart(out, hy, z, yaw, pitch, 'round', side * 0.056, 0.020, -0.067,
        0.022, 0.019, 0.015, 0x352e2b);
      headPart(out, hy, z, yaw, pitch, 'round', side * 0.092, -0.011, 0.023,
        0.066, 0.149, 0.083, trim, 0, side * 0.24);
    }
  } else if (kind === 'cat') {
    eyeAnchor(out, hy, z, yaw, pitch, 0.012, -0.052);
    mouthPart(out, hy, z, yaw, pitch, 'round', -0.024, -0.049, 0.090, 0.054, 0.064, trim);
    headPart(out, hy, z, yaw, pitch, 'round', 0, -0.014, -0.074, 0.032, 0.022, 0.019, 0x67504d);
    for (const side of SIDES) {
      headPart(out, hy, z, yaw, pitch, 'round', side * 0.043, 0.012, -0.052,
        0.019, 0.014, 0.014, 0x3e3730);
      headPart(out, hy, z, yaw, pitch, 'point', side * 0.050, 0.052, -0.006,
        0.060, 0.085, 0.063, trim, 0, -side * 0.19);
    }
  } else {
    eyeAnchor(out, hy, z, yaw, pitch, 0.010, -0.027);
    mouthPart(out, hy, z, yaw, pitch, 'taper', -0.010, -0.028, 0.054, 0.061, 0.045, coat);
    headPart(out, hy, z, yaw, pitch, 'round', 0, -0.009, -0.055, 0.023, 0.019, 0.017, trim);
    for (const side of SIDES) {
      headPart(out, hy, z, yaw, pitch, 'round', side * 0.029, 0.010, -0.027,
        0.011, 0.010, 0.010, 0x3b3230);
      headPart(out, hy, z, yaw, pitch, 'round', side * 0.035, 0.026, 0.005,
        0.039, 0.039, 0.024, trim, -0.09, -side * 0.19);
    }
  }
}

function animal(kind: Animal, s: PoseInput, out: Painter): void {
  const rig = RIGS[kind];
  const phase = cycle(s);
  const moving = pace(s);
  const crouch = s.action === 'startle' ? 0.065 : s.action === 'avoid' ? 0.042 : 0;
  const h = PROFILES[kind].height;
  let offset = h * (moving * 0.010 * Math.cos(phase * TAU * 2) - crouch);
  const coat = rig.coat[s.variant];
  const trim = rig.trim[s.variant];
  const [x, fy, fz, hy, hz] = rig.legs;
  const [fw, fh, fd] = rig.foot;
  const reachZ = reach(s);
  const quick = s.action === 'startle' && s.speed >= 1.4 * PROFILES[kind].walkSpeed * s.bodyScale;
  const hindPhase = quick && kind !== 'rat' ? 0.5 : rig.hindPhase;
  const feet = SIDES.flatMap((side) => SIDES.map((end) => {
    const hind = end === 1;
    const p = (phase + (side === 1 ? 0.5 : 0) + (hind ? hindPhase : 0)) % 1;
    const lift = rig.lift * moving * footY(p);
    const ay = hind ? hy : fy;
    const az = hind ? hz : fz;
    const bx = side * x;
    const by = fh * 0.78 + lift;
    const bz = az + reachZ * moving * footZ(p);
    const length = rig.lengths[hind ? 1 : 0];
    offset = Math.min(offset, hipCeiling(az, by, bz, length) - ay);
    return { ay, az, bx, by, bz, lift, length, hind };
  }));
  out.region?.('torso');
  out.anchor?.('body', 0, rig.masses[0][0] + offset, rig.masses[0][1]);
  for (const [y, z, w, bh, d] of rig.masses) out.part('round', 0, y + offset, z, w, bh, d, coat);
  out.region?.('head');
  animalHead(kind, s, out, rig, offset);
  out.region?.('limbs');
  for (const { ay, az, bx, by, bz, lift, length, hind } of feet) {
    const [ky, kz] = hinge(ay + offset, az, by, bz, length, hind ? 0.50 : 0.44, hind ? 1 : -1,
      kind === 'rat' ? rig.limb * 0.62 : 0);
    out.link(bx, ay + offset, az, bx, ky, kz, rig.limb, rig.limb, coat);
    out.link(bx, ky, kz, bx, by, bz, rig.limb * 0.75, rig.limb * 0.75, trim);
    out.part('block', bx, fh * 0.5 + lift, bz - fd * 0.12, fw, fh, fd, trim);
  }

  out.region?.('tail');
  const side = s.variant % 2 === 0 ? 1 : -1;
  const wag = rig.wag * wave(s.age, kind === 'dog' ? 1.03 : 2.15);
  const n = rig.tail.length - 1;
  let [ax, ay, az] = rig.tail[0];
  ay += offset;
  for (let j = 1; j <= n; j++) {
    const [tx, ty, tz] = rig.tail[j];
    const fraction = j / n;
    const bx = side * tx + wag * fraction * fraction;
    const by = ty + offset * (kind === 'rat' ? 1 - fraction : 1);
    const width = rig.tailWidths[j - 1];
    out.link(ax, ay, az, bx, by, tz, width, width, trim);
    ax = bx;
    ay = by;
    az = tz;
  }
}

// Every pose of a kind emits the same shape counts, including idle and variant 0.
export function paintPose(s: PoseInput, out: Painter): void {
  if (s.kind === 'human') human(s, out);
  else animal(s.kind, s, out);
}

type PoseAnchors = Readonly<Record<'sole' | AnchorName, Anchor>>;

/** Posed offsets before variant size, world scale, heading, or feet translation. */
export function poseAnchors(pose: PoseInput): PoseAnchors {
  const sole: Anchor = [0, 0, 0];
  const points: Record<AnchorName, Anchor> = { body: sole, eye: sole, voice: sole };
  paintPose(pose, {
    part() {},
    link() {},
    anchor(name, x, y, z) { points[name] = [x, y, z]; },
  });
  return { sole, ...points };
}

/** Neutral reference points in native metres for the selected variant. */
export function nativeAnchors(kind: NpcKind, variant = 1): PoseAnchors {
  if (!Number.isInteger(variant) || variant < 0 || variant > 7) throw new RangeError('Invalid model variant');
  const pose = { kind, variant, action: 'idle', age: 0, speed: 0, gaitDistance: 0, bodyScale: 1 } as const;
  const scale = variantScale(pose);
  const { sole, body, eye, voice } = poseAnchors(pose);
  const scaled = ([x, y, z]: Anchor): Anchor => [x * scale, y * scale, z * scale];
  return { sole, body: scaled(body), eye: scaled(eye), voice: scaled(voice) };
}
