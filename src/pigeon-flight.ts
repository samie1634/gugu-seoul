import * as THREE from 'three';
import type { NativeMotionState } from './native/ported/motion/locomotion/b2/native-motion.ts';
import type { LookId } from './progress.ts';
import type { FlightModelReadiness } from './pigeon-takeoff-intent.ts';

export const PIGEON_APPROVED_WINGBEAT = 'ShoulderWingbeat_Approved';
export const PIGEON_APPROVED_WINGBEAT_SECONDS = .8;
const SPREAD_WINGS_PHASE = .21;
const SPREAD_BLEND_SECONDS = .18;
const MOTION_ASSET_BODY_LENGTH_M = .538;
const NATIVE_BODY_LENGTH_M = .293873163;
const NATIVE_STANDING_HEIGHT_M = .225;

type FlightState = Readonly<Pick<NativeMotionState, 'body'|'grounded'|'mode'|'flapAge'|'flaps'>>;
type Context = Readonly<{ started: boolean; look: LookId | null; firstPerson: boolean; reducedMotion: boolean; descend: boolean; preload: boolean; committedSeconds?: number }>;
type FlightLoader = (url: string) => Promise<{ scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] }>;

/** Use the complete authored beat even if the flight controller enters glide midway. */
export function shoulderPoseTime(flapAge: number): number {
  if (flapAge <= PIGEON_APPROVED_WINGBEAT_SECONDS) return Math.max(0, flapAge);
  const t = THREE.MathUtils.clamp((flapAge - PIGEON_APPROVED_WINGBEAT_SECONDS) / SPREAD_BLEND_SECONDS, 0, 1);
  return SPREAD_WINGS_PHASE * t * t * (3 - 2 * t);
}

/** Only the player's visual is replaced. Flight state/stance, camera and contact are still native. */
export function createFlightPigeon(parent: THREE.Scene, baseUrl: string, load: FlightLoader = async url => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().loadAsync(url);
}) {
  const root = new THREE.Group(); root.name = 'approved-flight-pigeon'; root.visible = false; parent.add(root);
  const headingFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  let loadState: FlightModelReadiness = 'idle';
  let mixer: THREE.AnimationMixer | undefined;
  let action: THREE.AnimationAction | undefined;
  let clipTime: number | null = null;
  let seenFlaps: number | null = null, queuedFlap = false, flapVisualOrigin = 0;
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
      action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      loadState = 'ready';
    }).catch(() => { loadState = 'fallback'; root.visible = false; });
  };
  return {
    root,
    get readiness() { return loadState; },
    snapshot() { return { loadState, visible: root.visible, clip: root.visible ? PIGEON_APPROVED_WINGBEAT : null, clipTime, queuedFlap }; },
    update(bird: FlightState, actor: THREE.Object3D, c: Context): boolean {
      const eligible = c.look === 'pigeon' && !c.firstPerson && !c.reducedMotion;
      // Preflight during the intro but do not concurrently decode both models.
      if (eligible && c.preload && loadState === 'idle') loadOnce();
      const accessibleAir = c.started && eligible && !bird.grounded && !c.descend &&
        (bird.mode === 'flap' || bird.mode === 'glide' || bird.mode === 'fall');
      const committed = (c.committedSeconds ?? .01) > 0;
      if (committed && bird.flaps !== seenFlaps) {
        seenFlaps = bird.flaps;
        flapVisualOrigin = 0;
        queuedFlap = accessibleAir && loadState !== 'ready' && bird.flapAge < PIGEON_APPROVED_WINGBEAT_SECONDS;
      }
      if (!accessibleAir || loadState === 'fallback') { queuedFlap = false; flapVisualOrigin = 0; }
      if (committed && queuedFlap && loadState === 'ready') {
        // The accepted native flight was never blocked. Show the queued visual
        // once after loading, anchored to the current committed flight.
        flapVisualOrigin = bird.flapAge;
        queuedFlap = false;
      }
      const age = Math.max(0, bird.flapAge - flapVisualOrigin);
      const airborne = accessibleAir && (bird.mode !== 'fall' || age < PIGEON_APPROVED_WINGBEAT_SECONDS);
      root.visible = airborne && !queuedFlap && loadState === 'ready';
      clipTime = null;
      if (!root.visible || !mixer || !action) return false;
      root.position.copy(actor.position);
      root.quaternion.copy(actor.quaternion).multiply(headingFlip);
      root.scale.setScalar((bird.body.heightM / NATIVE_STANDING_HEIGHT_M) * NATIVE_BODY_LENGTH_M / MOTION_ASSET_BODY_LENGTH_M);
      clipTime = shoulderPoseTime(age);
      // Sample by committed physics age, not RAF phase, preserving pauses/rejected frames.
      action.time = Math.min(action.getClip().duration - .000001, clipTime);
      mixer.update(0);
      return true;
    },
  };
}
