import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { defaultBuildRig } from '../src/species-core/assets.ts';
import { HERON_FOLDED_HEAD, HERON_EXTENDED_HEAD, heronNeckExtension } from '../src/native/ported/birds/heron/neck.ts';

test('neck scan extends and folds smoothly across the full 18-second cycle', () => {
  assert.deepEqual([0, 3, 6, 9, 12, 18].map(time => heronNeckExtension(time, 'rest')), [0, 0, 1, 1, 0, 0]);
  for (let time = 0; time < 36; time += .01) {
    const value = heronNeckExtension(time, 'rest');
    assert.ok(value >= 0 && value <= 1);
    assert.ok(Math.abs(heronNeckExtension(time + .01, 'rest') - value) < .006);
  }
  for (const mode of ['flap', 'glide', 'fall']) assert.equal(heronNeckExtension(7, mode), 0);
  assert.equal(heronNeckExtension(7, 'rest', true), 0);
  assert.equal(heronNeckExtension(NaN, 'rest'), 0);
});

for (const lod of [0, 1, 2]) test(`LOD${lod} morphs one connected S-neck without rebuilding geometry`, () => {
  const rig = defaultBuildRig({ species: 'heron', lod });
  const neck = rig.model.root.getObjectByName('heron-neck'), head = rig.model.pivots.head;
  const geometry = neck.geometry, resources = rig.model.resources.geometries.length;
  const folded = geometry.getAttribute('position'), extended = geometry.morphAttributes.position[0];
  assert.equal(extended.count, folded.count);
  assert.ok(extended.array.every(Number.isFinite));
  assert.equal(geometry.morphAttributes.normal[0].count, folded.count);
  rig.pose({ mode: 'rest', time: 0, steps: 0, flapAge: 10 });
  assert.equal(neck.morphTargetInfluences[0], 0);
  assert.ok(head.position.distanceTo(HERON_FOLDED_HEAD) < 1e-9);
  const facing = head.getWorldQuaternion(new THREE.Quaternion());
  rig.pose({ mode: 'rest', time: 7, steps: 0, flapAge: 10 });
  assert.equal(neck.morphTargetInfluences[0], 1);
  assert.ok(head.position.distanceTo(HERON_EXTENDED_HEAD) < 1e-9);
  assert.ok(head.getWorldQuaternion(new THREE.Quaternion()).angleTo(facing) < 1e-9, 'bill remains level while the neck opens');
  const ringSize = geometry.parameters.radialSegments + 1;
  for (const [positions, endpoint] of [[folded, HERON_FOLDED_HEAD], [extended, HERON_EXTENDED_HEAD]]) {
    const center = new THREE.Vector3();
    for (let i = positions.count - ringSize; i < positions.count - 1; i++) center.add(new THREE.Vector3().fromBufferAttribute(positions, i));
    center.divideScalar(ringSize - 1);
    assert.ok(center.distanceTo(endpoint) < 1e-7, 'last neck ring stays attached to the head socket');
  }
  for (let i = 0; i < 1800; i++) rig.pose({ mode: 'rest', time: i / 100, steps: 0, flapAge: 10 });
  assert.equal(neck.geometry, geometry);
  assert.equal(rig.model.resources.geometries.length, resources);
  rig.pose({ mode: 'flap', time: 7, steps: 0, flapAge: .25 });
  assert.equal(neck.morphTargetInfluences[0], 0);
  rig.pose({ mode: 'rest', time: 7, steps: 0, flapAge: 10, reducedMotion: true });
  assert.equal(neck.morphTargetInfluences[0], 0);
  rig.pose({ mode: 'rest', time: 0, steps: 0, flapAge: 10, fishStrikeAge: 1.2, fishStrikeHeight: .32 });
  assert.equal(neck.morphTargetInfluences[0], 1);
  const bill = head.getObjectByName('upper-beak');
  const tip = rig.model.root.worldToLocal(bill.localToWorld(new THREE.Vector3(0, .235 / 2, 0)));
  assert.ok(Math.abs(tip.y - .32) < 1e-6, 'extended neck keeps real bill contact at the fish surface');
  rig.pose({ mode: 'rest', time: 0, steps: 0, flapAge: 10 });
  assert.equal(neck.morphTargetInfluences[0], 0, 'interrupted strikes reset cleanly');
  rig.dispose();
});
