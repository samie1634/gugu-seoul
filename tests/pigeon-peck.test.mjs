import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBirdRig } from '../src/native/ported/birds/rig-core/rig.ts';
import { createUrbanBird } from '../src/native/ported/birds/urban/models.ts';
import { pigeonPeckCycle, solvePeckContact } from '../src/native/ported/birds/rig-core/peck.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { nativeNear } from '../src/native/body-profile.ts';

const input = { mode: 'rest', time: 0, flapAge: 10, steps: 0 };
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function mesh(rig, name) {
  const found = rig.model.root.getObjectsByProperty('name', name).find(object => object instanceof THREE.Mesh);
  assert.ok(found, name); return found;
}
function lowest(object) {
  const positions = object.geometry.getAttribute('position');
  const sample = new THREE.Vector3(); let y = Infinity;
  for (let i = 0; i < positions.count; i++) {
    sample.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
    y = Math.min(y, sample.y);
  }
  return y;
}
function billHeights(rig) {
  rig.root.updateMatrixWorld(true);
  return [lowest(mesh(rig, 'upper-beak')), lowest(mesh(rig, 'lower-beak-mesh'))];
}

for (const morph of ['gray', 'white']) for (const lod of [0, 1, 2]) {
  test(`${morph} LOD${lod}: body/neck/head sockets stay fixed and actual bill vertices never cross the sole plane`, () => {
    const rig = createBirdRig({ species: 'pigeon', lod, morph }, createUrbanBird);
    try {
      const neck = rig.model.root.getObjectByName('neck');
      const joint = rig.model.root.getObjectByName('head-joint');
      assert.equal(joint.parent, neck); assert.equal(rig.model.pivots.head.parent, joint);
      const neckBind = neck.position.clone(), jointBind = joint.position.clone(), headBind = rig.model.pivots.head.position.clone();
      const body = mesh(rig, 'body'); const bodyBind = body.matrix.clone();
      const neckPosition = new THREE.Vector3();
      for (const steps of [0, .1, .21, .32]) {
        for (let i = 0; i <= 100; i++) {
          const peckAge = i / 200;
          rig.pose({ ...input, mode: steps === 0 ? 'rest' : 'walk', steps, time: 123.5 + peckAge, peckAge, callAge: .2 });
          const heights = billHeights(rig);
          assert.ok(heights.every(y => y >= .0009), `${peckAge}: bill penetrated ${heights}`);
          assert.ok(neck.position.equals(neckBind), 'neck socket cannot slide out of the body');
          assert.ok(joint.position.equals(jointBind), 'head socket cannot slide inside the neck');
          assert.ok(rig.model.pivots.head.position.equals(headBind), 'head bind offset stays fixed');
          assert.ok(body.matrix.equals(bodyBind), 'peck does not teleport or lower the body');
          neck.getWorldPosition(neckPosition); near(neckPosition.y, neckBind.y);
          if (peckAge >= .20 && peckAge <= .24) {
            heights.forEach(y => near(y, .001));
            assert.equal(rig.model.pivots.head.getObjectByName('lower-beak').rotation.x, 0, 'bill is closed on contact');
          }
        }
      }
    } finally { rig.dispose(); }
  });
}

test('jaw opens only during recovery and closes at rest, in flight, or after an interrupted peck', () => {
  const rig = createBirdRig({ species: 'pigeon', lod: 0 }, createUrbanBird);
  try {
    const jaw = rig.model.pivots.head.getObjectByName('lower-beak');
    rig.pose({ ...input, peckAge: .22 }); assert.equal(jaw.rotation.x, 0);
    rig.pose({ ...input, peckAge: .34 }); near(jaw.rotation.x, -.18);
    assert.ok(billHeights(rig).every(y => y > .04), 'jaw opens after clearing the floor');
    for (const mode of ['flap', 'glide', 'fall']) {
      rig.pose({ ...input, mode, peckAge: .34 }); assert.equal(jaw.rotation.x, 0);
    }
    rig.pose({ ...input, peckAge: .6 }); assert.equal(jaw.rotation.x, 0);
    rig.pose({ ...input, peckAge: .34, reducedMotion: true }); assert.equal(jaw.rotation.x, 0);
    rig.pose(input); assert.ok(billHeights(rig)[0] > .17);
  } finally { rig.dispose(); }
});

