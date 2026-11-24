import * as THREE from 'three';
import { flirtWeight } from '../../../../flirt-action.ts';
import type { BirdModel, SpeciesId } from './contract.ts';
import { isUrbanForager, sampleUrbanForage, sampleUrbanWalk } from '../urban/ground-motion.ts';
import { profiles as urbanProfiles } from '../urban/profiles.ts';
import { heronFishingCycle } from '../heron/fishing-cycle.ts';
import { HERON_FOLDED_HEAD, HERON_EXTENDED_HEAD, heronNeckExtension } from '../heron/neck.ts';
import { pigeonPeckCycle, solvePeckContact } from './peck.ts';

export interface BirdPoseInput {
  mode: 'rest' | 'walk' | 'flap' | 'glide' | 'fall';
  time: number;
  flapAge: number;
  steps: number;
  callAge?: number;
  /** Model-timeline age of an NPC floor-feeding bout; independent of player and opponent pecks. */
  foodPeckAge?: number;
  landing?: number;
  reducedMotion?: boolean;
  foldedFall?: boolean;
  peckAge?: number;
  /** A short forward jab at another bird, separate from a downward food peck. */
  opponentPeckAge?: number;
  fishStrikeAge?: number;
  fishStrikeHeight?: number;
  roll?: number;
  flirtAge?: number;
}

