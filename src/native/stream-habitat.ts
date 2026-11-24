import * as THREE from 'three';
import { createStreamRockGeometry, createStreamRockMaterial, registerStreamRocks } from './stream-rock-shape.ts';
import type { BirdPoint } from './bird-behavior.ts';
import type { MapLayout } from './ported/map/contracts.ts';
import { sampleGround, sampleWater } from './ported/map/layout.ts';
import type { NativeWorldQueries } from './ported/motion/locomotion/b2/contracts.ts';
import { footprintBounds } from './ported/map/real-map/geometry.ts';

export interface StreamSupport extends BirdPoint { surfaceY: number; kind: 'shoal' | 'rock'; radiusX: number; radiusZ: number }
const activeSupports = new WeakMap<MapLayout, StreamSupport[]>();
export function streamStoneAt(layout: MapLayout, x: number, z: number, margin = 0) {
  return activeSupports.get(layout)?.find(s => ((x - s.x) / (s.radiusX * 1.16 + margin)) ** 2 + ((z - s.z) / (s.radiusZ * 1.16 + margin)) ** 2 <= 1) ?? null;
}
/** All stones are original procedural geometry. Animal sole heights share their visible flat tops. */
export function createStreamHabitat(parent: THREE.Object3D, layout: MapLayout, queries?: NativeWorldQueries) {
  const root = new THREE.Group(); root.name = 'stream-stones'; parent.add(root);
  const waterAt = (x: number, z: number) => {
    const ground = sampleGround(layout, x, z), water = sampleWater(layout, x, ground.y, z);
    return water && water.depth >= .18 && water.depth <= .8 ? { x, y: ground.y, z, surfaceY: water.y } : null;
  };
  const bounds = layout.realMap ? layout.realMap.water.map(w => footprintBounds(w.rings)) : [{ minX: layout.water.minX, maxX: layout.water.maxX, minZ: layout.water.minZ, maxZ: layout.water.maxZ }];
  const candidates: (BirdPoint & { surfaceY: number })[] = [];
  for (const b of bounds) {
    const stepX = Math.max(2.8, (b.maxX - b.minX) / 220), stepZ = Math.max(2.4, (b.maxZ - b.minZ) / 70);
    for (let x = b.minX + 2; x < b.maxX - 1; x += stepX) for (let z = b.minZ + 1.5; z < b.maxZ - 1; z += stepZ) {
      const point = waterAt(x, z); if (point) candidates.push(point);
    }
  }
  const supports: StreamSupport[] = [];
  for (const point of candidates) {
    if (supports.length >= 12) break;
    if (supports.some(s => Math.hypot(point.x - s.x, point.z - s.z) < 14)) continue;
    if (![[2.35, 0], [-2.35, 0], [0, 1.72], [0, -1.72], [1.6,1.2], [-1.6,1.2], [1.6,-1.2], [-1.6,-1.2]].every(([dx, dz]) => waterAt(point.x + dx, point.z + dz))) continue;
    if (queries && queries.sweepSphere({ x: point.x, y: point.surfaceY + .45, z: point.z }, { x: point.x, y: point.surfaceY + 6.2, z: point.z }, .24) !== null) continue;
    const kind = supports.length % 2 ? 'rock' : 'shoal';
    // Emergent stones need a clear exit beside the bank for the widest native
    // bird (heron body radius < .60m), not just enough water for the stone itself.
    if (kind === 'rock' && ![[3.2, 0], [-3.2, 0], [0, 2.5], [0, -2.5], [2.3, 1.8], [-2.3, 1.8], [2.3, -1.8], [-2.3, -1.8]].every(([dx, dz]) => waterAt(point.x + dx, point.z + dz))) continue;
    const variation = supports.length;
    supports.push({ ...point, y: point.surfaceY + (kind === 'rock' ? .22 + .07 * (1 + Math.sin(variation * 1.73)) : -.14), kind,
      radiusX: variation === 0 ? 2 : 1.65 + .24 * (1 + Math.sin(variation * 2.13)),
      radiusZ: variation === 0 ? 1.45 : 1.17 + .14 * (1 + Math.cos(variation * 1.41)) });
  }
  activeSupports.set(layout, supports);
  const rockGeometry = new THREE.IcosahedronGeometry(1, 0), topGeometry = createStreamRockGeometry();
  const mineralColors = Array.from({ length: rockGeometry.getAttribute('position').count }, (_, i) => { const shade = .8 + .12 * Math.sin(i * 2.73); return [shade, shade * .99, shade * .95]; }).flat();
  rockGeometry.setAttribute('color', new THREE.Float32BufferAttribute(mineralColors, 3));
  const material = createStreamRockMaterial();
  const unregister = registerStreamRocks(layout, supports.map(p => ({ ...p, bedY: waterAt(p.x, p.z)!.y })));
  const transform = new THREE.Object3D(), color = new THREE.Color();
  const stones = candidates.flatMap((p, i) => {
    const edge = [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]].some(([dx, dz]) => !waterAt(p.x + dx, p.z + dz));
    return [{ ...p, edge, seed: i * 1.73 }];
  });
  const selected = stones.filter((_, i) => i % Math.max(1, Math.ceil(stones.length / 800)) === 0);
  const gravel = new THREE.InstancedMesh(rockGeometry, material, selected.length); gravel.name = 'stream-bed-and-edge-stones';
  selected.forEach((p, i) => {
    const size = p.edge ? .34 + .15 * (1 + Math.sin(p.seed)) : .11 + .11 * (1 + Math.sin(p.seed));
    const height = p.edge ? .18 : .07;
    transform.position.set(p.x, p.y + height * .62, p.z); transform.rotation.set(.1, p.seed, .08); transform.scale.set(size, height, size * .74); transform.updateMatrix(); gravel.setMatrixAt(i, transform.matrix);
    gravel.setColorAt(i, color.setHSL(.11, .08, .31 + (1 + Math.sin(p.seed * 2)) * .09));
  }); gravel.receiveShadow = true; gravel.computeBoundingSphere(); root.add(gravel);
  const perches = new THREE.InstancedMesh(topGeometry, material, supports.length); perches.name = 'stream-shallow-shoals-and-perch-rocks';
  supports.forEach((p, i) => {
    const bed = waterAt(p.x, p.z)!.y, height = p.y - bed;
    transform.position.set(p.x, bed, p.z); transform.rotation.set(0, 0, 0); transform.scale.set(p.radiusX, height, p.radiusZ); transform.updateMatrix(); perches.setMatrixAt(i, transform.matrix);
    perches.setColorAt(i, color.set(p.kind === 'rock' ? '#797b73' : '#a39b81'));
  }); perches.receiveShadow = true; perches.computeBoundingSphere(); root.add(perches);
  const supportAt = (x: number, z: number): StreamSupport | null => {
    // The .72 inset lies inside the irregular stone crown, including room for both feet.
    const p = supports.find(s => ((x - s.x) / s.radiusX) ** 2 + ((z - s.z) / s.radiusZ) ** 2 < .72 ** 2);
    return p ? { ...p, x, z } : null;
  };
  let disposed = false;
  return { root, supports, candidates, waterAt, supportAt, stoneAt: (x: number, z: number, margin = 0) => streamStoneAt(layout, x, z, margin), stoneCount: selected.length + supports.length,
    dispose() { if (disposed) return; disposed = true; unregister(); if (activeSupports.get(layout) === supports) activeSupports.delete(layout); root.removeFromParent(); gravel.dispose(); perches.dispose(); rockGeometry.dispose(); topGeometry.dispose(); material.dispose(); root.clear(); },
  };
}
