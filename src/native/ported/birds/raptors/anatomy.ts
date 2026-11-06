
import type { BirdLod } from '../rig-core/contract.ts';
import { Part, ellipsoid, medallion, rgb, shade, skin, smooth, sweep, tint } from './mesh.ts';
import type { Rgb, Surface, Vec } from './mesh.ts';
import type { Profile, RaptorSpecies } from './profiles.ts';

export type Palette = { [K in keyof Profile['plumage']]: Rgb };
export const palette = (profile: Profile): Palette => Object.fromEntries(
  Object.entries(profile.plumage).map(([key, value]) => [key, rgb(value)]),
) as Palette;

const SHELL_STEPS = [[32, 20], [22, 14], [14, 9]] as const;
const DARK_EYE = rgb('#161314');
const IVORY = rgb('#dacfc0');
const CERE = rgb('#d7a34c');

function plumage(color: Rgb, u: number, v: number): Rgb {
  const grain = Math.sin(7 * u + 3 * Math.sin(v * 8)) * Math.cos(12 * v)
    + 0.38 * Math.cos(22 * u - 19 * v);
  return shade(color, 1 + 0.075 * grain);
}

type Ink = (u: number, v: number) => Rgb;
const sample = (row: number, col: number) => {
  const value = Math.sin((row + 3) * 13.263 + (col + 8) * 21.53) * 43758.5453;
  return value - Math.floor(value);
};

/** A tapered feather mark, projected onto the body instead of floating on a plane. */
function mark(
  part: Part, surface: Surface, steps: number, ink: Ink, pigment: Rgb,
  u: number, v: number, width: number, height: number, lean: number, lift: number,
  broken = 0,
): void {
  const xy = (r: number, a: number): [number, number] => {
    const y = r * Math.sin(a);
    const x = r * Math.cos(a);
    const edge = 1 + broken * 0.16 * Math.sin(5 * a + 8 * broken);
    return [u + edge * width * x * (0.88 + 0.33 * y) + lean * y + broken * 0.024 * Math.sin(4 * y),
      v + height * y];
  };
  medallion(part, steps, [0.63, 1],
    (r, a) => surface(...xy(r, a), lift),
    (r, a) => {
      const pigmentGrain = broken * r * (0.13 * Math.sin(6 * a + 2 * broken) - 0.08 * Math.cos(3 * a));
      return tint(shade(pigment, 1 + pigmentGrain), ink(...xy(r, a)), smooth(0.48 + broken * 0.17, 1, r));
    },
  );
}

