import * as THREE from 'three';
import type { BirdBuildOptions, BirdModel, BirdPivots } from '../rig-core/contract.ts';
import { createHeronNeckGeometry } from './neck.ts';

/** Original grey-heron anatomy in metres. No downloaded model or texture assets. */
export function createHeronBird(options: BirdBuildOptions): BirdModel {
  if (options.species !== 'heron' || ![0, 1, 2].includes(options.lod) || (options.morph ?? 'default') !== 'default') throw new RangeError('Unsupported heron build');
  const lod = options.lod, detail = [16, 10, 8][lod];
  const root = new THREE.Group(); root.name = 'heron';
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const material = (color: string, roughness = .88) => { const m = new THREE.MeshStandardMaterial({ color, roughness }); materials.push(m); return m; };
  const grey = material('#87939a'), pale = material('#dadbd3'), dark = material('#353d41'), bill = material('#c6a35f'), leg = material('#888565'), eye = material('#d7bb5f'), pupil = material('#101414');
  const mesh = (owner: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, paint: THREE.Material, at: readonly number[] = [0, 0, 0]) => {
    geometries.push(geometry); const object = new THREE.Mesh(geometry, paint); object.name = name;
    object.position.set(at[0], at[1], at[2]); object.castShadow = object.receiveShadow = true; owner.add(object); return object;
  };
  const ellipsoid = (owner: THREE.Object3D, name: string, at: readonly number[], size: readonly number[], paint: THREE.Material) => {
    const object = mesh(owner, name, new THREE.SphereGeometry(1, detail, Math.max(6, detail / 2)), paint, at); object.scale.set(size[0], size[1], size[2]); return object;
  };
  const tube = (owner: THREE.Object3D, name: string, points: THREE.Vector3[], radius: number, paint: THREE.Material) => mesh(owner, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), detail * 2, radius, Math.max(6, detail / 2), false), paint);
  const group = (owner: THREE.Object3D, name: string, x: number, y: number, z: number) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); owner.add(g); return g; };
  ellipsoid(root, 'body-mesh', [0, .64, .035], [.115, .15, .24], grey);
  ellipsoid(root, 'breast', [0, .64, -.09], [.087, .16, .13], pale);
  const neck = group(root, 'neck', 0, .66, -.13);
  mesh(neck, 'heron-neck', createHeronNeckGeometry(detail), pale);
  const head = group(neck, 'head', 0, .265, -.16);
  ellipsoid(head, 'head-mesh', [0, .008, -.012], [.041, .042, .072], pale);
  ellipsoid(head, 'crown-stripe', [0, .036, .004], [.033, .012, .058], dark);
  const upper = mesh(head, 'upper-beak', new THREE.ConeGeometry(.022, .235, 4), bill, [0, 0, -.169]); upper.rotation.x = -Math.PI / 2; upper.scale.x = .55;
  const lower = mesh(head, 'lower-beak', new THREE.ConeGeometry(.010, .22, 4), bill, [0, -.015, -.159]); lower.rotation.x = -Math.PI / 2; lower.scale.x = .7;
  for (const side of [-1, 1]) {
    ellipsoid(head, 'iris', [side * .037, .013, -.038], [.005, .007, .007], eye);
    ellipsoid(head, 'pupil', [side * .041, .013, -.039], [.002, .0037, .0037], pupil);
    const plume = mesh(head, 'head-plume', new THREE.ConeGeometry(.009, .16, 4), dark, [side * .018, .025, .10]); plume.rotation.x = Math.PI / 2;
  }
  const leftWing = group(root, 'leftWing', -.085, .70, .015), rightWing = group(root, 'rightWing', .085, .70, .015);
  for (const [wing, side] of [[leftWing, -1], [rightWing, 1]] as const) {
    ellipsoid(wing, 'wing-coverts', [side * .27, -.005, .015], [.30, .035, .15], grey);
    for (let f = 0; f < 7 - lod; f++) {
      const feather = ellipsoid(wing, 'flight-feather', [side * (.39 + f * .055), -.009, .06 + f * .013], [.18 - f * .009, .013, .041], f > 2 ? dark : grey);
      feather.rotation.y = side * (-.06 - f * .055);
    }
  }
  const tail = group(root, 'tail', 0, .61, .22); ellipsoid(tail, 'tail-feathers', [0, -.025, .06], [.075, .022, .10], dark);
  const leftFoot = group(root, 'leftFoot', -.045, .40, .025), rightFoot = group(root, 'rightFoot', .045, .40, .025);
  for (const foot of [leftFoot, rightFoot]) {
    tube(foot, 'long-leg', [new THREE.Vector3(0, .23, 0), new THREE.Vector3(0, -.12, .018), new THREE.Vector3(0, -.388, 0)], .008, leg);
    for (const spread of [-1, 0, 1]) {
      const toe = mesh(foot, 'toe', new THREE.CylinderGeometry(.006, .006, .10, 8), leg, [spread * .014, -.394, -.038]);
      toe.rotation.x = Math.PI / 2; toe.rotation.z = spread * .25;
    }
  }
  const pivots: BirdPivots = { head, leftWing, rightWing, tail, leftFoot, rightFoot };
  let disposed = false;
  return { species: 'heron', morph: 'default', lod, root, pivots,
    metrics: { bodyLengthM: 1.02, wingspanM: 1.75, standingHeightM: 1.02, footY: 0, eye: [.041, .938, -.329] },
    resources: { geometries, materials }, dispose() { if (disposed) return; disposed = true; geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}
