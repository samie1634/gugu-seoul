import * as THREE from 'three';
import type { BirdBuildOptions, BirdLod, BirdModel, BirdPivots } from '../rig-core/contract.ts';
import { formNormal, formPoint, Part, type Form, type Point } from './geometry.ts';
import { profiles, type Profile, type UrbanSpecies } from './profiles.ts';

const { lerp, smoothstep } = THREE.MathUtils;
const color = (value: string) => new THREE.Color(value);
const blend = (a: THREE.Color, b: THREE.Color, t: number) => new THREE.Color().lerpColors(a, b, t);
const ink = color('#211e1d');
const cheek = color('#eee8dc');
const crown = color('#804832');
const neckGreen = color('#4d765f');
const neckViolet = color('#71607c');
const pupil = color('#141518');
const glint = color('#cdd4d6');

interface Swatches {
  back: string; belly: string; head: string; coverts: string; flight: string; tail: string;
  sheen: string; bill: string; foot: string; claw: string; iris: string; roughness: number;
}

const swatches: Record<UrbanSpecies | 'white', Swatches> = {
  pigeon: {
    back: '#788591', belly: '#aaadb2', head: '#68747e', coverts: '#939ca4',
    flight: '#535e68', tail: '#697681', sheen: '#353b43', bill: '#424245',
    foot: '#a56264', claw: '#56444a', iris: '#b57436', roughness: 0.58,
  },
  white: {
    back: '#dfdcd3', belly: '#eee9de', head: '#ebe6dc', coverts: '#ebe9e1',
    flight: '#dad9d5', tail: '#ebe8df', sheen: '#c6c9cc', bill: '#a28280',
    foot: '#ad7175', claw: '#746168', iris: '#66504b', roughness: 0.72,
  },
  sparrow: {
    back: '#a37755', belly: '#c7b9a5', head: '#ad8870', coverts: '#8b654d',
    flight: '#67503c', tail: '#705642', sheen: '#4e382c', bill: '#4d4038',
    foot: '#9c766d', claw: '#634e48', iris: '#4c352c', roughness: 0.78,
  },
  crow: {
    back: '#2b3037', belly: '#242628', head: '#292d32', coverts: '#2a313c',
    flight: '#242931', tail: '#242a31', sheen: '#414e64', bill: '#27292c',
    foot: '#393839', claw: '#292929', iris: '#463a35', roughness: 0.53,
  },
  magpie: {
    back: '#252b32', belly: '#eeece6', head: '#252b32', coverts: '#27343f',
    flight: '#263940', tail: '#2b4144', sheen: '#355d61', bill: '#292e31',
    foot: '#383737', claw: '#292829', iris: '#53433b', roughness: 0.52,
  },
};

function palette(s: Swatches) {
  return {
    back: color(s.back), belly: color(s.belly), head: color(s.head),
    coverts: color(s.coverts), flight: color(s.flight), tail: color(s.tail),
    sheen: color(s.sheen), bill: color(s.bill), foot: color(s.foot),
    claw: color(s.claw), iris: color(s.iris),
  };
}

type Palette = ReturnType<typeof palette>;
const resolution = [
  { shell: 24, subdivisions: 3, details: 10, blade: 8, rows: 6, tail: 9 },
  { shell: 16, subdivisions: 2, details: 8, blade: 6, rows: 5, tail: 7 },
  { shell: 12, subdivisions: 1, details: 6, blade: 4, rows: 4, tail: 5 },
] as const;
const sides = [-1, 1] as const;

