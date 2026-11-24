import * as THREE from 'three';
import type { NativeMotionState } from './native/ported/motion/locomotion/b2/native-motion.ts';
import type { LookId } from './progress.ts';
import { LANDING_BLEND_SECONDS } from './species-core/upstream/pose-input.ts';
import type { FlightModelReadiness } from './pigeon-takeoff-intent.ts';

export const PIGEON_APPROVED_WINGBEAT = 'ShoulderWingbeat_Approved';
export const PIGEON_APPROVED_WINGBEAT_SECONDS = .8;
export const PIGEON_GLIDE = 'PigeonGlide_Spread';
export const PIGEON_LAND = 'PigeonLand_Settle';
export const PIGEON_FALL = 'PigeonFall_Tucked';
export const PIGEON_RETRIGGER_TAIL_SECONDS = .16;
const OLD_SPREAD_WINGS_PHASE = .21;
const SPREAD_BLEND_SECONDS = .18;
const MOTION_ASSET_BODY_LENGTH_M = .538;
const NATIVE_BODY_LENGTH_M = .293873163;
const NATIVE_STANDING_HEIGHT_M = .225;
const GLIDE_SECONDS = 1.72;
const FALL_SECONDS = .47;
const END_EPSILON = 1e-6;

type FlightState = Readonly<Pick<NativeMotionState, 'body'|'grounded'|'mode'|'flapAge'|'flaps'>>;
type Context = Readonly<{ started: boolean; look: LookId | null; firstPerson: boolean; reducedMotion: boolean; descend: boolean; preload: boolean; landingSeconds?: number; committedSeconds?: number }>;
type FlightLoader = (url: string) => Promise<{ scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] }>;

type RenderMode = 'wingbeat'|'glide'|'fall';
type ThreeValues = [number, number, number];
const KEYS = ['wingbeat', 'glide', 'fall'] as const;
const LABELS = [PIGEON_APPROVED_WINGBEAT, PIGEON_GLIDE, PIGEON_FALL] as const;

/** Compatibility utility for the original shoulder cycle; transitions now use dedicated clips. */
export function shoulderPoseTime(flapAge: number): number {
  if (flapAge <= PIGEON_APPROVED_WINGBEAT_SECONDS) return Math.max(0, flapAge);
  const t = THREE.MathUtils.clamp((flapAge - PIGEON_APPROVED_WINGBEAT_SECONDS) / SPREAD_BLEND_SECONDS, 0, 1);
  return OLD_SPREAD_WINGS_PHASE * t * t * (3 - 2 * t);
}