export function buildBody(species: RaptorSpecies, profile: Profile, p: Palette, lod: BirdLod): Part {
  const part = new Part();
  const { center, radii, pitch } = profile.body;
  const shell = ellipsoid(center, radii, pitch);
  const kestrel = species === 'kestrel';
  const eagle = species === 'eagle-owl';
  // Pull the upper contour into the head pivot; the neck does not add a mesh or a pose joint.
  const surface: Surface = (u, v, lift) => {
    const [x, y, z] = shell(u, v, lift);
    const nape = smooth(0.39, 1.48, v);
    const keel = kestrel ? 1 - 0.13 * smooth(-0.26, -1.40, v) : 1;
    const ruff = kestrel ? 0 : smooth(-0.43, -1.49, v) * (0.8 + 0.2 * Math.sin(u) ** 2);
    return [x * keel * (1 + 0.12 * ruff) * (1 - (kestrel ? 0.11 : 0.05) * nape),
      y + nape * (kestrel ? 0.009 : radii[1] * 0.037) - radii[1] * 0.134 * ruff,
      z - nape * (kestrel ? 0.026 : radii[2] * 0.075) - radii[2] * 0.128 * ruff];
  };
  const ink: Ink = (u, v) => {
    const dorsality = -Math.cos(u) + 0.25 * Math.sin(v);
    const coat = tint(tint(p.breast, p.flank, smooth(-0.91, 0.04, dorsality)), p.back,
      smooth(-0.14, 0.71, dorsality));
    const shoulder = smooth(0.20, 0.92, Math.abs(Math.sin(u))) * smooth(-1.03, 0.2, v);
    const belly = (1 - smooth(0.05, 0.69, v)) * smooth(0.10, 0.84, Math.cos(u));
    const bars = smooth(0.18, 0.89, Math.cos((eagle ? 32 : 36) * v + 1.02 * Math.sin(8 * u) + 0.63 * Math.cos(21 * u)));
    const scutes = kestrel ? 0 : (0.23 * shoulder + 0.14 * belly) * bars;
    const variegated = kestrel ? 1 : 1 + 0.125 * Math.cos(16 * u + 2.2 * Math.sin(9 * v)) * Math.cos(21 * v - 0.6 * u);
    return plumage(shade(tint(coat, p.ink, scutes), variegated), u, v);
  };
  skin(part, surface, SHELL_STEPS[lod][0], SHELL_STEPS[lod][1], ink);
  const lift = radii[0] * 0.027;
  const steps = [10, 7, 5][lod];
  const rows = eagle ? [4, 4, 3][lod] : [5, 4, 3][lod];
  const cols = lod === 0 ? 7 : 5;
  for (let row = 0; row < rows; row += 1) {
    const rowStep = 1.38 / (rows - 1);
    const v = 0.66 - row * rowStep;
    for (let col = 0; col < cols; col += 1) {
      const shift = sample(row, col);
      const feather = sample(col + 4, row + 1);
      const tone = sample(row + 10, col + 6);
      if (!kestrel && lod === 0 && shift < 0.14 && Math.abs(col - 3) > 1) continue;
      const u = (col - (cols - 1) * 0.5) * 2.36 / cols + (row % 2 ? 0.12 : -0.072);
      const uu = u + (shift - 0.5) * (kestrel ? 0.071 : 0.132);
      const vv = v + (feather - 0.5) * rowStep * (kestrel ? 0.09 : 0.13);
      const strength = kestrel ? 0.74 + 0.15 * tone : (eagle ? 0.59 : 0.42) + 0.34 * tone;
      const length = Math.min(0.425 * rowStep, (eagle ? 0.221 : kestrel ? 0.114 : 0.143) * (0.60 + 0.64 * feather));
      const width = (eagle ? 0.073 : kestrel ? 0.092 : 0.046) * (0.67 + 0.75 * shift);
      mark(part, surface, steps, ink, tint(ink(uu, vv), p.ink, strength),
        uu, vv, width, length, 0.081 * u + (tone - 0.5) * (kestrel ? 0.052 : 0.091), lift,
        kestrel ? 0 : 0.37 + 0.58 * feather);
    }
  }
  const backRows = lod === 0 ? 3 : 2;
  const backCols = lod === 2 ? 3 : 5;
  for (let row = 0; row < backRows; row += 1) {
    for (let col = 0; col < backCols; col += 1) {
      const u = Math.PI + (col - (backCols - 1) * 0.5) * 2.27 / backCols + (row % 2 ? 0.23 : -0.11);
      const v = -0.54 + row * (1.09 / (backRows - 1)) + 0.11 * Math.cos(col * 4.4 + row);
      const dark = tint(p.ink, p.back, kestrel ? 0.06 : 0.33);
      const fleck = sample(col + 5, row + 7);
      mark(part, surface, lod === 2 ? 4 : steps, ink, dark, u, v, kestrel ? 0.128 : 0.094 + 0.039 * fleck,
        kestrel ? 0.15 : 0.16 + 0.10 * fleck, 0.067 * Math.sin(u * 6 + v), lift,
        kestrel ? 0 : 0.24 + 0.61 * fleck);
    }
  }
  return part;
}

function tawnyDisc(part: Part, surface: Surface, p: Palette, lod: BirdLod, base: Ink): void {
  const angles = (r: number, a: number): [number, number] => {
    const d = r * (1 + smooth(0.65, 1, r) * (0.018 * Math.sin(11 * a) + 0.010 * Math.cos(23 * a)));
    const x = d * Math.cos(a);
    const y = d * Math.sin(a);
    const notch = Math.max(0, y) * 0.19 * Math.exp(-10 * x * x);
    return [1.17 * x * (0.94 + y * 0.08), -0.09 + 0.96 * y - notch];
  };
  medallion(part, [40, 32, 22][lod], [0.24, 0.48, 0.69, 0.79, 0.88, 0.95, 1],
    (r, a) => surface(...angles(r, a), 0.0018), (r, a) => {
      const [u, v] = angles(r, a);
      const eyeAngle = Math.atan2(v - 0.1, Math.abs(u) - 0.51);
      const fan = 0.105 * Math.cos(19 * eyeAngle + 0.78 * Math.sin(6 * eyeAngle)) * smooth(0.20, 0.84, r);
      const pale = tint(p.face, p.breast, 0.29 + 0.17 * Math.sin(a));
      const rim = smooth(0.64, 0.90, r) * (1 - smooth(0.88, 1, r));
      return tint(shade(tint(pale, p.rim, rim * (0.57 + 0.20 * Math.cos(6 * a))), 1 + fan),
        base(u, v), smooth(0.88, 1, r));
    },
  );
}

