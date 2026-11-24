import * as THREE from 'three';
import { FLIRT_SECONDS } from './flirt-action.ts';
import { LANDING_BLEND_SECONDS } from './species-core/upstream/pose-input.ts';
import type { NativeMotionState } from './native/ported/motion/locomotion/b2/native-motion.ts';
import type { LookId } from './progress.ts';
import { PIGEON_AUTO_PECK_EXTENSION, PIGEON_HOLD_WALK_MAX, pigeonAutoPeckClipAge } from './pigeon-kinematics.ts';

export const PIGEON_WALK = 'WalkInPlace_Approved';
export const PIGEON_PECK = 'FoodPeck_ThreeTargets_Approved';
export const PIGEON_REST = 'GroundRest';
export const PIGEON_ASSET_HEIGHT = .750905672;
export const PIGEON_CYCLE_DISTANCE = .426;
export const PIGEON_AUTO_PECK_DELAY = 3.2;
const FLOOR_INPUT_SETTLE_SECONDS = .75;
const OPPONENT_JAB_SECONDS = .36;
const MODEL_UP = new THREE.Vector3(0, 1, 0);

const mod1 = (n: number) => ((n % 1) + 1) % 1;

export function createGroundTiming(idleWait = PIGEON_AUTO_PECK_DELAY) {
  let phase = 0, idle = 0, didPeck = false, peckAge = -1;
  return {
    update(dt: number, distance: number, grounded: boolean, moving: boolean, cycleDistance: number,
      useAutoPeck: boolean, manualPeck: boolean, peckDuration: number) {
      if (!grounded || moving) {
        idle = 0; didPeck = false; peckAge = -1;
        if (grounded && dt > 0 && Number.isFinite(distance) && cycleDistance > 0)
          phase = mod1(phase + distance / cycleDistance);
      } else if (manualPeck) {
        // Existing touchscreen/R actions win, and satisfy this stationary bout.
        idle = 0; didPeck = true; peckAge = -1;
      } else if (!useAutoPeck || peckDuration <= 0) {
        idle = 0; peckAge = -1;
      } else if (dt > 0) {
        idle += dt;
        if (peckAge >= 0) {
          peckAge += dt;
          if (peckAge >= peckDuration) peckAge = -1;
        } else if (!didPeck && idle + 1e-9 >= idleWait) {
          didPeck = true; peckAge = 0;
        }
      }
      return { phase, peckAge };
    },
    reset() { phase = idle = 0; didPeck = false; peckAge = -1; },
  };
}

type GroundContext = Readonly<{
  committedSeconds: number;
  distance: number;
  started: boolean;
  firstPerson: boolean;
  look: LookId | null;
  reducedMotion: boolean;
  manualPeckAge: number;
  manualPeckSerial?: number;
  manualPeckKind?: 'ground'|'opponent';
  flirtAge: number;
  cooAge: number;
  cooMotion?: { forward: number } | null;
  landedRecently: boolean;
}>;
type GroundState = Readonly<Pick<NativeMotionState, 'x'|'y'|'z'|'vx'|'vz'|'heading'|'mode'|'grounded'|'body'|'support'>>;
type GroundModel = { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] };
type GroundLoader = (url: string) => Promise<GroundModel>;