function bodyGeometry(species: UrbanSpecies, profile: Profile, p: Palette, lod: BirdLod, white: boolean): THREE.BufferGeometry {
  const part = new Part();
  const d = resolution[lod];
  part.loft(profile.body, {
    sides: d.shell,
    subdivisions: d.subdivisions,
    extraAngles: species === 'sparrow' ? [Math.PI / 4, 3 * Math.PI / 4] : [],
    paint: (point, angle, z) => {
      const dorsal = Math.sin(angle);
      if (species === 'sparrow') {
        const feather = Math.min(...[Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]
          .map(axis => Math.abs(angle - axis - 1.5 * z)));
        const stripe = (1 - smoothstep(feather, 0.06, 0.22)) * smoothstep(z, -0.035, -0.019);
        const base = blend(p.belly, p.back, smoothstep(dorsal, -0.23, 0.70));
        return blend(base, p.sheen, stripe * 0.9);
      }
      if (species === 'magpie') {
        const ventral = (1 - smoothstep(dorsal, 0.06, 0.38))
          * smoothstep(z, -0.073, -0.040) * (1 - smoothstep(z, 0.047, 0.075));
        const scapular = smoothstep(Math.abs(point[0]), 0.017, 0.030)
          * smoothstep(dorsal, 0.37, 0.66) * smoothstep(z, -0.051, -0.027)
          * (1 - smoothstep(z, 0.032, 0.058));
        return blend(p.back, p.belly, Math.max(ventral, scapular));
      }
      const base = blend(p.belly, p.back, smoothstep(dorsal, -0.65, 0.65));
      if (species !== 'crow') return base;
      return blend(base, p.sheen, 0.44 * smoothstep(dorsal, 0.1, 0.85));
    },
  });
  if (profile.neck) {
    part.loft(profile.neck, {
      sides: d.shell,
      subdivisions: d.subdivisions,
      paint: ([x, y], angle, z) => {
        if (species !== 'pigeon' || white) {
          return blend(p.head, p.back, 0.7 * (1 - smoothstep(Math.sin(angle), -0.5, 0.5)));
        }
        const violet = smoothstep(y + 0.45 * z - 0.34 * Math.abs(x), 0.108, 0.143);
        const throat = blend(neckGreen, neckViolet, violet);
        const sheen = smoothstep(y, 0.115, 0.158) * (1 - smoothstep(z, -0.067, -0.039));
        return blend(blend(p.belly, p.head, smoothstep(y, 0.126, 0.161)), throat, sheen * 0.94);
      },
    });
  }
  return part.finish();
}

function eye(part: Part, profile: Profile, p: Palette, side: -1 | 1, lod: BirdLod, orange: boolean): THREE.Vector3 {
  const angle = side === 1 ? profile.eyeAngle : Math.PI - profile.eyeAngle;
  const position = new THREE.Vector3(...formPoint(profile.head, profile.eyeZ, angle));
  const normal = formNormal(profile.head, profile.eyeZ, angle);
  const r = profile.eyeRadius;
  const detail = resolution[lod].details;
  const offset = (distance: number): Point => position.clone().addScaledVector(normal, distance).toArray();
  const lid = blend(p.head, p.bill, 0.52);
  part.ellipsoid(offset(0), [r * 1.10, r, r * 0.35], lid, detail, normal);
  part.ellipsoid(offset(r * 0.19), [r * 0.86, r * 0.84, r * 0.38], p.iris, detail, normal);
  const pupilSize = orange ? 0.44 : 0.68;
  part.ellipsoid(offset(r * 0.44), [r * pupilSize, r * pupilSize, r * 0.21], pupil, detail, normal);
  if (lod < 2) {
    const highlight = position.clone().addScaledVector(normal, r * 0.63);
    highlight.y += r * 0.21;
    highlight.z -= r * 0.12;
    part.ellipsoid(highlight.toArray(), [r * 0.13, r * 0.13, r * 0.07], glint, 6, normal);
  }
  return position;
}