function eagleFace(part: Part, surface: Surface, p: Palette, lod: BirdLod, base: Ink): void {
  for (const side of [-1, 1]) {
    medallion(part, [22, 16, 10][lod], [0.36, 0.72, 0.9, 1], (r, a) => {
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      return surface(side * 0.52 + 0.47 * x, -0.095 + 0.65 * y + 0.22 * side * x, 0.0022);
    }, (r, a) => {
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      return tint(shade(p.face, 1 + 0.10 * y + 0.092 * Math.cos(13 * a + 0.55 * side)),
        base(side * 0.52 + 0.47 * x, -0.095 + 0.65 * y + 0.22 * side * x), smooth(0.60, 1, r));
    });
    mark(part, surface, [16, 12, 8][lod], base, tint(p.breast, p.face, 0.46),
      side * 0.52, 0.37, 0.39, 0.065, side * 0.31, 0.0036);
  }
}

function kestrelCheeks(part: Part, surface: Surface, p: Palette, lod: BirdLod, base: Ink): void {
  for (const side of [-1, 1]) {
    mark(part, surface, [20, 16, 12][lod], base, tint(p.face, p.breast, 0.28),
      1.11 * side, -0.36, 0.71, 0.62, -0.16 * side, 0.0011);
    mark(part, surface, [13, 10, 8][lod], base, p.rim,
      0.92 * side, -0.30, 0.215, 0.50, -0.12 * side, 0.0019);
  }
}

function eyes(part: Part, surface: Surface, species: RaptorSpecies, p: Palette, lod: BirdLod): Vec {
  const kestrel = species === 'kestrel';
  const eagle = species === 'eagle-owl';
  const azimuth = kestrel ? 1.06 : eagle ? 0.50 : 0.52;
  const elevation = kestrel ? 0.075 : eagle ? 0.10 : 0.12;
  const width = kestrel ? 0.233 : eagle ? 0.206 : 0.196;
  const height = kestrel ? 0.191 : eagle ? 0.189 : 0.195;
  const lift = kestrel ? 0.0021 : eagle ? 0.0042 : 0.0035;
  const dome = kestrel ? 0.0014 : eagle ? 0.0039 : 0.0023;
  const iris = eagle ? rgb('#d97724') : kestrel ? rgb('#443123') : rgb('#30211e');
  const irisEdge = eagle ? rgb('#a24514') : kestrel ? rgb('#2e221e') : rgb('#221815');
  for (const side of [-1, 1]) {
    const center = side * azimuth;
    medallion(part, [24, 16, 10][lod], [0.43, 0.51, 0.67, 0.82, 0.94, 1], (r, a) => {
      return surface(center + width * r * Math.cos(a), elevation + height * r * Math.sin(a),
        lift + dome * (1 - r * r));
    }, (r, a) => {
      const pigment = tint(iris, irisEdge, smooth(0.66, 0.89, r));
      const gloss = 1 + 0.13 * Math.sin(a - 0.4) + (eagle ? 0.09 * Math.cos(17 * a) : 0);
      if (r >= 0.94) return kestrel ? shade(CERE, 1.04 - (r === 1 ? 0.23 : 0)) : tint(irisEdge, p.rim, r === 1 ? 0.95 : 0.50);
      const pupil = eagle ? 0.47 : 0.56;
      return tint(DARK_EYE, shade(pigment, gloss), smooth(pupil - 0.035, pupil + 0.048, r));
    });
    medallion(part, [10, 8, 6][lod], [1], (r, a) => surface(
      center - width * 0.22 + width * 0.13 * r * Math.cos(a),
      elevation + height * 0.28 + height * 0.115 * r * Math.sin(a),
      lift + dome * 1.04,
    ), () => shade(IVORY, 0.88));
  }
  const eye = surface(azimuth, elevation, lift + dome);
  return [0, eye[1], eye[2]];
}

