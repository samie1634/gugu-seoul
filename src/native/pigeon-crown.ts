import * as THREE from 'three';

const counts = [0, 2, 5, 8, 11, 15] as const;
export function pigeonCrownStage(hits: number): number {
  return Number.isFinite(hits) ? Math.min(5, Math.max(0, Math.floor(hits))) : 0;
}

/** Front crown only. Surface down expands first; the tallest strands sweep back. */
export function makePigeonCrown(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Group {
  const group = new THREE.Group(); group.name = 'pecked-white-crown'; group.visible = false;
  const up = new THREE.Vector3(0, 1, 0);
  const strands = [
    [-.002, -.013, .008, .69], [.002, -.010, .009, .63],
    [-.0045, -.015, .008, .73], [.005, -.008, .008, .67], [0, -.005, .010, .64],
    [-.007, -.012, .008, .72], [.007, -.012, .008, .72], [-.003, -.004, .015, .76],
    [.002, -.003, .018, .82], [-.004, .001, .0165, .76], [.004, .002, .019, .85],
    [.0005, .004, .023, .91], [-.0023, .006, .029, .97], [.0027, .006, .024, .92], [0, .009, .026, .95],
  ] as const;
  // Local skull heights sampled on the shipped procedural pigeon head at each strand root.
  const skullY = [.0498, .0510, .0484, .0512, .0531, .0491, .0491, .0525,
    .0529, .0529, .0530, .0536, .0528, .0527, .0525];
  strands.forEach(([x, z, length, lift], i) => {
    const feather = new THREE.Mesh(geometry, material);
    const surfaceY = skullY[i];
    const direction = new THREE.Vector3(x * 5, lift, Math.sqrt(1 - lift * lift)).normalize();
    // The proximal tip is buried just under the lightly curved skull surface.
    const root = new THREE.Vector3(x, surfaceY - .0005, z);
    feather.name = `crown-down:${i}`;
    feather.scale.set(i < 7 ? .00175 : .00125, length * .53, i < 7 ? .0011 : .00082);
    feather.position.copy(root).addScaledVector(direction, length / 2);
    feather.quaternion.setFromUnitVectors(up, direction);
    feather.visible = false; group.add(feather);
  });
  return group;
}

export function updatePigeonCrown(group: THREE.Group, hits: number): void {
  const stage = pigeonCrownStage(hits);
  group.visible = stage > 0;
  for (let i = 0; i < group.children.length; i++) group.children[i].visible = i < counts[stage];
}