function headGeometry(species: UrbanSpecies, profile: Profile, p: Palette, lod: BirdLod, white: boolean) {
  const part = new Part();
  const d = resolution[lod];
  part.loft(profile.head, {
    sides: d.shell,
    subdivisions: d.subdivisions,
    paint: (_, angle, z) => {
      const top = Math.sin(angle);
      if (species === 'sparrow') {
        const cap = smoothstep(top, 0.05, 0.42);
        const cheekMask = smoothstep(z, -0.016, -0.007) * (1 - smoothstep(z, 0.014, 0.021))
          * smoothstep(Math.abs(Math.cos(angle)), 0.38, 0.71) * (1 - smoothstep(top, 0.0, 0.32));
        const bib = (1 - smoothstep(z, -0.012, -0.004)) * (1 - smoothstep(top, -0.17, 0.15));
        return blend(blend(blend(p.head, crown, cap), cheek, cheekMask), ink, bib);
      }
      return blend(p.head, p.back, 0.34 * smoothstep(top, -0.5, 0.75));
    },
  });
  part.loft(profile.bill, {
    sides: d.details,
    subdivisions: d.subdivisions,
    paint: (_, angle) => {
      const upper = Math.sin(angle);
      const shine = color(white ? '#b6988e' : '#4d4d4e');
      const enamel = blend(p.bill, shine, 0.25 * smoothstep(upper, 0.12, 0.9));
      return blend(enamel, ink, 0.72 * (1 - smoothstep(Math.abs(upper), 0.0, 0.29)));
    },
  });
  if (species === 'pigeon') {
    const cere = color(white ? '#dfd2c5' : '#c8c3b6');
    part.ellipsoid([0, 0.019, -0.033], [0.0088, 0.0067, 0.0085], cere, d.details);
  }
  let rightEye = new THREE.Vector3();
  for (const side of sides) {
    if (species === 'sparrow') {
      part.mark(profile.head, side, {
        z: 0.0065, angle: -0.23, halfDepth: 0.0045, halfArc: 0.235, lift: 0.00029,
        sides: d.details, color: ink,
      });
    }
    if (lod < 2 && (species === 'pigeon' || species === 'crow')) {
      const first = profile.bill[0][0];
      const last = profile.bill[profile.bill.length - 1][0];
      const z = lerp(first, last, species === 'crow' ? 0.69 : 0.57);
      const angle = side === 1 ? 0.68 : Math.PI - 0.68;
      const r = profile.eyeRadius * 0.19;
      part.ellipsoid(formPoint(profile.bill, z, angle), [r * 1.35, r * 0.68, r * 0.4], pupil, 6, formNormal(profile.bill, z, angle));
    }
    const position = eye(part, profile, p, side, lod, species === 'pigeon' && !white);
    if (side === 1) rightEye = position;
  }
  return { geometry: part.finish(), eye: rightEye.add(new THREE.Vector3(...profile.headAt)).toArray() };
}

type VanePaint = (t: number, angle: number) => THREE.Color;

/** A cambered vane with a wide midsection, tapering base and rounded end. */
function feather(
  part: Part, start: Point, end: Point, width: number, thickness: number, lod: BirdLod, paint: VanePaint, bank = 0,
): void {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const length = Math.hypot(dx, dz);
  const intermediate: Form = lod === 0
    ? [
      [length * 0.21, -thickness * 0.57, thickness * 0.85, width * 0.49],
      [length * 0.49, -thickness * 0.68, thickness, width],
      [length * 0.77, -thickness * 0.45, thickness * 0.72, width * 0.94],
      [length * 0.94, -thickness * 0.21, thickness * 0.35, width * 0.68],
    ]
    : [
      [length * 0.24, -thickness * 0.57, thickness * 0.85, width * 0.61],
      [length * 0.63, -thickness * 0.58, thickness * 0.84, width],
      [length * 0.90, -thickness * 0.24, thickness * 0.39, width * 0.65],
    ];
  const cosBank = Math.cos(bank);
  const sinBank = Math.sin(bank);
  part.loft([[0, 0, 0, 0], ...intermediate, [length, 0, 0, 0]], {
    sides: resolution[lod].blade,
    paint: (_, angle, z) => paint(z / length, angle),
    transform: ([x, y, z]) => {
      const across = x * cosBank - y * sinBank;
      return [
        start[0] + (dz * across + dx * z) / length,
        lerp(start[1], end[1], z / length) + x * sinBank + y * cosBank,
        start[2] + (-dx * across + dz * z) / length,
      ];
    },
  });
}

const band = (value: number, start: number, end: number, edge: number) =>
  smoothstep(value, start - edge, start) * (1 - smoothstep(value, end, end + edge));

