import * as THREE from 'three';
import { Painter } from '../../../../geometry.ts';
import type { MapLayout, MapQuality } from '../contracts.ts';
import { sampleGround } from '../layout.ts';
import { mappedTreeNodes, mappedTreeSource } from './tree-data.ts';

export const TREE_RENDER_BUDGET = Object.freeze({
  maxTrees: 162, cellMetres: 192, maxChunks: 18,
  lodMetres: { mobile: 180, desktop: 260 },
  shadowMetres: { mobile: 75, desktop: 135 },
  minHeight: 2.4, maxHeight: 7.6, maxCrownRadius: 2.2,
});

type CrownKind = (typeof mappedTreeNodes)[number][3];

/** These dimensions are original artwork, never measured attributes of the OSM node. */
export function treeArtworkScale(id: number, x: number, z: number) {
  let nearest = Infinity;
  for (const [otherId, otherX, otherZ] of mappedTreeNodes) {
    if (id !== otherId) nearest = Math.min(nearest, Math.hypot(otherX - x, otherZ - z));
  }
  const variation = ((Math.imul(id % 2147483647, 2654435761) >>> 0) % 1000) / 1000;
  const radius = Math.min(TREE_RENDER_BUDGET.maxCrownRadius, Math.max(0.3, nearest * 0.42));
  const height = Math.min(TREE_RENDER_BUDGET.maxHeight,
    Math.max(TREE_RENDER_BUDGET.minHeight, radius * 2.6 + 1.2 + variation * 0.6));
  return { radius, height, turn: variation * Math.PI * 2, variation };
}

/** One canonical tree mesh per shape/LOD, shared by all geographic cell instances. */
function treeGeometry(kind: CrownKind, distant: boolean): THREE.BufferGeometry {
  const painter = new Painter();
  const trunk = new THREE.CylinderGeometry(0.075, 0.105, 0.58, distant ? 4 : 6);
  painter.add(trunk, kind === 'needleleaf' ? '#9c9d87' : '#655447', new THREE.Vector3(0, 0.29, 0));
  if (kind === 'needleleaf') {
    // The one Pinus bungeana record gets an open, evergreen crown silhouette.
    const layers = distant ? [[0, 0.7, 0, 0.94, 0.3]] : [
      [-0.27, 0.66, 0.04, 0.72, 0.23], [0.32, 0.73, 0.03, 0.61, 0.22], [0, 0.85, -0.19, 0.66, 0.15],
    ];
    for (const [x, y, z, radius, height] of layers) {
      painter.add(new THREE.IcosahedronGeometry(1, 0), '#37654e', new THREE.Vector3(x, y, z), new THREE.Vector3(radius, height, radius * 0.83));
    }
  } else {
    const lobes = distant ? [[0, 0.7, 0, 1, 0.3, 0.94]] : [
      [0, 0.77, -0.04, 0.75, 0.23, 0.77], [-0.32, 0.63, 0.08, 0.68, 0.24, 0.66],
      [0.34, 0.64, 0.12, 0.65, 0.24, 0.69], [0.06, 0.61, -0.34, 0.67, 0.22, 0.65],
    ];
    lobes.forEach(([x, y, z, rx, ry, rz], index) => {
      painter.add(new THREE.IcosahedronGeometry(1, 0), ['#518050', '#426f48', '#618a52', '#4b7951'][index],
        new THREE.Vector3(x, y, z), new THREE.Vector3(rx, ry, rz));
    });
  }
  if (!distant) {
    const branch = (end: THREE.Vector3) => {
      const start = new THREE.Vector3(0, 0.35, 0), vector = end.clone().sub(start);
      const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize()));
      painter.add(new THREE.CylinderGeometry(0.021, 0.044, vector.length(), 5, 1, true), '#716050',
        start.add(end).multiplyScalar(0.5), undefined, rotation);
    };
    branch(new THREE.Vector3(-0.35, 0.7, 0.1)); branch(new THREE.Vector3(0.37, 0.72, -0.08));
  }
  const geometry = painter.geometry();
  geometry.computeBoundingBox();
  return geometry;
}

