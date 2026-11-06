import * as THREE from 'three';
import { BODY_RADIUS } from '../../../../simulation.ts';
import type { BirdBuildOptions, BirdLod, BirdModel } from './contract.ts';
import { bindBirdPose, type BirdPoseInput } from './pose.ts';

export type { BirdPoseInput } from './pose.ts';
export type BirdModelFactory = (options: BirdBuildOptions) => BirdModel;

export interface BirdRigSettings {
  /** A sole origin is native. Use legacy-center only when the caller supplies BirdState.y. */
  origin?: 'sole' | 'legacy-center';
  /** Uniform visual scale. The default 1 preserves native metres. */
  visualScale?: number;
}

export interface BirdRig {
  readonly root: THREE.Group;
  readonly model: BirdModel;
  pose(input: BirdPoseInput): void;
  setLod(lod: BirdLod): void;
  getEyeWorldPosition(target: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export const DEFAULT_VISUAL_SCALE = 1;

interface Visual {
  model: BirdModel;
  stance: THREE.Group;
  eyeInHead: THREE.Vector3;
  pose(input: BirdPoseInput): void;
}

/** The caller owns the world transform of root. All visual motion occurs below it. */
export function createBirdRig(
  options: BirdBuildOptions,
  buildModel: BirdModelFactory,
  settings: BirdRigSettings = {},
): BirdRig {
  const selection = { ...options };
  const scale = settings.visualScale ?? DEFAULT_VISUAL_SCALE;
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Bird visual scale must be finite and positive');

  const root = new THREE.Group();
  const mount = new THREE.Group();
  if (settings.origin === 'legacy-center') mount.position.y = -BODY_RADIUS;
  mount.scale.setScalar(scale);
  root.add(mount);

  const lastPose: BirdPoseInput = { mode: 'rest', time: 0, flapAge: 0, steps: 0 };

  function buildVisual(lod: BirdLod): Visual {
    const model = buildModel({ ...selection, lod });
    // A parented root already belongs to another scene or rig.
    if (model.root.parent) throw new Error('The bird factory must return a detached model');
    try {
      if (model.species !== selection.species || model.lod !== lod) {
        throw new Error('The bird factory returned the wrong species or LOD');
      }
      if (model.metrics.footY !== 0 || !(model.metrics.standingHeightM > 0)
        || !Number.isFinite(model.metrics.standingHeightM)) {
        throw new Error('The bird model must use metres and a zero sole plane');
      }
      if (!model.metrics.eye.every(Number.isFinite)) throw new Error('The bird eye anchor must be finite');
      const stance = new THREE.Group();
      const pose = bindBirdPose(model, stance, scale);
      const eye = new THREE.Vector3(...model.metrics.eye);
      // The model supplies a bind-space eye point. Store it in the moving head's coordinates.
      const eyeInHead = model.pivots.head.worldToLocal(model.root.localToWorld(eye));
      stance.add(model.root);
      pose(lastPose);
      return { model, stance, eyeInHead, pose };
    } catch (error) {
      model.root.removeFromParent();
      model.dispose();
      throw error;
    }
  }

  function release(visual: Visual): void {
    mount.remove(visual.stance);
    visual.stance.remove(visual.model.root);
    visual.model.dispose();
  }

  let active: Visual | undefined = buildVisual(selection.lod);
  mount.add(active.stance);

  function requireVisual(): Visual {
    if (!active) throw new Error('The bird rig has been disposed');
    return active;
  }

  return {
    root,
    get model() { return requireVisual().model; },
    pose(input) {
      requireVisual().pose(input);
      lastPose.mode = input.mode;
      lastPose.time = input.time;
      lastPose.flapAge = input.flapAge;
      lastPose.steps = input.steps;
      lastPose.callAge = input.callAge;
      lastPose.landing = input.landing;
      lastPose.reducedMotion = input.reducedMotion;
    },
    setLod(lod) {
      const previous = requireVisual();
      if (previous.model.lod === lod) return;
      const next = buildVisual(lod);
      mount.add(next.stance);
      active = next;
      release(previous);
    },
    getEyeWorldPosition(target) {
      const { model, eyeInHead } = requireVisual();
      return model.pivots.head.localToWorld(target.copy(eyeInHead));
    },
    dispose() {
      if (!active) return;
      const visual = active;
      active = undefined;
      root.remove(mount);
      release(visual);
    },
  };
}