function wingGeometry(species: UrbanSpecies, profile: Profile, p: Palette, lod: BirdLod, white: boolean): THREE.BufferGeometry {
  const part = new Part();
  const d = resolution[lod];
  const span = profile.wingSpan / 2 - profile.wingAt[0];
  const chord = profile.wingChord;
  const camber = (u: number) => -0.066 * u * u;
  // The hinge sits ahead of the wing's mid-chord. The trailing vanes overlap
  // behind the thin coverts and still clear the ground in the swept pose.
  const narrowLeading = species === 'crow' || species === 'magpie' ? 0.45 : 0.55;
  const trailingTaper = { pigeon: 0.62, sparrow: 0.68, crow: 0.59, magpie: 0.63 }[species];
  const wingDepth = (z: number) => chord * (0.088 + (z - 0.20) * (z < 0.20 ? narrowLeading : trailingTaper));
  const wingPoint = (u: number, y: number, z: number): Point => [span * u, chord * y, wingDepth(z)];
  const form: Form = profile.airfoil.map(([u, front, back, depth]) => [
    u * span, (camber(u) - depth * 0.64) * chord, (camber(u) + depth * 0.64) * chord,
    (back - front) * chord / 2, -(front + back) * chord / 2,
  ]);
  const pigeonAngles = [0.39, 0.43, 0.51, 0.55, 0.665, 0.70, 0.78, 0.825]
    .map(fraction => Math.acos(1 - 2 * fraction));
  const undersideAngles = [0.47, 0.74].map(fraction => 2 * Math.PI - Math.acos(1 - 2 * fraction));
  part.loft(form, {
    sides: d.shell,
    subdivisions: d.subdivisions,
    extraAngles: species === 'pigeon' ? [...pigeonAngles, ...undersideAngles] : [],
    transform: ([x, y, z]) => [z, y, wingDepth(-x / chord)],
    paint: (_, angle, z) => {
      const u = z / span;
      const top = Math.sin(angle);
      const frontToBack = (1 - Math.cos(angle)) / 2;
      const base = blend(p.flight, p.coverts, smoothstep(top, -0.65, 0.7));
      if (species === 'pigeon') {
        const bars = Math.max(band(frontToBack, 0.43, 0.51, 0.04), band(frontToBack, 0.70, 0.78, 0.04));
        const plumage = blend(base, p.coverts, 0.53);
        const surface = smoothstep(top, 0.0, 0.38) + 0.31 * smoothstep(-top, 0.08, 0.55);
        return blend(plumage, p.sheen, bars * surface
          * (1 - smoothstep(u, 0.56, 0.80)) * (white ? 0.22 : 0.94));
      }
      if (species === 'magpie') {
        const distance = Math.hypot((u - 0.12) / 0.26, (frontToBack - 0.62) / 0.48);
        const shoulder = (1 - smoothstep(distance, 0.70, 1))
          * smoothstep(Math.abs(top), 0.10, 0.45) * (top < 0 ? 0.86 : 1);
        const gloss = blend(base, p.sheen, 0.62 * smoothstep(top, -0.25, 0.88));
        return blend(gloss, p.belly, shoulder);
      }
      if (species === 'sparrow') {
        const bar = band(frontToBack, 0.71, 0.83, 0.12) * (1 - smoothstep(u, 0.35, 0.66));
        return blend(base, p.belly, bar * 0.70 * smoothstep(top, 0, 0.8));
      }
      return blend(base, p.sheen, 0.59 * smoothstep(top, 0.04, 0.9));
    },
  });

  const vaneColor = (t: number, angle: number, row: number, primary: boolean) => {
    const top = (Math.sin(angle) + 1) / 2;
    const neutral = blend(p.flight, p.coverts, 0.34 * (1 - t) + 0.18 * top);
    const shade = neutral.multiplyScalar(0.91 + (row % 3) * 0.045);
    if (species === 'magpie') {
      const insideVane = band(t, 0.24, 0.66, 0.17) * smoothstep(-Math.cos(angle), -0.06, 0.70);
      return blend(blend(shade, p.sheen, 0.51 * top), p.belly, primary ? insideVane * 0.97 : 0);
    }
    if (species === 'crow') return blend(shade, p.sheen, top * (0.40 - 0.26 * t));
    return blend(shade, p.sheen, smoothstep(t, 0.68, 0.98) * 0.52);
  };

  for (let i = 0; i < d.rows; i += 1) {
    const u = i / (d.rows - 1);
    const start = wingPoint(lerp(-0.035, 0.42, u), -0.022 - 0.003 * (i % 3), lerp(0.23, 0.29, u));
    const end = wingPoint(lerp(0.02, 0.50, u), lerp(-0.075, -0.112, u), lerp(0.83, 0.96, u));
    feather(part, start, end, span * 0.40 / d.rows, chord * 0.016, lod,
      (t, angle) => vaneColor(t, angle, i, false));
  }
  const primaries = lod === 0 ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : lod === 1 ? [0, 1, 3, 4, 5, 6, 8] : [0, 2, 4, 6, 8];
  for (const i of primaries) {
    const u = i / (profile.primaryTips.length - 1);
    const [tip, sweep] = profile.primaryTips[i];
    const start = wingPoint(lerp(0.36, 0.85, u), camber(u) - 0.003 * (i % 3), lerp(0.29, 0.065, u));
    const end = wingPoint(tip, lerp(-0.117, -0.087, u), sweep);
    const baseWidth = species === 'crow' ? 0.091 : 0.110;
    const lodWidening = species === 'crow' ? 0.17 : 0.25;
    const width = chord * baseWidth * (1 + lod * lodWidening) * (1 - 0.21 * u);
    feather(part, start, end, width, chord * 0.017, lod,
      (t, angle) => vaneColor(t, angle, i, true));
  }
  return part.finish();
}

