import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMapLayout, sampleGround, sampleWater } from '../src/native/ported/map/layout.ts';
import { createStreamHabitat } from '../src/native/stream-habitat.ts';
import { createStreamFish } from '../src/native/stream-fish.ts';
import { createHeronFishing } from '../src/native/heron-fishing.ts';

for (const options of [{ data: 'osm' }, { terrain: 'sunken-channel' }]) test(`entire animated fish stays inside the water and below its surface for ten minutes: ${JSON.stringify(options)}`, () => {
  const layout = makeMapLayout(options), scene = new THREE.Scene(), habitat = createStreamHabitat(scene, layout), schools = createStreamFish(scene, habitat);
  const parts = schools.fish.map(fish => { const meshes = []; fish.mesh.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); }); return { fish, meshes }; });
  const point = new THREE.Vector3(); let checked = 0;
  try {
    assert.equal(schools.fish.length, 41);
    for (let frame = 0; frame < 6000; frame++) {
      schools.update(.1);
      if (frame % 50 !== 0) continue;
      scene.updateMatrixWorld(true);
      for (const { fish, meshes } of parts) for (const mesh of meshes) {
        const vertices = mesh.geometry.getAttribute('position');
        for (let i = 0; i < vertices.count; i++) {
          point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld);
          const ground = sampleGround(layout, point.x, point.z), water = sampleWater(layout, point.x, ground.y, point.z);
          assert.ok(water, `${fish.id} vertex crosses bank at ${frame / 10}s`);
          assert.ok(point.y <= water.y - .001, `${fish.id} fin protrudes above water`);
          assert.ok(point.y >= ground.y - 1e-6, `${fish.id} body intersects the bed`);
          checked++;
        }
      }
    }
    assert.ok(checked > 100000);
    assert.ok(schools.fish.filter(f => !f.prey).every(f => f.distanceSwum > 1));
  } finally { schools.dispose(); habitat.dispose(); assert.equal(scene.children.length, 0); }
});

test('distance culling restores wildlife and near shadows without changing the population or simulation', () => {
  const scene = new THREE.Scene(), wildlife = createHeronFishing(scene, makeMapLayout({ data: 'osm' }));
  try {
    const near = wildlife.snapshot().birds[0], count = wildlife.snapshot().fish.length;
    wildlife.update(.05, { x: 10000, y: 0, z: 10000, species: 'pigeon' });
    assert.ok(wildlife.snapshot().birds.every(b => !b.visible));
    let visibleFish = 0, shadows = 0;
    scene.traverse(o => { if (o.name.startsWith('stream-fish:') && o.visible) visibleFish++; if (o instanceof THREE.Mesh && o.castShadow) shadows++; });
    assert.equal(visibleFish, 0); assert.equal(shadows, 0);
    wildlife.update(.05, { ...near, species: 'pigeon' });
    assert.equal(wildlife.snapshot().birds[0].visible, true);
    scene.traverse(o => { if (o instanceof THREE.Mesh && o.castShadow) shadows++; });
    assert.ok(shadows > 0); assert.equal(wildlife.snapshot().fish.length, count);
    assert.equal(wildlife.count, 6);
  } finally { wildlife.dispose(); assert.equal(scene.children.length, 0); }
});