// The rig is already authored with shared morph geometry. Sample narrow, measured
// spans of that geometry rather than swapping to the unrelated procedural bird.
// On the exact asset the two ranges are about 1.00 and 0.62 normalized units wide.
function derivedMotion(name: string, duration: number, stroke: THREE.AnimationClip, phases: readonly number[]): THREE.AnimationClip {
  const tracks = stroke.tracks.map(track => {
    const stride = track.getValueSize();
    const times = Float32Array.from(phases, (_, index) => index / (phases.length - 1) * duration);
    const values = new Float32Array(stride * phases.length);
    const sampler = track.InterpolantFactoryMethodLinear();
    phases.forEach((phase, index) => values.set(sampler.evaluate(phase), index * stride));
    const out = track.clone();
    out.times = times; out.values = values;
    return out;
  });
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Only the player's visual is replaced. Physics, sound events, camera and contact remain native. */
export function createFlightPigeon(parent: THREE.Scene, baseUrl: string, load: FlightLoader = async url => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().loadAsync(url);
}) {
  const root = new THREE.Group(); root.name = 'approved-flight-pigeon'; root.visible = false; parent.add(root);
  const landPose: ThreeValues = [0, 0, 1];
  const headingFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const pitchAxis = new THREE.Vector3(1, 0, 0);
  const visualPitch = new THREE.Quaternion();
  let loadState: FlightModelReadiness = 'idle';
  let mixer: THREE.AnimationMixer | undefined;
  let actions: readonly [THREE.AnimationAction, THREE.AnimationAction, THREE.AnimationAction] | undefined;
  let clipTime: number | null = null, presentedMode: RenderMode | null = null;
  let seenFlaps: number | null = null, queuedFlap = false;
  let poweredTime: number | null = null, retriggerPending = false, tailRate = 1;
  let selected = -1, blendFrom: ThreeValues = [0, 0, 0], weights: ThreeValues = [0, 0, 0];
  let phases: ThreeValues = [0, 0, 0], blendAge = 0, blendSeconds = 0;
  let wasInAir = false, landing: { weights: ThreeValues; phases: ThreeValues; pitch: number } | null = null;
  let previousPitch = 0;
  const resetVisual = () => {
    selected = -1; blendAge = blendSeconds = 0; blendFrom = [0, 0, 0]; weights = [0, 0, 0]; phases = [0, 0, 0];
    poweredTime = null; retriggerPending = false; tailRate = 1;
  };
  const loadOnce = () => {
    loadState = 'loading';
    void load(baseUrl + 'models/idea-pigeon-flight-approved.glb').then(({ scene, animations }) => {
      const clip = animations.find(c => c.name === PIGEON_APPROVED_WINGBEAT);
      if (!clip || Math.abs(clip.duration - PIGEON_APPROVED_WINGBEAT_SECONDS) > .001) throw new Error('Approved pigeon flight clip mismatch');
      scene.traverse(node => {
        if (node instanceof THREE.Mesh && node.morphTargetInfluences) node.frustumCulled = false;
      });
      root.add(scene);
      mixer = new THREE.AnimationMixer(scene);
      const glide = derivedMotion(PIGEON_GLIDE, GLIDE_SECONDS, clip, [.300, .311, .322, .311, .300]);
      const fall = derivedMotion(PIGEON_FALL, FALL_SECONDS, clip, [.055, .064, .073, .064, .055]);
      actions = [clip, glide, fall].map(c =>
        mixer!.clipAction(c).setLoop(THREE.LoopOnce, 1).setEffectiveWeight(0).play(),
      ) as [THREE.AnimationAction, THREE.AnimationAction, THREE.AnimationAction];
      loadState = 'ready';
    }).catch(() => { loadState = 'fallback'; root.visible = false; });
  };
  return {
    root,
    get readiness() { return loadState; },
    snapshot() {
      return { loadState, visible: root.visible, clip: root.visible && landing ? PIGEON_LAND : root.visible && selected >= 0 ? LABELS[selected] : null,
        clipTime, queuedFlap, queuedRetrigger: retriggerPending, motion: presentedMode,
        blend: root.visible ? [...weights] : null };
    },
    update(bird: FlightState, actor: THREE.Object3D, c: Context): boolean {
      const eligible = c.look === 'pigeon' && !c.firstPerson;
      // Keep verified cold-start takeoff gating and staggered intro decode.
      if (eligible && c.preload && loadState === 'idle') loadOnce();
      const accessibleAir = c.started && eligible && !bird.grounded &&
        (bird.mode === 'flap' || bird.mode === 'glide' || bird.mode === 'fall');
      const dt = THREE.MathUtils.clamp(c.committedSeconds ?? .01, 0, .1);
      const committed = dt > 0;
      const newImpulse = committed && bird.flaps !== seenFlaps;
      if (newImpulse) seenFlaps = bird.flaps;
      const age = c.landingSeconds ?? Infinity;
      const settling = eligible && c.started && bird.grounded && !c.reducedMotion && loadState === 'ready' &&
        age >= 0 && age < LANDING_BLEND_SECONDS && (wasInAir || landing !== null);
      if (settling && !landing) landing = { weights: [...weights], phases: [...phases], pitch: previousPitch };
      if (settling && mixer && actions && landing) {
        const t = THREE.MathUtils.clamp(age / (LANDING_BLEND_SECONDS - .035), 0, 1);
        const eased = t * t * (3 - 2 * t);
        // Preserve the preceding airborne frame at contact, ease the wings to
        // their folded range and level the body before the grounded rig takes over.
        // Resetting procedural pose or playing a second flap here causes a snap.
        weights = landing.weights.map((w, i) => w * (1 - eased) + landPose[i] * eased) as ThreeValues;
        phases = [...landing.phases];
        phases[2] *= 1 - eased;
        actions.forEach((action, i) => {
          action.setEffectiveWeight(weights[i]);
          action.time = Math.min(action.getClip().duration - END_EPSILON, phases[i]);
        });
        mixer.update(0);
        root.position.copy(actor.position);
        root.quaternion.copy(actor.quaternion).multiply(headingFlip);
        root.quaternion.multiply(visualPitch.setFromAxisAngle(pitchAxis, landing.pitch * (1 - eased)));
        root.visible = true; clipTime = age; presentedMode = null; wasInAir = false;
        return true;
      }
      landing = null;
      if (!accessibleAir || loadState === 'fallback') { queuedFlap = false; resetVisual(); }
      if (loadState !== 'ready' && newImpulse && accessibleAir && !c.descend) {
        queuedFlap = bird.flaps > 0 && bird.flapAge < PIGEON_APPROVED_WINGBEAT_SECONDS;
      }
      if (c.descend) { queuedFlap = false; poweredTime = null; retriggerPending = false; tailRate = 1; }
      root.visible = accessibleAir && loadState === 'ready' && !(queuedFlap && !committed);
      clipTime = null; presentedMode = null;
      wasInAir = root.visible;
      if (!root.visible || !mixer || !actions) return false;

      if (committed && !c.descend) {
        if (queuedFlap) {
          poweredTime = 0; queuedFlap = false;
        } else if (newImpulse && bird.flaps > 0 && bird.flapAge <= PIGEON_APPROVED_WINGBEAT_SECONDS) {
          if (poweredTime !== null && poweredTime < PIGEON_APPROVED_WINGBEAT_SECONDS - END_EPSILON) {
            // The physical impulse stays immediate. Hold this exact displayed pose
            // on the input frame; reserve at most one future visual stroke.
            if (!retriggerPending) {
              tailRate = Math.max(1, (PIGEON_APPROVED_WINGBEAT_SECONDS - poweredTime) / PIGEON_RETRIGGER_TAIL_SECONDS);
              retriggerPending = true;
            } else {
              poweredTime = Math.min(poweredTime + dt * tailRate, PIGEON_APPROVED_WINGBEAT_SECONDS);
            }
          } else {
            poweredTime = 0;
            tailRate = 1; retriggerPending = false;
            if (selected < 0) poweredTime = Math.max(0, bird.flapAge);
          }
        } else if (poweredTime !== null) {
          if (poweredTime >= PIGEON_APPROVED_WINGBEAT_SECONDS - END_EPSILON) {
            poweredTime = retriggerPending ? 0 : null;
            tailRate = 1; retriggerPending = false;
          } else {
            // Present the authored end pose before restarting at the matching
            // opening pose, even when dt does not divide the remaining tail.
            const next = poweredTime + dt * tailRate;
            poweredTime = Math.min(next, PIGEON_APPROVED_WINGBEAT_SECONDS);
          }
        }
      }

      const desired: RenderMode = c.reducedMotion
        ? c.descend || bird.mode === 'fall' ? 'fall' : 'glide'
        : c.descend ? 'fall' : poweredTime !== null ? 'wingbeat' : bird.mode === 'glide' ? 'glide' : 'fall';
      const to = KEYS.indexOf(desired);
      const changed = selected !== to;
      if (changed) {
        blendFrom = [...weights]; blendAge = 0;
        blendSeconds = selected < 0 || c.reducedMotion ? 0 : desired === 'wingbeat' ? .09 : SPREAD_BLEND_SECONDS;
        selected = to;
        if (to !== 0) phases[to] = 0;
      } else if (committed) {
        blendAge += dt;
        if (!c.reducedMotion && to !== 0) phases[to] = (phases[to] + dt) % (to === 1 ? GLIDE_SECONDS : FALL_SECONDS);
      }
      const t = blendSeconds ? THREE.MathUtils.clamp(blendAge / blendSeconds, 0, 1) : 1;
      const eased = t * t * (3 - 2 * t);
      weights = [0, 1, 2].map(i => blendFrom[i] * (1 - eased) + (i === to ? eased : 0)) as ThreeValues;
      if (c.reducedMotion) phases[to] = 0;
      if (poweredTime !== null) phases[0] = poweredTime;
      actions.forEach((action, index) => {
        action.setEffectiveWeight(weights[index]);
        action.time = Math.min(action.getClip().duration - END_EPSILON, phases[index]);
      });
      mixer.update(0);
      root.position.copy(actor.position);
      root.quaternion.copy(actor.quaternion).multiply(headingFlip);
      const pitch = weights[1] * -.04 + weights[2] * (.20 + .025 * Math.sin(phases[2] / FALL_SECONDS * Math.PI * 2));
      previousPitch = pitch;
      root.quaternion.multiply(visualPitch.setFromAxisAngle(pitchAxis, pitch));
      root.scale.setScalar((bird.body.heightM / NATIVE_STANDING_HEIGHT_M) * NATIVE_BODY_LENGTH_M / MOTION_ASSET_BODY_LENGTH_M);
      clipTime = phases[to]; presentedMode = desired;
      return true;
    },
  };
}