function tailGeometry(species: UrbanSpecies, profile: Profile, p: Palette, lod: BirdLod, white: boolean): THREE.BufferGeometry {
  const part = new Part();
  const { tail } = profile;
  const graduated = species === 'magpie';
  const count = resolution[lod].tail + Number(graduated);
  const inner = graduated ? 1 / (count - 1) : 0;
  for (let i = 0; i < count; i += 1) {
    const u = 2 * i / (count - 1) - 1;
    const rank = Math.max(0, Math.abs(u) - inner) / (1 - inner);
    const shorter = tail.graduation < 0 ? 1 - rank ** 2 : rank ** 2;
    const tip = tail.length - shorter * Math.abs(tail.graduation);
    const width = tail.width * (graduated ? 0.99 : 0.83) / count;
    const bank = graduated ? -Math.sign(u) * lerp(0.17, 0.41, rank) : 0;
    const layer = graduated ? 0.0055 * (1 - rank) : 0;
    feather(part,
      [u * tail.width * 0.16, layer, -0.009],
      [u * tail.width * 0.46, layer - tail.drop * (tip / tail.length) - 0.002 * rank ** 2, tip],
      width, tail.width * (graduated ? 0.046 : 0.029), lod,
      (t, angle) => {
        const top = (Math.sin(angle) + 1) / 2;
        if (species === 'pigeon') {
          return blend(p.tail, p.sheen, smoothstep(t, 0.67, 0.83) * (white ? 0.34 : 0.91));
        }
        return blend(p.tail, p.sheen, 0.56 * top * (1 - smoothstep(t, 0.72, 0.99)));
      }, bank);
  }
  return part.finish();
}

function footGeometry(species: UrbanSpecies, profile: Profile, p: Palette, lod: BirdLod): THREE.BufferGeometry {
  const part = new Part();
  const { radius: r, toeLength, spread, ankleZ, cuffLength } = profile.foot;
  const sole = -profile.footAt[1];
  const detail = resolution[lod].details;
  const joint: Point = [0, sole + r * 1.12, ankleZ];
  const thigh = blend(p.belly, p.back, species === 'magpie' ? 0.92 : 0.35);
  part.ellipsoid([0, -0.22 * cuffLength, 0.12 * ankleZ],
    [r * 1.84, 0.78 * cuffLength, r * 2.1], thigh, detail);
  part.taper([0, r * 1.4, 0], joint, r * 1.03, r * 0.78, p.foot, detail);
  part.ellipsoid([0, sole + r * 0.93, ankleZ], [r * 1.38, r * 0.93, r * 1.75], p.foot, detail);
  for (const toe of [-1, 0, 1, 2]) {
    const rear = toe === 2;
    const length = toe === 0 ? toeLength : toeLength * (rear ? -0.55 : 0.74);
    const x = toe === 0 ? 0 : spread * (rear ? -0.35 : toe);
    const bend: Point = [x * 0.49, sole + r * 1.02, ankleZ - length * 0.42];
    const tip: Point = [x, sole + r * 0.66, ankleZ - length * 0.84];
    const nail: Point = [x * 1.07, sole + r * 0.22, ankleZ - length];
    part.taper(joint, bend, r * 0.66, r * 0.55, p.foot, detail);
    part.taper(bend, tip, r * 0.55, r * 0.33, p.foot, detail);
    part.taper(tip, nail, r * 0.38, r * 0.08, p.claw, detail);
  }
  return part.finish();
}

