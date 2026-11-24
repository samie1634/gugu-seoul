import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMapLayout, sampleGround, sampleWater } from '../src/native/ported/map/layout.ts';
import { createHeronFishing } from '../src/native/heron-fishing.ts';
import { createDuckPond } from '../src/native/duck-pond.ts';
import { createDuckModel, createDuckResources } from '../src/native/duck-model.ts';
import { STREAM_FISH_SPECIES } from '../src/native/stream-fish.ts';
import { streamStoneAt } from '../src/native/stream-habitat.ts';

for (const options of [{ data: 'osm' }, { terrain: 'sunken-channel' }]) test(`bounded stones, six herons, six mobile fish species and four duck types: ${JSON.stringify(options)}`, () => {
  const layout = makeMapLayout(options), scene = new THREE.Scene(), wildlife = createHeronFishing(scene, layout), ducks = createDuckPond(scene, layout);
  try {
    const initial = wildlife.snapshot();
    assert.equal(wildlife.count, 6); assert.equal(initial.fish.length, 41); assert.equal(ducks.count, 24);
    assert.ok(initial.stones > 300 && initial.stones <= 812);
    assert.deepEqual([...new Set(initial.fish.map(f => f.species))].sort(), STREAM_FISH_SPECIES.map(s => s.id).sort());
    assert.ok(initial.birds.some(b => b.support === 'rock')); assert.ok(initial.birds.some(b => b.support === 'shoal'));
    const flights = new Set(), walks = new Set(), heights = new Map();
    for (let i = 0; i < 2400; i++) {
      wildlife.update(.05); ducks.update(.05); const s = wildlife.snapshot();
      for (const bird of s.birds) {
        assert.ok([bird.x, bird.y, bird.z, bird.heading].every(Number.isFinite));
        if (bird.airborne) flights.add(bird.id); else {
          // The real long-leg reaches 0.63 m above sole. At most 0.14 m is submerged.
          assert.ok(bird.surfaceY - bird.y <= .15);
          const support = streamStoneAt(layout, bird.x, bird.z);
          assert.ok(support, 'grounded heron has an actual rendered stone/shoal');
          assert.ok(Math.abs(bird.y - support.y) < 1e-8);
          if (bird.action === 'walk') walks.add(bird.id);
        }
        heights.set(bird.id, Math.max(heights.get(bird.id) ?? -Infinity, bird.y));
      }
      for (const fish of s.fish.filter(f => !f.caught && !f.eaten)) {
        const ground = sampleGround(layout, fish.x, fish.z), water = sampleWater(layout, fish.x, ground.y, fish.z);
        assert.ok(water); assert.ok(fish.y < water.y && fish.y > ground.y);
        assert.notEqual(streamStoneAt(layout, fish.x, fish.z)?.kind, 'rock');
      }
      for (const bird of ducks.snapshot().birds) assert.notEqual(streamStoneAt(layout, bird.x, bird.z, .3)?.kind, 'rock', 'duck clears perch rocks');
    }
    assert.equal(flights.size, 6); assert.equal(walks.size, 6);
    for (const bird of initial.birds) assert.ok(heights.get(bird.id) > bird.surfaceY + 1);
    assert.ok(wildlife.snapshot().fish.filter(f => !f.prey).every(f => f.distanceSwum > 1), 'all six schools travel, not just vibrate in place');
    assert.equal(wildlife.snapshot().catches, 5);
    assert.deepEqual([...new Set(ducks.snapshot().birds.map(b => b.breed))].sort(), ['call-duck', 'eurasian-teal', 'mallard', 'spot-billed-duck']);
    const before = wildlife.snapshot(); for (const dt of [0, -1, NaN, Infinity, .2]) wildlife.update(dt); assert.deepEqual(wildlife.snapshot(), before);
  } finally { ducks.dispose(); wildlife.dispose(); wildlife.dispose(); assert.equal(scene.children.length, 0); }
});

test('teal and spot-billed ducks have distinct field marks, not recolored mallards', () => {
  const resources = createDuckResources(), mallard = createDuckModel('drake', resources), teal = createDuckModel('drake', resources, 'eurasian-teal'), spot = createDuckModel('hen', resources, 'spot-billed-duck');
  try {
    assert.ok(teal.root.getObjectByName('teal-green-eye-patch')); assert.ok(teal.root.getObjectByName('teal-cream-tail-patch'));
    assert.ok(spot.root.getObjectByName('spotbill-white-cheek')); assert.ok(spot.root.getObjectByName('duck-green-speculum'));
    assert.equal(spot.root.getObjectByName('duck-bill-tip').material.color.getHexString(), 'c3ad57');
    assert.equal(teal.root.getObjectByName('duck-white-neck-ring'), undefined);
    const size = model => new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3()).length();
    assert.ok(size(teal) < size(mallard) * .75);
  } finally { [mallard, teal, spot].forEach(m => m.dispose()); resources.dispose(); }
});
