import * as THREE from 'three';
import type { LookId } from '../progress.ts';
import type { NativeBody } from './ported/motion/locomotion/b2/contracts.ts';
import { createBirdRig, type BirdRig } from './ported/birds/rig-core/rig.ts';
import { createUrbanBird } from './ported/birds/urban/models.ts';
import { createRaptorBird } from './ported/birds/raptors/models.ts';
import { cameraNearRadius } from './ported/motion/controls/camera-resolver.ts';

/** A native bird needs centimetre-scale close focus; also bound the full wide-screen lens volume. */
export function nativeNear(body: NativeBody, verticalFovDegrees: number, aspect: number): number {
  const factor = cameraNearRadius({ near: 1, verticalFovDegrees, aspect });
  const value = Math.min(0.12, body.heightM * 0.1, (body.eyeFromSoleM.y - 0.006) / factor);
  if (!Number.isFinite(value) || value <= 0.001) throw new Error('Native eye cannot support this projection');
  return value;
}

export function buildNativeBird(look: LookId): BirdRig {
  const species = look === 'owl' ? 'eagle-owl' : 'pigeon';
  const rig = createBirdRig({ species, lod: 0, morph: look === 'white' ? 'white' : 'default' },
    look === 'owl' ? createRaptorBird : createUrbanBird, { origin: 'sole', visualScale: 1 });
  rig.pose({ mode: 'rest', time: 0, flapAge: 10, steps: 0, reducedMotion: true });
  rig.root.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  return rig;
}

/** B1 metre geometry. The pigeon body radius is the reviewed temporary B2 proxy. */
export function measureNativeBody(rig: BirdRig): NativeBody {
  rig.root.updateMatrixWorld(true);
  const feet = new THREE.Box3().setFromObject(rig.model.pivots.leftFoot, true)
    .union(new THREE.Box3().setFromObject(rig.model.pivots.rightFoot, true));
  const body = new THREE.Box3();
  for (const name of ['body', 'body-mesh', 'head']) {
    const mesh = rig.model.root.getObjectByName(name);
    if (mesh) body.union(new THREE.Box3().setFromObject(mesh, true));
  }
  if (body.isEmpty()) body.setFromObject(rig.model.root, true);
  const radius = (bounds: THREE.Box3) => Math.max(...[bounds.min.x, bounds.max.x].flatMap(x =>
    [bounds.min.z, bounds.max.z].map(z => Math.hypot(x, z))));
  const height = rig.model.metrics.standingHeightM;
  const eye = rig.getEyeWorldPosition(new THREE.Vector3());
  return Object.freeze({
    horizontalRadiusM: rig.model.species === 'pigeon' ? 0.173 : radius(body),
    heightM: height, centreToSoleM: height / 2, footSupportRadiusM: radius(feet),
    eyeFromSoleM: Object.freeze({ x: eye.x, y: eye.y, z: eye.z }),
  });
}