export function createUrbanBird({ species, lod, morph: inputMorph }: BirdBuildOptions): BirdModel {
  if (species !== 'pigeon' && species !== 'sparrow' && species !== 'crow' && species !== 'magpie') {
    throw new RangeError('Unsupported urban bird species: ' + String(species));
  }
  if (lod !== 0 && lod !== 1 && lod !== 2) throw new RangeError('Unsupported urban bird LOD: ' + String(lod));
  const requested = inputMorph === undefined ? 'default' : inputMorph;
  if (requested !== 'default' && (species !== 'pigeon' || (requested !== 'gray' && requested !== 'white'))) {
    throw new RangeError('Unsupported morph for ' + species + ': ' + String(requested));
  }
  const morph = species === 'pigeon' && requested === 'default' ? 'gray' : requested;
  const white = morph === 'white';
  const profile = profiles[species];
  const swatch = swatches[white ? 'white' : species];
  const p = palette(swatch);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: swatch.roughness });
  material.name = species + '-' + morph + '-plumage';
  const root = new THREE.Group();
  root.name = species + '-' + morph;
  const resources: BirdModel['resources'] = { geometries: [], materials: [material] };
  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const geometry of resources.geometries) geometry.dispose();
    material.dispose();
  }

  function pivot(name: keyof BirdPivots, position: Point, side = 1): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(side * position[0], position[1], position[2]);
    root.add(group);
    return group;
  }

  function attach(parent: THREE.Group, geometry: THREE.BufferGeometry, name: string, mirror = false): void {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.scale.x = mirror ? -1 : 1;
    mesh.castShadow = lod < 2 && (name === 'body' || name === 'leftWing' || name === 'rightWing');
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  function own(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    resources.geometries.push(geometry);
    return geometry;
  }

  try {
    const pivots: BirdPivots = {
      head: pivot('head', profile.headAt),
      leftWing: pivot('leftWing', profile.wingAt, -1),
      rightWing: pivot('rightWing', profile.wingAt),
      tail: pivot('tail', profile.tailAt),
      leftFoot: pivot('leftFoot', profile.footAt, -1),
      rightFoot: pivot('rightFoot', profile.footAt),
    };
    attach(root, own(bodyGeometry(species, profile, p, lod, white)), 'body');
    const head = headGeometry(species, profile, p, lod, white);
    attach(pivots.head, own(head.geometry), 'head');
    const wing = own(wingGeometry(species, profile, p, lod, white));
    attach(pivots.leftWing, wing, 'leftWing', true);
    attach(pivots.rightWing, wing, 'rightWing');
    attach(pivots.tail, own(tailGeometry(species, profile, p, lod, white)), 'tail');
    const foot = own(footGeometry(species, profile, p, lod));
    attach(pivots.leftFoot, foot, 'leftFoot', true);
    attach(pivots.rightFoot, foot, 'rightFoot');
    const size = new THREE.Box3().setFromObject(root, true).getSize(new THREE.Vector3());
    const metrics = {
      bodyLengthM: profile.bodyLengthM,
      wingspanM: profile.wingSpan,
      standingHeightM: size.y,
      footY: 0 as const,
      eye: head.eye,
    };
    return { species, lod, morph, root, pivots, metrics, resources, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