const pigeon = {
  strideInLegHeights: 6.8,
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
    ...pigeon, strideInLegHeights: 3.75, lift: 0.055, hop: true,
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
  heron: {
    ...pigeon, strideInLegHeights: 1.1, lift: .045, headReach: .015, headLift: .008, foldSpan: .50,
    flightSweep: .13, flapSeconds: .58, flapDepth: .68, tailFlex: .05, callPitch: .05,
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

/** A pigeon briefly holds its head as its body advances, then thrusts it forward. */
export function pigeonHeadCycle(cycle: number): number {
  const phase = euclideanModulo(cycle, 1);
  if (phase < 0.68) return phase / 0.68;
  const t = (phase - 0.68) / 0.32;
  return 1 - t * t * (3 - 2 * t);
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

  const headJoint=model.root.getObjectByName('head-joint');
  const head = captureBind(headJoint instanceof THREE.Group ? headJoint : pivots.head, model.root);
  const neckObject=model.root.getObjectByName('neck');
  const neck=neckObject instanceof THREE.Group ? captureBind(neckObject,model.root) : null;
  const heronNeck = model.species === 'heron' ? model.root.getObjectByName('heron-neck') as THREE.Mesh | undefined : undefined;
  const jaw = model.pivots.head.getObjectByName('lower-beak');
  const jawBindPitch = jaw?.rotation.x ?? 0;
  const upperBeak = model.pivots.head.getObjectByName('upper-beak');
  let peckContact: number | null = null;
  let peckHeightAtPitch: ((pitch: number) => number) | null = null;
  let fishContactHeight = NaN, fishContact: number | null = null, contactExtension = NaN;
  if ((model.species === 'pigeon' || model.species === 'heron') && neck?.pivot.parent === model.root && head.pivot.parent === neck.pivot && upperBeak instanceof THREE.Mesh) {
    const positions = upperBeak.geometry.getAttribute('position');
    const tip = new THREE.Vector3(0, 0, Infinity);
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      head.pivot.worldToLocal(upperBeak.localToWorld(point.fromBufferAttribute(positions, i)));
      if (point.z < tip.z) tip.copy(point);
    }
    // Use the actual bill mesh endpoint, including its mesh-local rotation.
    const xAxis = new THREE.Vector3(1, 0, 0), neckRotation = new THREE.Quaternion(), headRotation = new THREE.Quaternion();
    const sampled = new THREE.Vector3();
    peckHeightAtPitch = pitch => {
      neckRotation.setFromAxisAngle(xAxis, -pitch * 0.88).multiply(neck.rotation);
      headRotation.setFromAxisAngle(xAxis, -pitch * 0.12).multiply(head.rotation);
      return sampled.copy(tip).applyQuaternion(headRotation).add(head.position)
        .applyQuaternion(neckRotation).add(neck.position).y;
    };
    peckContact = solvePeckContact(pitch => peckHeightAtPitch!(pitch) - (model.species === 'heron' ? .20 : 0));
  }
  const leftWing = captureBind(pivots.leftWing, model.root);
  const rightWing = captureBind(pivots.rightWing, model.root);
  const flirtMeshes = [pivots.leftWing, pivots.rightWing].flatMap(pivot => pivot.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && !!child.morphTargetInfluences,
  ));
  const tail = captureBind(pivots.tail, model.root);
  const leftFoot = captureBind(pivots.leftFoot, model.root);
  const rightFoot = captureBind(pivots.rightFoot, model.root);
  const legHeight = Math.min(pivots.leftFoot.matrixWorld.elements[13], pivots.rightFoot.matrixWorld.elements[13]);
  const strideM = (legHeight > 0 ? legHeight : height * 0.2) * profile.strideInLegHeights;
  const scaledStrideM = strideM * visualScale;

  const forager = isUrbanForager(model.species) ? model.species : undefined;
  // Tilt the entire torso/head assembly instead of sliding the head off the neck.
  // Feet are siblings and retain their original ground contact and placement.
  const forageTorso = forager && pivots.leftFoot.parent === model.root && pivots.rightFoot.parent === model.root
    ? new THREE.Group() : undefined;
  const hip = new THREE.Vector3();
  const bindBill = new THREE.Vector3();
  if (forager && forageTorso) {
    const geometry = urbanProfiles[forager];
    hip.set(0, geometry.footAt[1], geometry.footAt[2]);
    bindBill.set(0, geometry.bill[0][1], geometry.bill[0][0]);
    forageTorso.name = 'forageTorso';
    for (const part of [...model.root.children]) {
      if (part !== pivots.leftFoot && part !== pivots.rightFoot) forageTorso.add(part);
    }
    model.root.add(forageTorso);
  }

  const offset = new THREE.Vector3();
  const angles = new THREE.Euler(0, 0, 0, 'YZX');
  const delta = new THREE.Quaternion();
  const billRelativeToHip = new THREE.Vector3();
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
    let headYaw = 0;
    let tailPitch = 0;
    let bodyLift = 0;
    let leftY = 0;
    let leftZ = 0;
    let rightY = 0;
    let rightZ = 0;
    let footPitch = 0;
    let leftWalkPitch = 0, rightWalkPitch = 0;

    switch (input.mode) {
      case 'walk': {
        if (!motion) break;
        const steps = Number.isFinite(input.steps) ? input.steps : 0;
        const cycle = euclideanModulo(steps, scaledStrideM) / scaledStrideM;
        if (forager) {
          const walk = sampleUrbanWalk(forager, cycle, height, strideM);
          bodyLift = walk.bodyY;
          headY = walk.headY;
          headZ = walk.headZ;
          tailPitch = walk.tailPitch;
          leftY = walk.leftY;
          rightY = walk.rightY;
          leftZ = walk.leftZ;
          rightZ = walk.rightZ;
          leftWalkPitch = walk.leftPitch;
          rightWalkPitch = walk.rightPitch;
          break;
        }
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
        headZ = model.species === 'pigeon'
          ? height * profile.headReach * pigeonHeadCycle(cycle)
          : -height * profile.headReach * Math.sin(phase * 2);
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
        if (input.foldedFall) {
          headPitch = -0.10;
          leftY = rightY = height * 0.045;
          footPitch = -0.56;
          break;
        }
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

    const opponentAge = input.opponentPeckAge ?? Infinity;
    if (motion && (input.mode === 'rest' || input.mode === 'walk') && opponentAge >= 0 && opponentAge < .36) {
      const jab = Math.sin(Math.PI * opponentAge / .36) ** 2;
      headZ -= height * .24 * jab;
      headPitch -= .18 * jab;
    }
    const callAge = input.callAge ?? Infinity;
    const groundPeck = motion && (input.mode === 'rest' || input.mode === 'walk');
    const fishing = model.species === 'heron' && groundPeck ? heronFishingCycle(input.fishStrikeAge ?? Infinity) : heronFishingCycle(Infinity);
    const peckCycle = pigeonPeckCycle(groundPeck ? input.peckAge ?? Infinity : Infinity);
    let neckExtension = 0;
    if (heronNeck?.morphTargetInfluences) {
      const idle = heronNeckExtension(input.time, input.mode, input.reducedMotion);
      const jab = groundPeck && opponentAge >= 0 && opponentAge < .36 ? Math.sin(Math.PI * opponentAge / .36) ** 2 : 0;
      neckExtension = lerp(idle, 1, Math.max(fishing.reach, peckCycle.reach, jab));
      heronNeck.morphTargetInfluences[0] = neckExtension;
      head.position.lerpVectors(HERON_FOLDED_HEAD, HERON_EXTENDED_HEAD, neckExtension);
      if (peckHeightAtPitch && peckCycle.reach > 0) peckContact = solvePeckContact(pitch => peckHeightAtPitch!(pitch) - .20);
    }
    const fishHeight = input.fishStrikeHeight ?? .4;
    if (peckHeightAtPitch && fishing.reach > 0 && (fishHeight !== fishContactHeight || neckExtension !== contactExtension)) {
      fishContactHeight = fishHeight; contactExtension = neckExtension; fishContact = solvePeckContact(peckHeightAtPitch, fishHeight);
    }
    if (peckContact === null && groundPeck && input.peckAge !== undefined && input.peckAge >= 0 && input.peckAge < 0.5) {
      const peck = Math.sin(Math.PI * input.peckAge / 0.5);
      headPitch -= 0.95 * peck;
      headY -= height * 0.38 * peck;
      headZ -= height * 0.10 * peck;
    }
    if (jaw) {
      jaw.rotation.x = jawBindPitch + peckCycle.jaw + fishing.jaw;
    }
    if (motion && callAge >= 0 && callAge < 0.9) {
      headPitch += profile.callPitch * (1 - callAge / 0.9) * Math.sin(24 * callAge);
    }

    // The landing endpoint spreads the wings for braking and returns both feet to bind.
    const landingInput = input.landing ?? 0;
    const landing = clamp(Number.isFinite(landingInput) ? landingInput : 0, 0, 1);
    const peck = forager && forageTorso && motion && input.mode === 'rest' && landing === 0
      ? sampleUrbanForage(forager, input.foodPeckAge ?? Infinity) : undefined;
    if (peck) {
      headY *= 1 - peck.lean;
      headZ = height * peck.headReachInHeights;
      headPitch = peck.headPitch;
      headYaw = peck.headYaw;
      tailPitch = .12 * peck.lean;
    }
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

    if (model.species === 'heron') {
      const crouch = .20 * peckCycle.reach; bodyLift -= crouch; leftY += crouch; rightY += crouch;
      headPitch += .13 * fishing.swallow;
    }
    const flirting = model.species === 'pigeon' && input.mode === 'rest' &&
      (input.peckAge ?? Infinity) >= .5 && (input.opponentPeckAge ?? Infinity) >= .36
      ? flirtWeight(input.flirtAge ?? Infinity) : 0;
    // Turn the broad feather faces forward, rather than showing two thin edges.
    // The fixed shoulders form a wide lower triangle; both tips meet overhead.
    wingSpan = lerp(wingSpan, 1, flirting);
    wingSweep = lerp(wingSweep, 0, flirting);
    wingElevation = lerp(wingElevation, Math.PI / 2 + .207, flirting);
    wingTwist = lerp(wingTwist, Math.PI / 2, flirting);
    for (const mesh of flirtMeshes) mesh.morphTargetInfluences![0] = flirting;
    stance.position.y = bodyLift;
    if (neck && fishContact !== null && fishing.reach > 0) {
      apply(neck, 0, 0, -fishContact * .88 * fishing.reach);
      apply(head, 0, 0, headPitch - fishContact * .12 * fishing.reach);
    } else if (neck && peckContact !== null) {
      // Both sockets stay fixed in their parent's coordinates. Walking swings the
      // neck from its body socket and counter-rotates the head to keep the bill level.
      const neckPitch = clamp(Math.atan2(headZ, head.position.y), -0.65, 0.65);
      apply(neck, 0, 0, lerp(neckPitch, -peckContact * 0.88, peckCycle.reach));
      apply(head, 0, 0, lerp(headPitch - neckPitch, -peckContact * 0.12, peckCycle.reach));
    } else if(neck){
      apply(neck,headY*0.5,headZ*0.55,headPitch*0.48);
      apply(head,headY*0.5,headZ*0.45,headPitch*0.52);
    } else apply(head, headY, headZ, headPitch, headYaw);
    apply(leftWing, 0, 0, wingTwist, wingSweep, -wingElevation, wingSpan);
    apply(rightWing, 0, 0, wingTwist, -wingSweep, wingElevation, wingSpan);
    apply(tail, 0, 0, tailPitch);
    apply(leftFoot, leftY, leftZ, footPitch + leftWalkPitch * (1 - landing));
    apply(rightFoot, rightY, rightZ, footPitch + rightWalkPitch * (1 - landing));
    if (forageTorso) {
      if (!peck) {
        forageTorso.rotation.x = 0;
        forageTorso.position.set(0, 0, 0);
      } else {
        billRelativeToHip.copy(bindBill).applyQuaternion(pivots.head.quaternion)
          .add(pivots.head.position).sub(hip);
        const { y, z } = billRelativeToHip;
        const radius = Math.max(Math.hypot(y, z), .000001);
        // Compute the hinge angle at which the bill approaches the sole plane.
        // Scale it down between contacts so the next aim visibly clears ground.
        const contact = Math.acos(clamp((height * .008 - hip.y) / radius, -1, 1)) - Math.atan2(-z, y);
        forageTorso.rotation.x = -clamp(contact, 0, Math.PI * .49) * peck.lean;
        forageTorso.position.copy(hip).sub(billRelativeToHip.copy(hip).applyQuaternion(forageTorso.quaternion));
      }
    }
  };
}