function beak(part: Part, species: RaptorSpecies, p: Palette, lod: BirdLod): void {
  const sides = [12, 8, 6][lod];
  const glaze = (c: Rgb, a: number) => shade(c, 0.94 - 0.17 * Math.sin(a) + 0.085 * Math.cos(2 * a));
  if (species === 'kestrel') {
    sweep(part, [
      [[0, -0.001, -0.039], 0.011, 0.009, shade(CERE, 0.78)],
      [[0, 0.000, -0.048], 0.010, 0.008, CERE],
      [[0, -0.004, -0.056], 0.0084, 0.006, p.horn],
      [[0, -0.010, -0.062], 0.0050, 0.004, shade(p.horn, 0.90)],
      [[0, -0.017, -0.064], 0.0025, 0.0023, shade(p.horn, 0.76)],
      [[0, -0.024, -0.061], 0, 0, shade(p.horn, 0.69)],
    ], sides, [1, 0, 0], glaze);
    return;
  }
  const eagle = species === 'eagle-owl';
  const scale = eagle ? 1.52 : 1;
  const base = eagle ? -0.084 : -0.063;
  sweep(part, [
    [[0, -0.018 * scale, base + 0.009], 0.013 * scale, 0.013 * scale, p.rim],
    [[0, -0.021 * scale, base - 0.005], 0.011 * scale, 0.010 * scale, p.horn],
    [[0, -0.029 * scale, base - 0.016 * scale], 0.007 * scale, 0.007 * scale, p.horn],
    [[0, -0.039 * scale, base - 0.021 * scale], 0.004 * scale, 0.0035 * scale, shade(p.horn, 0.86)],
    [[0, -0.049 * scale, base - 0.019 * scale], 0, 0, shade(p.horn, 0.74)],
  ], sides, [1, 0, 0], glaze);
}

function eagleTufts(part: Part, p: Palette, lod: BirdLod): void {
  const sides = [10, 7, 5][lod];
  for (const side of [-1, 1]) {
    sweep(part, [
      [[side * 0.070, 0.076, -0.005], 0.029, 0.020, p.crown],
      [[side * 0.081, 0.114, -0.006], 0.025, 0.013, tint(p.ink, p.crown, 0.47)],
      [[side * 0.100, 0.153, 0.002], 0.014, 0.006, tint(p.ink, p.crown, 0.34)],
      [[side * 0.125, 0.187, 0.015], 0, 0, p.ink],
    ], sides, [1, 0, 0], (c, a) => tint(c, p.face,
      0.47 * smooth(-0.13, 0.94, -Math.sin(a) - 0.22 * side * Math.cos(a))));
    if (lod < 2) {
      sweep(part, [
        [[side * 0.066, 0.083, -0.016], 0.017, 0.011, p.crown],
        [[side * 0.073, 0.122, -0.018], 0.011, 0.006, tint(p.crown, p.face, 0.33)],
        [[side * 0.087, 0.155, -0.009], 0, 0, p.ink],
      ], sides, [1, 0, 0], (c, a) => tint(c, p.face, 0.22 * smooth(-0.24, 0.85, -Math.sin(a))));
    }
  }
}

export function buildHead(species: RaptorSpecies, profile: Profile, p: Palette, lod: BirdLod): { part: Part; eye: Vec } {
  const part = new Part();
  const { center, radii, pitch, crown } = profile.head;
  const surface = ellipsoid(center, radii, pitch, crown);
  const base: Ink = (u, v) => {
    const cheek = smooth(-0.1, -0.73, v) * smooth(-0.50, 0.47, Math.cos(u));
    const brow = smooth(-0.13, 0.66, v) * smooth(-0.43, 0.85, Math.cos(u));
    const patterned = species === 'kestrel' ? 0.14 : 0.42;
    const fleck = smooth(0.32, 0.95, Math.cos(18 * u + 1.2 * Math.sin(15 * v)) * Math.cos(19 * v + 3 * u));
    const crown = tint(p.crown, p.flank, patterned * fleck * (0.6 + 0.4 * brow));
    return plumage(tint(crown, p.face, cheek * 0.61), u + 0.14, v);
  };
  skin(part, surface, SHELL_STEPS[lod][0], SHELL_STEPS[lod][1], base);
  if (species === 'tawny-owl') tawnyDisc(part, surface, p, lod, base);
  else if (species === 'eagle-owl') {
    eagleFace(part, surface, p, lod, base);
    eagleTufts(part, p, lod);
  } else kestrelCheeks(part, surface, p, lod, base);
  const eye = eyes(part, surface, species, p, lod);
  beak(part, species, p, lod);
  return { part, eye };
}
