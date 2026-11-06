import * as THREE from 'three';
import type { BirdModel, SpeciesId } from './contract.ts';

export interface BirdPoseInput {
  mode: 'rest' | 'walk' | 'flap' | 'glide' | 'fall';
  time: number;
  flapAge: number;
  steps: number;
  callAge?: number;
  landing?: number;
  reducedMotion?: boolean;
}

const pigeon = {
  strideInLegHeights: 2.8,
  lift: 0.09,
  hop: false,
  headReach: 0.14,
  headLift: 0.04,
  foldSweep: 1.24,
  foldSpan: 0.48,
  foldElevation: -0.23,
  foldTwist: 1.38,
  flightSweep: 0.16,
  glideElevation: 0.13,
  flapSeconds: 0.33,
  flapDepth: 0.84,
  tailFlex: 0.13,
  callPitch: 0.19,
};

const raptorFold = { foldSweep: 1.55, foldElevation: -0.18, foldTwist: 1.52 };

const profiles: Record<SpeciesId, typeof pigeon> = {
  pigeon,
  sparrow: {
    ...pigeon, strideInLegHeights: 3.75, lift: 0.19, hop: true,
    headReach: 0.037, headLift: 0.02, foldSpan: 0.62, flightSweep: 0.21,
    flapSeconds: 0.23, flapDepth: 0.92, tailFlex: 0.18, callPitch: 0.11,
  },
  crow: {
    ...pigeon, strideInLegHeights: 3.0, lift: 0.10,
    headReach: 0.06, headLift: 0.025, foldSpan: 0.51, flightSweep: 0.20,
    glideElevation: 0.09, flapSeconds: 0.39, tailFlex: 0.19, callPitch: 0.14,
  },
  magpie: {
    ...pigeon, strideInLegHeights: 2.8, lift: 0.12,
    headReach: 0.075, headLift: 0.033, foldSweep: 1.30, foldSpan: 0.58,
    glideElevation: 0.08, flapSeconds: 0.29, tailFlex: 0.21, callPitch: 0.12,
  },
  'tawny-owl': {
    ...pigeon, ...raptorFold, strideInLegHeights: 2.2, lift: 0.07,
    headReach: 0.009, headLift: 0.005, foldSpan: 0.43, flightSweep: 0.075,
    glideElevation: 0.20, flapSeconds: 0.38, flapDepth: 0.82, tailFlex: 0.08, callPitch: 0.07,
  },
  'eagle-owl': {
    ...pigeon, ...raptorFold, strideInLegHeights: 2.1, lift: 0.06,
    headReach: 0.006, headLift: 0.004, foldSpan: 0.40, flightSweep: 0.10,
    glideElevation: 0.22, flapSeconds: 0.42, flapDepth: 0.80, tailFlex: 0.065, callPitch: 0.06,
  },
  kestrel: {
    ...pigeon, ...raptorFold, strideInLegHeights: 2.35, lift: 0.08,
    headReach: 0.025, headLift: 0.013, foldSpan: 0.50, flightSweep: 0.025,
    glideElevation: 0.065, flapSeconds: 0.26, flapDepth: 0.69, tailFlex: 0.16, callPitch: 0.09,
  },
};

const TAU = 2 * Math.PI;
const { clamp, euclideanModulo, lerp } = THREE.MathUtils;

/** During support, local +Z advances one metre per forward world metre to hold the foot planted. */
function stepZ(cycle: number, strideM: number): number {
  return cycle < 0.5 ? strideM / 4 * Math.cos(TAU * cycle) : strideM * (cycle - 0.75);
}

interface PivotBind {
  pivot: THREE.Group;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  parentRotation: THREE.Quaternion;
  inverseParentRotation: THREE.Quaternion;
  modelToParent: THREE.Matrix3;
}

