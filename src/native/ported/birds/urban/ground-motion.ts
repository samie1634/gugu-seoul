/** Ground motion tuning for the two urban foragers, in model metres. */
export type UrbanForager = 'sparrow' | 'crow';

export function isUrbanForager(species: string): species is UrbanForager {
  return species === 'sparrow' || species === 'crow';
}

const unit = (value: number): number => Math.max(0, Math.min(1, value));
const ease = (value: number): number => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};
const phase = (distance: number): number => ((distance % 1) + 1) % 1;

export interface UrbanWalkPose {
  bodyY: number;
  headY: number;
  headZ: number;
  tailPitch: number;
  leftY: number;
  rightY: number;
  leftZ: number;
  rightZ: number;
  leftPitch: number;
  rightPitch: number;
}

export function sampleUrbanWalk(species: UrbanForager, cycle: number, height: number, stride: number): UrbanWalkPose {
  const t = phase(cycle);
  if (species === 'sparrow') {
    // Both feet push off together. During ground contact, keep them stationary
    // in world space by offsetting by the distance the root has advanced.
    const support = .30;
    const air = unit((t - support) / (1 - support));
    const lift = Math.sin(Math.PI * air) ** 2;
    const footZ = stride * (t - support / 2 - ease(air));
    const pitch = .28 * Math.sin(2 * Math.PI * air) * Math.sin(Math.PI * air);
    return { bodyY: height * .055 * lift, headY: -height * .04 * lift,
      headZ: -height * .046 * Math.sin(Math.PI * air), tailPitch: -.19 * lift,
      leftY: 0, rightY: 0, leftZ: footZ, rightZ: footZ, leftPitch: pitch, rightPitch: pitch };
  }

  // Crow: alternating lifted feet with brief double support, not a hop.
  const support = .62;
  function foot(t: number) {
    const air = unit((t - support) / (1 - support));
    return { y: height * .10 * Math.sin(Math.PI * air) ** 2,
      z: stride * (t - support / 2 - ease(air)),
      pitch: .23 * Math.sin(2 * Math.PI * air) * Math.sin(Math.PI * air) };
  }
  const left = foot(t), right = foot(phase(t + .5));
  const step = phase(t * 2);
  return { bodyY: 0, headY: 0,
    headZ: -.068 * height * (ease(step / .34) - step),
    tailPitch: -.04 * Math.sin(Math.PI * step) ** 2,
    leftY: left.y, rightY: right.y, leftZ: left.z, rightZ: right.z,
    leftPitch: left.pitch, rightPitch: right.pitch };
}

export const urbanFoodPeckSeconds: Readonly<Record<UrbanForager, number>> = Object.freeze({ sparrow: .88, crow: 1.28 });

const forage = {
  sparrow: { lower: .14, rise: .70, taps: [.23, .41, .60], yaws: [-.18, .17, -.07],
    tapDown: .065, tapUp: .083, hover: .78, nod: -.42, reach: -.063 },
  crow: { lower: .27, rise: .98, taps: [.47, .86], yaws: [-.115, .15],
    tapDown: .138, tapUp: .127, hover: .65, nod: -.27, reach: -.05 },
} as const;

export interface UrbanForagePose {
  lean: number;
  headPitch: number;
  headYaw: number;
  headReachInHeights: number;
}

/** A low feeding bout with distinct contacts; the head rises only after the bout. */
export function sampleUrbanForage(species: UrbanForager, age: number): UrbanForagePose | undefined {
  const { lower, rise, taps, yaws, tapDown, tapUp, hover, nod, reach } = forage[species];
  const end = urbanFoodPeckSeconds[species];
  if (!Number.isFinite(age) || age < 0 || age >= end) return undefined;
  const held = ease(age / lower) * (1 - ease((age - rise) / (end - rise)));
  let tap = 0;
  let yaw: number = yaws[0];
  for (const [i, at] of taps.entries()) {
    tap = Math.max(tap, ease((age - at + tapDown) / tapDown) * (1 - ease((age - at) / tapUp)));
    if (i > 0) yaw += (yaws[i] - yaws[i - 1]) * ease((age - at + tapDown + .025) / .05);
  }
  return { lean: held * (hover + (1 - hover) * tap), headPitch: held * (.45 + .55 * tap) * nod,
    headYaw: held * yaw, headReachInHeights: held * (.5 + .5 * tap) * reach };
}

/** Keep the flock's established food-consumption instant aligned with actual bill contact. */
export const flockFoodContactSeconds = .21;
export function urbanFlockPoseTime(species: UrbanForager, elapsed: number): number {
  const first = forage[species].taps[0];
  const end = urbanFoodPeckSeconds[species];
  return elapsed <= flockFoodContactSeconds ? elapsed * first / flockFoodContactSeconds
    : first + (elapsed - flockFoodContactSeconds) * (end - first) / (end - flockFoodContactSeconds);
}