/** Render only source-registered outdoor points. Never move nodes or add player colliders. */
export function createMappedTreeLods(layout: MapLayout, quality: MapQuality) {
  const root = new THREE.Group(); root.name = 'osm:registered-trees';
  root.userData.source = mappedTreeSource;
  root.userData.locationProvenance = 'OSM registered outdoor tree coordinates; not current field-survey verification';
  root.userData.shapeProvenance = 'Original procedural silhouettes and unmeasured dimensions; no map imagery textures';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
  const farMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const geometries = new Map<string, THREE.BufferGeometry>();
  const geometry = (kind: CrownKind, distant: boolean) => {
    const key = `${kind}:${distant}`;
    let result = geometries.get(key);
    if (!result) { result = treeGeometry(kind, distant); geometries.set(key, result); }
    return result;
  };
  type Entry = { id: number; x: number; y: number; z: number; kind: CrownKind; art: ReturnType<typeof treeArtworkScale> };
  const cells = new Map<string, Entry[]>();
  for (const [id, x, z, kind] of mappedTreeNodes) {
    const ground = sampleGround(layout, x, z);
    if (!ground.walkable || !Number.isFinite(ground.y)) continue;
    const key = `${Math.floor(x / TREE_RENDER_BUDGET.cellMetres)}:${Math.floor(z / TREE_RENDER_BUDGET.cellMetres)}:${kind}`;
    const list = cells.get(key) ?? [];
    list.push({ id, x, y: ground.y, z, kind, art: treeArtworkScale(id, x, z) }); cells.set(key, list);
  }
  const transform = new THREE.Object3D();
  let count = 0, nearTriangles = 0, farTriangles = 0, instanceBytes = 0;
  for (const [key, entries] of cells) {
    // Centre LOD on occupied points, not an empty grid corner. A 180 m mobile
    // transition exceeds the maximum 136 m radius of a 192 m square cell.
    const x = (Math.min(...entries.map(entry => entry.x)) + Math.max(...entries.map(entry => entry.x))) / 2;
    const z = (Math.min(...entries.map(entry => entry.z)) + Math.max(...entries.map(entry => entry.z))) / 2;
    const lod = new THREE.LOD(); lod.name = `osm:tree-cell:${key}`; lod.position.set(x, 0, z);
    const near = new THREE.InstancedMesh(geometry(entries[0].kind, false), material, entries.length);
    const far = new THREE.InstancedMesh(geometry(entries[0].kind, true), farMaterial, entries.length);
    near.name = lod.name + ':near'; far.name = lod.name + ':far';
    near.receiveShadow = true; near.castShadow = false;
    far.receiveShadow = false; far.castShadow = false;
    near.userData.nodeIds = entries.map(entry => entry.id); far.userData.nodeIds = near.userData.nodeIds;
    entries.forEach((entry, index) => {
      const { radius, height, turn, variation } = entry.art;
      transform.position.set(entry.x - x, entry.y, entry.z - z);
      transform.rotation.set(0, turn, 0); transform.scale.set(radius, height, radius); transform.updateMatrix();
      const tint = new THREE.Color().setRGB(0.92 + variation * 0.08, 0.94 + variation * 0.06, 0.92 + variation * 0.08);
      near.setMatrixAt(index, transform.matrix); far.setMatrixAt(index, transform.matrix);
      near.setColorAt(index, tint); far.setColorAt(index, tint);
    });
    for (const mesh of [near, far]) {
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      instanceBytes += mesh.instanceMatrix.array.byteLength + mesh.instanceColor!.array.byteLength;
    }
    nearTriangles += near.geometry.attributes.position.count / 3 * near.count;
    farTriangles += far.geometry.attributes.position.count / 3 * far.count;
    lod.addLevel(near, 0); lod.addLevel(far, TREE_RENDER_BUDGET.lodMetres[quality], 0.12);
    const update = lod.update.bind(lod), eye = new THREE.Vector3(), point = new THREE.Vector3();
    lod.update = camera => {
      update(camera);
      camera.getWorldPosition(eye);
      // An instance batch casts only when EVERY root is within the shadow
      // radius. This conservative rule prevents a nearby tree enabling remote
      // shadows for its whole cell and needs no extra shadow-only meshes.
      near.castShadow = near.visible && entries.every(entry => {
        point.set(entry.x - x, entry.y, entry.z - z).applyMatrix4(lod.matrixWorld);
        return eye.distanceTo(point) <= TREE_RENDER_BUDGET.shadowMetres[quality];
      });
    };
    root.add(lod); count += entries.length;
  }
  const budget = {
    count, chunks: cells.size, drawCalls: cells.size, allocatedMeshes: cells.size * 2,
    nearTriangles, farTriangles, allocatedTriangles: nearTriangles + farTriangles,
    geometryBytes: [...geometries.values()].reduce((sum, value) => sum + Object.values(value.attributes).reduce((n, attribute) => n + attribute.array.byteLength, 0), 0),
    instanceBytes, textureBytes: 0, addedColliders: 0,
    lodMetres: TREE_RENDER_BUDGET.lodMetres[quality], shadowMetres: TREE_RENDER_BUDGET.shadowMetres[quality],
  };
  root.userData.renderBudget = budget;
  let disposed = false;
  return { root, budget, dispose() {
    if (disposed) return; disposed = true;
    root.removeFromParent(); root.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    geometries.forEach(value => value.dispose()); material.dispose(); farMaterial.dispose(); root.clear();
  } };
}
