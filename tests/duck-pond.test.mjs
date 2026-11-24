import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMapLayout, sampleGround, sampleWater } from '../src/native/ported/map/layout.ts';
import { createDuckPond } from '../src/native/duck-pond.ts';
import { createDuckModel, createDuckResources } from '../src/native/duck-model.ts';

test('mallards have sex-specific field marks, webbed feet, and stable contact poses', () => {
  const resources = createDuckResources();
  try {
    for (const plumage of ['drake', 'hen']) {
      const model = createDuckModel(plumage, resources), box = new THREE.Box3().setFromObject(model.root);
      assert.ok(box.max.z - box.min.z > .58 && box.max.z - box.min.z < .72);
      assert.equal(!!model.root.getObjectByName('duck-white-neck-ring'), plumage === 'drake');
      assert.equal(!!model.root.getObjectByName('duck-mottled-feathers'), plumage === 'hen');
      assert.ok(model.root.getObjectByName('duck-blue-speculum'));
      for (let t = 0; t <= 1; t += .05) {
        model.pose(t * 5, 0, .3, t, 0); model.root.updateMatrixWorld(true);
        model.root.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
      }
      const tip = model.root.getObjectByName('duck-bill-tip').getWorldPosition(new THREE.Vector3());
      assert.ok(tip.y < .015, 'dabbling bill reaches the water surface');
    }
  } finally { resources.dispose(); }
});

for (const options of [{ data: 'osm' }, { terrain: 'sunken-channel', proportions: 'reference-scale' }]) {
  test(`both duck families remain in real water and perform distinct behaviors: ${JSON.stringify(options)}`, () => {
    const scene = new THREE.Scene(), layout = makeMapLayout(options), waterBefore = JSON.stringify(layout.water), flock = createDuckPond(scene, layout);
    assert.equal(flock.count, 24); assert.equal(flock.snapshot().birds.filter(b => b.plumage === 'hen').length, 9);
    const actions = new Set();
    try {
      for (let i = 0; i < 1400; i++) {
        flock.update(.05, { x: -9999, y: 0, z: -9999 });
        for (const b of flock.snapshot().birds) {
          assert.ok([b.x, b.y, b.z, b.heading].every(Number.isFinite));
          const ground = sampleGround(layout, b.x, b.z), water = sampleWater(layout, b.x, ground.y, b.z);
          assert.ok(water); assert.equal(b.y, water.y); assert.equal(b.airborne, false);
          for (const [dx, dz] of [[-.29,0],[.29,0],[0,-.29],[0,.29]]) {
            const g = sampleGround(layout,b.x+dx,b.z+dz);assert.ok(sampleWater(layout,b.x+dx,g.y,b.z+dz));
          }
          actions.add(b.action);
        }
      }
      for (const action of ['swim', 'rest', 'preen', 'dabble']) assert.ok(actions.has(action), action);
      assert.ok(flock.snapshot().birds.every(b => b.distanceSwum > 1));
      assert.equal(JSON.stringify(layout.water), waterBefore);
    } finally { flock.dispose(); flock.dispose(); assert.equal(scene.children.length, 0); assert.equal(flock.count, 0); }
  });
}

test('duck proximity and pecks produce water-bound escape, and invalid time never advances', () => {
  const scene = new THREE.Scene(), flock = createDuckPond(scene, makeMapLayout({ data: 'osm' }));
  try {
    const first = flock.snapshot().birds[0], source = { ...first, x: first.x + .35, species: 'pigeon' };
    assert.equal(flock.receivePeck(first.id, source), true);
    assert.equal(flock.snapshot().birds[0].action, 'escape');
    assert.equal(flock.receivePeck(first.id, { ...source, x: first.x + 5 }), false);
    const before = flock.snapshot();
    for (const dt of [0, -1, NaN, Infinity, .2]) flock.update(dt, source);
    assert.deepEqual(flock.snapshot(), before);
    for (let i = 0; i < 40; i++) flock.update(.05, source);
    const after = flock.snapshot().birds[0];assert.ok(Math.hypot(after.x-first.x,after.z-first.z) > .1);
  } finally { flock.dispose(); }
});

test('a map without verified water stays empty and disposes without changing the parent', () => {
  const scene = new THREE.Scene(), layout = makeMapLayout({ data: 'osm' });
  layout.realMap = { ...layout.realMap, water: [] };
  const flock = createDuckPond(scene, layout); assert.equal(flock.count,0);assert.equal(flock.snapshot().available,false);
  flock.update(.05);flock.dispose();assert.equal(scene.children.length,0);
});