test('walking head bob rotates around fixed sockets while keeping the bill level', () => {
  const rig = createBirdRig({ species: 'pigeon', lod: 0 }, createUrbanBird);
  try {
    const neck = rig.model.root.getObjectByName('neck'), head = rig.model.root.getObjectByName('head-joint');
    rig.pose(input); const base = rig.model.pivots.head.getWorldPosition(new THREE.Vector3());
    rig.pose({ ...input, mode: 'walk', steps: .15 }); rig.root.updateMatrixWorld(true);
    const moved = rig.model.pivots.head.getWorldPosition(new THREE.Vector3());
    assert.ok(moved.z > base.z + .01); near(neck.rotation.x + head.rotation.x, 0);
    assert.deepEqual(neck.position.toArray(), [0, .1, -.05]);
    assert.deepEqual(head.position.toArray(), [0, .053, -.02]);
  } finally { rig.dispose(); }
});

test('LOD changes, repeated pecks, root yaw, translation and scale preserve the contact geometry', () => {
  const rig = createBirdRig({ species: 'pigeon', lod: 0 }, createUrbanBird, { visualScale: 2 });
  try {
    rig.root.position.set(4, 3.6, -10); rig.root.rotation.y = 1.7;
    for (const lod of [0, 2, 1, 0]) {
      rig.pose({ ...input, peckAge: .22 }); rig.setLod(lod);
      billHeights(rig).forEach(y => near(y, 3.602));
      const atContact = rig.getEyeWorldPosition(new THREE.Vector3()).clone();
      rig.pose({ ...input, peckAge: .6 }); assert.ok(billHeights(rig)[0] > 3.9);
      rig.pose({ ...input, peckAge: .22 });
      assert.ok(rig.getEyeWorldPosition(new THREE.Vector3()).distanceTo(atContact) < 1e-9);
    }
  } finally { rig.dispose(); }
});

test('peck timing has stationary contact and smooth start/recovery; an unreachable bill fails safely', () => {
  for (const age of [-1, .5, Infinity, NaN]) assert.deepEqual(pigeonPeckCycle(age), { reach: 0, jaw: 0 });
  for (const age of [.20, .22, .24]) assert.deepEqual(pigeonPeckCycle(age), { reach: 1, jaw: 0 });
  assert.ok(pigeonPeckCycle(.0001).reach < 1e-6);
  assert.ok(pigeonPeckCycle(.4999).reach < 1e-6);
  assert.equal(solvePeckContact(() => .1), null);
  assert.equal(solvePeckContact(() => NaN), null);
  near(solvePeckContact(angle => .2 - angle * .1), 1.99);
});

test('actual native first/third-person frames complete a ground peck without camera rejection or floor penetration', () => {
  const engine = createNativeScene(new THREE.Scene(), 'pigeon', { preset: 'plaza', quality: 'mobile', sessionId: 'peck-contact-test' });
  const idle = { forward: 0, turn: 0, flapPressed: false, flapHeld: false, descend: false };
  try {
    const projection = { near: nativeNear(engine.state.body, 59, 16 / 9), verticalFovDegrees: 59, aspect: 16 / 9 };
    let elapsed = 10;
    for (const mode of ['third', 'first']) {
      for (let frame = 0; frame <= 60; frame++) {
        const peckAge = frame / 120; elapsed += 1 / 120;
        const proposal = engine.prepare(idle, 1 / 120, projection, mode, elapsed, false, peckAge);
        assert.equal(proposal.kind, 'ready', proposal.reason); proposal.commit();
        const snapshot = engine.snapshot();
        engine.root.updateMatrixWorld(true);
        const bills = ['upper-beak', 'lower-beak-mesh'].map(name => engine.root.getObjectByName(name));
        bills.forEach(bill => assert.ok(lowest(bill) >= snapshot.sole.y + .0009));
        if (mode === 'first') snapshot.camera.position.forEach((v, i) => near(v, Object.values(snapshot.posedEye)[i]));
      }
    }
    assert.equal(engine.snapshot().blockedFrames, 0);
  } finally { engine.dispose(); }
});
