import * as THREE from 'three';
import type { Appearance } from '../native/ported/shared-contracts.ts';
import type { BirdBuildOptions, BirdLod } from '../native/ported/birds/rig-core/contract.ts';
import { createBirdRig, type BirdRig } from '../native/ported/birds/rig-core/rig.ts';
import { createUrbanBird } from '../native/ported/birds/urban/models.ts';
import { createRaptorBird } from '../native/ported/birds/raptors/models.ts';
import { measureNativeBody } from '../native/body-profile.ts';
import type { NativeBody } from '../native/ported/motion/locomotion/b2/contracts.ts';
import { createCandidateFactory, optionsForAppearance } from './upstream/rig-adapter.ts';
import { normalizeAppearance, validateLod } from './appearance.ts';

const factory = createCandidateFactory(createUrbanBird, createRaptorBird);
export const NEUTRAL_POSE = Object.freeze({ mode: 'rest' as const, time: 0, flapAge: 10, steps: 0, reducedMotion: true });
export const defaultBuildRig = (options: BirdBuildOptions): BirdRig =>
  createBirdRig(options, factory, { origin: 'sole', visualScale: 1 });
export interface Bounds { readonly min: readonly number[]; readonly max: readonly number[] }
export interface Measurement {
  readonly body: NativeBody;
  readonly bounds: Bounds;
  readonly feet: Bounds;
  readonly eye: readonly number[];
  readonly rootScale: readonly number[];
}
const plain = (box: THREE.Box3): Bounds => Object.freeze({ min: Object.freeze(box.min.toArray()), max: Object.freeze(box.max.toArray()) });

/** Vertex bounds in the rig's coordinate frame, independent of its placement/yaw. */
export function localGeometryBounds(rig: BirdRig, object: THREE.Object3D = rig.model.root): Bounds {
  rig.root.updateWorldMatrix(true, true);
  const inverse = rig.root.matrixWorld.clone().invert(), box = new THREE.Box3(), v = new THREE.Vector3();
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const positions = node.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) box.expandByPoint(v.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).applyMatrix4(inverse));
  });
  if (box.isEmpty() || ![...box.min, ...box.max].every(Number.isFinite)) throw new Error('Invalid local vertex bounds');
  return plain(box);
}

/** Never normalizes a placed/live rig. Neutralization is allowed only while detached at identity. */
export function measureOriginRig(rig: BirdRig): Measurement {
  if (rig.root.parent || rig.root.position.lengthSq() !== 0 || rig.root.quaternion.angleTo(new THREE.Quaternion()) > 1e-12 ||
    !rig.root.scale.equals(new THREE.Vector3(1, 1, 1)) || !rig.root.matrixAutoUpdate) throw new Error('Origin measurement requires a detached identity rig');
  rig.pose(NEUTRAL_POSE); rig.root.updateMatrixWorld(true);
  const body = measureNativeBody(rig);
  if (![body.heightM, body.horizontalRadiusM, body.footSupportRadiusM, body.centreToSoleM, ...Object.values(body.eyeFromSoleM)].every(Number.isFinite) ||
    body.heightM <= body.centreToSoleM || body.centreToSoleM <= 0 || body.horizontalRadiusM <= 0 || body.footSupportRadiusM <= 0) throw new Error('Invalid measured bird body');
  const feetBox = new THREE.Box3().setFromObject(rig.model.pivots.leftFoot, true).union(new THREE.Box3().setFromObject(rig.model.pivots.rightFoot, true));
  if (Math.abs(feetBox.min.y) > 1e-6) throw new Error('Measured soles are not at zero');
  return Object.freeze({ body, bounds: localGeometryBounds(rig), feet: plain(feetBox),
    eye: Object.freeze(rig.getEyeWorldPosition(new THREE.Vector3()).toArray()), rootScale: Object.freeze(rig.root.scale.toArray()) });
}

export interface AssetDependencies {
  readonly buildRig?: (options: BirdBuildOptions) => BirdRig;
  readonly measure?: (rig: BirdRig) => Measurement;
}
export interface BirdAsset {
  readonly appearance: Appearance;
  readonly lod: BirdLod;
  readonly rig: BirdRig;
  /** Physics is pinned to this species/skin's LOD0 measurement, never a visual LOD change. */
  readonly body: NativeBody;
  readonly measurement: Measurement;
  readonly modelMetrics: Readonly<BirdRig['model']['metrics']>;
  /** Cleanup is post-adoption: report callback failures without undoing a winner. */
  readonly cleanupErrors: readonly string[];
  dispose(): void;
}

/** Keep all normal dispose callbacks; isolate a throwing callback per owned resource. */
function releaseRig(rig: BirdRig, errors: string[]): void {
  const report=(error:unknown)=>errors.push(error instanceof Error?error.message:String(error));
  const attempted=new Set<THREE.BufferGeometry|THREE.Material>();
  const originals=new Map<THREE.BufferGeometry|THREE.Material,()=>void>();
  try{
    for(const resource of new Set([...rig.model.resources.geometries,...rig.model.resources.materials])){
      const original=resource.dispose;originals.set(resource,original);
      resource.dispose=()=>{if(attempted.has(resource))return;attempted.add(resource);try{original.call(resource);}catch(error){report(error);}};
    }
    try{rig.dispose();}catch(error){report(error);}
  }catch(error){report(error);}
  finally{
    // A root/model callback may throw before the producer reaches its resource loop.
    for(const [resource,original]of originals){if(!attempted.has(resource)){attempted.add(resource);try{original.call(resource);}catch(error){report(error);}}}
    for(const [resource,original]of originals)resource.dispose=original;
  }
}

export function buildNativeAppearance(value: Appearance, targetLod: BirdLod = 0, dependencies: AssetDependencies = {}): BirdAsset {
  const appearance = normalizeAppearance(value), lod = validateLod(targetLod);
  const build = dependencies.buildRig ?? defaultBuildRig, measure = dependencies.measure ?? measureOriginRig;
  const owned = new Set<BirdRig>(),cleanupErrors:string[]=[];
  function make(level: BirdLod): BirdRig {
    const rig = build(optionsForAppearance(appearance, level));
    // A parented result is borrowed and must never be released by this owner.
    if (rig.root.parent) throw new Error('Factory returned a borrowed/parented rig');
    owned.add(rig);
    const expected = optionsForAppearance(appearance, level);
    if (rig.model.species !== expected.species || rig.model.lod !== level || rig.model.morph !== expected.morph) throw new Error('Factory identity mismatch');
    return rig;
  }
  try {
    const rig = make(lod), measurement = measure(rig);
    let body = measurement.body;
    if (lod !== 0) {
      const canonical = make(0); body = measure(canonical).body;
      releaseRig(canonical,cleanupErrors); owned.delete(canonical);
    }
    let disposed = false;
    return { appearance, lod, rig, body, measurement, modelMetrics:Object.freeze({...rig.model.metrics}), cleanupErrors, dispose() {
      if (disposed) return; disposed = true; owned.delete(rig); releaseRig(rig,cleanupErrors);
    } };
  } catch (error) {
    for (const rig of owned) releaseRig(rig,cleanupErrors);
    throw error;
  }
}
