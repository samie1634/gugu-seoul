
import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { BufferGeometry } from 'three';
import type { BirdBuildOptions, BirdModel, BirdPivots } from '../rig-core/contract.ts';
import { buildBody, buildHead, palette } from './anatomy.ts';
import { buildFoot, buildTail, buildWing } from './flight.ts';
import { add } from './mesh.ts';
import type { Vec } from './mesh.ts';
import { PROFILES } from './profiles.ts';

/** An unposed native-metre bird. The caller owns flight animation and root transforms. */
export function createRaptorBird(options: BirdBuildOptions): BirdModel {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Raptor build options must be an object.');
  }
  const { species, lod } = options;
  const morph = options.morph === undefined ? 'default' : options.morph;
  if (species !== 'tawny-owl' && species !== 'eagle-owl' && species !== 'kestrel') {
    throw new RangeError('Unsupported raptor species: ' + String(species));
  }
  if (morph !== 'default') {
    throw new RangeError('Unsupported raptor morph: ' + String(morph));
  }
  if (lod !== 0 && lod !== 1 && lod !== 2) {
    throw new RangeError('Unsupported raptor LOD: ' + String(lod));
  }

  const profile = PROFILES[species];
  const p = palette(profile);
  const root = new Group();
  root.name = species;
  const pivot = (name: string, location: Vec, side: 1 | -1 = 1) => {
    const group = new Group();
    group.name = name;
    group.position.set(side * location[0], location[1], location[2]);
    root.add(group);
    return group;
  };
  const pivots: BirdPivots = {
    head: pivot('head', profile.head.pivot),
    leftWing: pivot('leftWing', profile.wing.pivot, -1),
    rightWing: pivot('rightWing', profile.wing.pivot),
    tail: pivot('tail', profile.tail.pivot),
    leftFoot: pivot('leftFoot', profile.foot.pivot, -1),
    rightFoot: pivot('rightFoot', profile.foot.pivot),
  };

  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  material.name = species + '-plumage';
  const geometries: BufferGeometry[] = [];
  const attach = (group: Group, name: string, geometry: BufferGeometry, shadow = false) => {
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const head = buildHead(species, profile, p, lod);
  const wing = buildWing(species, profile, p, lod);
  const foot = buildFoot(species, profile, p, lod);
  attach(root, 'body-mesh', buildBody(species, profile, p, lod).geometry(), true);
  attach(pivots.head, 'head-mesh', head.part.geometry());
  attach(pivots.leftWing, 'left-wing-mesh', wing.geometry(-1), true);
  attach(pivots.rightWing, 'right-wing-mesh', wing.geometry(), true);
  attach(pivots.tail, 'tail-mesh', buildTail(species, profile, p, lod).geometry());
  attach(pivots.leftFoot, 'left-foot-mesh', foot.geometry(-1));
  attach(pivots.rightFoot, 'right-foot-mesh', foot.geometry());

  const resources = { geometries, materials: [material] };
  let disposed = false;
  return {
    species, morph, lod, root, pivots, resources,
    metrics: {
      bodyLengthM: profile.bodyLength,
      wingspanM: profile.wingspan,
      standingHeightM: profile.height,
      eye: add(profile.head.pivot, head.eye),
      footY: 0,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}