function captureBind(pivot: THREE.Group, root: THREE.Group): PivotBind {
  let parent = pivot.parent;
  while (parent && parent !== root) parent = parent.parent;
  if (!parent || !pivot.parent) throw new Error('A bird pivot must be a descendant of its model root');

  const position = pivot.position.clone();
  const rotation = pivot.quaternion.clone();
  const scale = pivot.scale.clone();
  if (!pivot.matrixAutoUpdate) pivot.matrix.decompose(position, rotation, scale);

  const parentMatrix = pivot.parent.matrixWorld;
  const parentRotation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().extractRotation(parentMatrix),
  ).normalize();
  return {
    pivot, position, rotation, scale, parentRotation,
    inverseParentRotation: parentRotation.clone().invert(),
    modelToParent: new THREE.Matrix3().setFromMatrix4(parentMatrix.clone().invert()),
  };
}

/** Capture the six local bind transforms once, while the model root is detached. */
export function bindBirdPose(model: BirdModel, stance: THREE.Group, visualScale: number): (input: BirdPoseInput) => void {
  const profile = profiles[model.species];
  const height = model.metrics.standingHeightM;
  const pivots = model.pivots;
  if (new Set(Object.values(pivots)).size !== 6) throw new Error('Bird pivots must be six distinct groups');
  model.root.updateWorldMatrix(false, true);

  const head = captureBind(pivots.head, model.root);
  const leftWing = captureBind(pivots.leftWing, model.root);
  const rightWing = captureBind(pivots.rightWing, model.root);
  const tail = captureBind(pivots.tail, model.root);
  const leftFoot = captureBind(pivots.leftFoot, model.root);
  const rightFoot = captureBind(pivots.rightFoot, model.root);
  const legHeight = Math.min(pivots.leftFoot.matrixWorld.elements[13], pivots.rightFoot.matrixWorld.elements[13]);
  const strideM = (legHeight > 0 ? legHeight : height * 0.2) * profile.strideInLegHeights;
  const scaledStrideM = strideM * visualScale;

  const offset = new THREE.Vector3();
  const angles = new THREE.Euler(0, 0, 0, 'YZX');
  const delta = new THREE.Quaternion();
  function apply(bind: PivotBind, y: number, z: number, pitch: number, yaw = 0, roll = 0, span = 1): void {
    offset.set(0, y, z).applyMatrix3(bind.modelToParent);
    delta.setFromEuler(angles.set(pitch, yaw, roll));
    const pivot = bind.pivot;
    pivot.position.copy(bind.position).add(offset);
    pivot.quaternion.copy(bind.inverseParentRotation).multiply(delta)
      .multiply(bind.parentRotation).multiply(bind.rotation);
    pivot.scale.copy(bind.scale);
    pivot.scale.x *= span;
    if (!pivot.matrixAutoUpdate) pivot.updateMatrix();
  }

  return (input) => {
    const motion = !input.reducedMotion;
    const time = motion && Number.isFinite(input.time) ? input.time % TAU : 0;
    let wingSweep = profile.foldSweep;
    // A single shoulder pivot approximates overlapping flight feathers by shortening span when folded.
    let wingSpan = profile.foldSpan;
    let wingElevation = profile.foldElevation;
    let wingTwist = profile.foldTwist;
    let headY = height * profile.headLift * 0.22 * Math.sin(time * 2);
    let headZ = 0;
    let headPitch = 0;
    let tailPitch = 0;
    let bodyLift = 0;
    let leftY = 0;
    let leftZ = 0;
    let rightY = 0;
    let rightZ = 0;
    let footPitch = 0;

    switch (input.mode) {
      case 'walk': {
        if (!motion) break;
        const steps = Number.isFinite(input.steps) ? input.steps : 0;
        const cycle = euclideanModulo(steps, scaledStrideM) / scaledStrideM;
        const phase = TAU * cycle;
        const wave = Math.sin(phase);
        if (profile.hop) {
          const contact = 0.35;
          const air = clamp((cycle - contact) / (1 - contact), 0, 1);
          bodyLift = height * profile.lift * Math.sin(Math.PI * air) ** 2;
          leftZ = rightZ = cycle < contact
            ? strideM * (cycle - contact / 2)
            : strideM * contact / 2 * Math.cos(Math.PI * air);
        } else {
          leftY = height * profile.lift * Math.max(0, wave) ** 2;
          rightY = height * profile.lift * Math.max(0, -wave) ** 2;
          leftZ = stepZ(cycle, strideM);
          rightZ = stepZ((cycle + 0.5) % 1, strideM);
        }
        headY = height * profile.headLift * Math.abs(wave);
        headZ = -height * profile.headReach * Math.sin(phase * 2);
        tailPitch = profile.tailFlex * (Math.cos(phase * 2) - 1) / 2;
        break;
      }
      case 'flap': {
        const age = Number.isFinite(input.flapAge) ? input.flapAge : 0;
        const phase = motion ? clamp(age / profile.flapSeconds, 0, 1) : 0.45;
        const downstroke = Math.sin(Math.PI * phase) ** 2;
        const opening = clamp(phase * 6, 0, 1);
        wingSweep = lerp(wingSweep, profile.flightSweep + 0.22 * (1 - downstroke), opening);
        wingSpan = lerp(wingSpan, 1, opening);
        wingElevation = lerp(wingElevation, lerp(0.72, 0.11, phase) - profile.flapDepth * downstroke, opening);
        wingTwist = lerp(wingTwist, -0.14 + 0.29 * downstroke, opening);
        tailPitch = profile.tailFlex * (0.7 - downstroke) * opening;
        leftY = rightY = height * 0.09 * opening;
        footPitch = -0.83 * opening;
        break;
      }
      case 'glide':
        wingSpan = 1;
        wingSweep = profile.flightSweep;
        wingElevation = profile.glideElevation + 0.027 * Math.sin(time * 3);
        wingTwist = -0.075;
        tailPitch = -profile.tailFlex * 0.65;
        leftY = rightY = height * 0.095;
        footPitch = -0.9;
        break;
      case 'fall':
        wingSpan = 0.75;
        wingSweep = profile.flightSweep + 0.63;
        wingElevation = -0.10 + 0.046 * Math.sin(time * 5);
        wingTwist = 0.30;
        headPitch = -0.10;
        tailPitch = profile.tailFlex * 0.55;
        leftY = rightY = height * 0.045;
        footPitch = -0.56;
        break;
    }

    const callAge = input.callAge ?? Infinity;
    if (motion && callAge >= 0 && callAge < 0.9) {
      headPitch += profile.callPitch * (1 - callAge / 0.9) * Math.sin(24 * callAge);
    }

    // The landing endpoint spreads the wings for braking and returns both feet to bind.
    const landingInput = input.landing ?? 0;
    const landing = clamp(Number.isFinite(landingInput) ? landingInput : 0, 0, 1);
    wingSpan = lerp(wingSpan, 1, landing);
    wingSweep = lerp(wingSweep, profile.flightSweep + 0.26, landing);
    wingElevation = lerp(wingElevation, 0.48 + profile.glideElevation, landing);
    wingTwist = lerp(wingTwist, 0.28, landing);
    headY *= 1 - landing;
    headZ *= 1 - landing;
    headPitch = lerp(headPitch, 0.045, landing);
    tailPitch = lerp(tailPitch, -0.23 - profile.tailFlex / 2, landing);
    bodyLift *= 1 - landing;
    leftY *= 1 - landing;
    rightY *= 1 - landing;
    leftZ *= 1 - landing;
    rightZ *= 1 - landing;
    footPitch *= 1 - landing;

    stance.position.y = bodyLift;
    apply(head, headY, headZ, headPitch);
    apply(leftWing, 0, 0, wingTwist, wingSweep, -wingElevation, wingSpan);
    apply(rightWing, 0, 0, wingTwist, -wingSweep, wingElevation, wingSpan);
    apply(tail, 0, 0, tailPitch);
    apply(leftFoot, leftY, leftZ, footPitch);
    apply(rightFoot, rightY, rightZ, footPitch);
  };
}