/** Visual-only layer. The native actor retains input, hit tests, camera, collisions, and networking. */
export function createGroundPigeon(parent: THREE.Scene, baseUrl: string,
  load: GroundLoader = async url => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return new GLTFLoader().loadAsync(url);
  }) {
  const root = new THREE.Group();
  root.name = 'approved-ground-pigeon';
  root.visible = false;
  parent.add(root);
  const timing = createGroundTiming();
  let mixer: THREE.AnimationMixer | undefined;
  let head: THREE.Object3D | undefined;
  const restForward = new THREE.Vector3();
  const offsetPoint = new THREE.Vector3();
  const worldAxis = new THREE.Vector3();
  const rootWorld = new THREE.Quaternion(), parentWorld = new THREE.Quaternion(), pitch = new THREE.Quaternion();
  const neck: THREE.Object3D[] = [];
  const overrides: { node: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
  const resetHead = () => {
    for (const { node, position, quaternion } of overrides) {
      node.position.copy(position); node.quaternion.copy(quaternion);
    }
    overrides.length = 0;
  };
  const displace = (node: THREE.Object3D, forward: number) => {
    if (!node.parent) return;
    overrides.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone() });
    node.getWorldPosition(offsetPoint);
    root.worldToLocal(offsetPoint).addScaledVector(restForward, forward);
    node.position.copy(node.parent.worldToLocal(root.localToWorld(offsetPoint)));
  };
  let clips: Partial<Record<'walk'|'peck'|'rest', THREE.AnimationAction>> = {};
  let selected: THREE.AnimationAction | undefined;
  let loadState: 'idle'|'loading'|'ready'|'fallback' = 'idle';
  let seenManualPeck = -1, manualAge = -1, queuedManual = false, queuedWhileWalking = 0;
  let state = { phase: 0, peckAge: -1, manualAge: -1, clip: null as string|null };
  const startLoading = () => {
    loadState = 'loading';
    void load(baseUrl + 'models/idea-pigeon-ground.glb').then(({ scene, animations }) => {
      const walk = animations.find(c => c.name === PIGEON_WALK);
      const peck = animations.find(c => c.name === PIGEON_PECK);
      const rest = animations.find(c => c.name === PIGEON_REST);
      if (!walk || !peck || !rest) throw new Error('Ground pigeon clip manifest mismatch');
      scene.traverse(node => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
        }
      });
      root.add(scene);
      const candidateHead = scene.getObjectByName('Head'), tail = scene.getObjectByName('Tail');
      if (candidateHead?.parent && tail) {
        scene.updateMatrixWorld(true);
        restForward.subVectors(root.worldToLocal(candidateHead.getWorldPosition(new THREE.Vector3())),
          root.worldToLocal(tail.getWorldPosition(new THREE.Vector3())));
        restForward.y = 0;
        if (restForward.lengthSq() > 1e-6) {
          restForward.normalize(); head = candidateHead;
          for (const name of ['NeckMid', 'NeckUpper']) {
            const bone = scene.getObjectByName(name);
            if (bone instanceof THREE.Bone) neck.push(bone);
          }
        }
      }
      mixer = new THREE.AnimationMixer(scene);
      clips = { walk: mixer.clipAction(walk), peck: mixer.clipAction(peck), rest: mixer.clipAction(rest) };
      loadState = 'ready';
    }).catch(() => { loadState = 'fallback'; root.visible = false; });
  };

  return {
    root,
    get ready() { return loadState === 'ready'; },
    get floorBusy() { return queuedManual || manualAge >= 0 || state.peckAge >= 0; },
    snapshot() { return { loadState, visible: root.visible, queuedManual, ...state }; },
    reset() {
      resetHead(); timing.reset(); selected?.stop(); selected = undefined;
      manualAge = -1; queuedManual = false; queuedWhileWalking = 0; seenManualPeck = -1; root.visible = false;
      state = { phase: 0, peckAge: -1, manualAge: -1, clip: null };
    },
    update(bird: GroundState, c: GroundContext): boolean {
      resetHead();
      const eligible = c.look === 'pigeon' && !c.firstPerson;
      // Begin during the intro without exposing the actor or starting idle time.
      if (eligible && loadState === 'idle') startLoading();
      const groundMode = bird.mode === 'rest' || bird.mode === 'walk';
      const grounded = c.started && eligible && bird.grounded && bird.support?.walkable === true && groundMode;
      // Native motion authors an immersed rest pose only after swept water
      // contact; it is not grounded and must not start floor or combat actions.
      const floating = c.started && eligible && !bird.grounded && bird.mode === 'rest';
      const walking = bird.mode === 'walk';
      const beyondWalk = walking && Math.hypot(bird.vx, bird.vz) > PIGEON_HOLD_WALK_MAX;
      const manual = c.manualPeckAge >= 0 && c.manualPeckAge < .5;
      const dt = Number.isFinite(c.committedSeconds) ? Math.max(0, Math.min(.1, c.committedSeconds)) : 0;
      const canQueue = grounded && !c.reducedMotion && loadState !== 'fallback';
      if (dt > 0 && c.manualPeckSerial !== undefined && c.manualPeckSerial !== seenManualPeck) {
        seenManualPeck = c.manualPeckSerial;
        // Replace the waiting visual with the latest accepted input. The native
        // gameplay peck has already been accepted and is never replayed here.
        queuedManual = canQueue && manual && c.manualPeckKind === 'ground';
        queuedWhileWalking = 0;
        manualAge = -1;
      }
      if (!canQueue) { queuedManual = false; manualAge = -1; }
      if (walking) {
        if (queuedManual) {
          queuedWhileWalking += dt;
          if (queuedWhileWalking > FLOOR_INPUT_SETTLE_SECONDS) queuedManual = false;
        }
        manualAge = -1;
      }
      const playQueued = dt > 0 && queuedManual && !walking && loadState === 'ready' && !c.landedRecently;
      const peckDuration = clips.peck?.getClip().duration ?? 0;
      const floorDuration = peckDuration > 0 ? peckDuration + PIGEON_AUTO_PECK_EXTENSION : 0;
      if (playQueued) { queuedManual = false; manualAge = 0; }
      else if (manualAge >= 0) {
        manualAge += dt;
        if (manualAge >= peckDuration) manualAge = -1;
      }
      const coo = !c.reducedMotion && !floating && head && c.cooMotion;
      const jabAge = c.manualPeckAge;
      const jab = grounded && !c.reducedMotion && c.manualPeckKind === 'opponent' &&
        jabAge >= 0 && jabAge < OPPONENT_JAB_SECONDS ? Math.sin(Math.PI * jabAge / OPPONENT_JAB_SECONDS) ** 2 : 0;
      const scale = bird.body.heightM / PIGEON_ASSET_HEIGHT;
      // A call defers a new idle floor sequence but never tears down one already
      // playing. Manual ground action remains immediate once the bird settles.
      const busyWithOtherAction = c.flirtAge < FLIRT_SECONDS || c.landedRecently;
      const t = timing.update(dt, c.distance, grounded && loadState === 'ready', walking, PIGEON_CYCLE_DISTANCE * scale,
        !c.reducedMotion && !busyWithOtherAction && (!coo || state.peckAge >= 0),
        manual || queuedManual || manualAge >= 0, floorDuration);
      state = { ...t, manualAge, clip: null };
      // Do not swap in an old gray model for an input, accessibility mode, fast
      // walk or landing frame. Native gameplay still owns collisions and attacks.
      root.visible = loadState === 'ready' && (grounded || floating);
      if (!root.visible || !mixer) return false;
      root.position.set(bird.x, bird.y - bird.body.centreToSoleM, bird.z);
      root.rotation.y = Math.PI - bird.heading;
      root.scale.setScalar(scale);
      const walkVisual = walking && !c.reducedMotion && !beyondWalk;
      const floorAge = manualAge >= 0 ? manualAge : t.peckAge;
      const next = walkVisual ? clips.walk : floorAge >= 0 && !c.reducedMotion ? clips.peck : clips.rest;
      if (next !== selected) { selected?.stop(); selected = next; next?.reset().play(); }
      if (next) {
        const duration = next.getClip().duration;
        next.time = walkVisual ? duration * t.phase : next === clips.peck
          ? Math.min(duration - .000001, manualAge >= 0 ? floorAge : pigeonAutoPeckClipAge(floorAge, duration)) : 0;
        mixer.update(0);
      }
      if (head?.parent && next !== clips.peck) {
        if (jab > 0) {
          // Same native pulse, reach (24% of height) and downward bill angle.
          // Split extension across the skinned neck to keep the collar/socket
          // attached; the anchor, torso and feet keep their current pose.
          const reach = PIGEON_ASSET_HEIGHT * .24 * jab;
          for (const bone of neck) displace(bone, reach * .28);
          displace(head, reach * (1 - .28 * neck.length));
          root.getWorldQuaternion(rootWorld);
          head.parent.getWorldQuaternion(parentWorld).invert();
          worldAxis.crossVectors(MODEL_UP, restForward).normalize().applyQuaternion(rootWorld).applyQuaternion(parentWorld);
          head.quaternion.premultiply(pitch.setFromAxisAngle(worldAxis, .18 * jab));
        } else if (coo && coo.forward > 0) {
          displace(head, coo.forward);
        }
      }
      state.clip = next?.getClip().name ?? null;
      return true;
    },
  };
}

export const isGroundLandingBlend = (secondsSinceLanding: number) =>
  secondsSinceLanding >= 0 && secondsSinceLanding < LANDING_BLEND_SECONDS;
