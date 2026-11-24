import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createBirdRig } from '../src/native/ported/birds/rig-core/rig.ts';
import { createUrbanBird } from '../src/native/ported/birds/urban/models.ts';
import { profiles } from '../src/native/ported/birds/urban/profiles.ts';
import { createBirdBehavior, makeFlockBird } from '../src/native/bird-behavior.ts';
import { flockFoodContactSeconds, sampleUrbanForage, sampleUrbanWalk, urbanFlockPoseTime, urbanFoodPeckSeconds } from '../src/native/ported/birds/urban/ground-motion.ts';

const rest = { mode: 'rest', time: 0, steps: 0, flapAge: 10 };
const peakAges = { sparrow: [.23, .41, .60], crow: [.47, .86] };
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const rigFor = species => createBirdRig({ species, lod: 1, morph: 'default' }, createUrbanBird, { origin: 'sole' });
const footY = (rig, side) => new THREE.Box3().setFromObject(rig.model.pivots[side], true).min.y;
function bill(rig) {
  const [z, y] = profiles[rig.model.species].bill[0];
  return rig.model.pivots.head.localToWorld(new THREE.Vector3(0, y, z));
}

test('sparrow hops with both feet; crow has alternate swing, double support, and no hop', () => {
  const height = .12, stride = .15;
  for (const t of [.05, .2, .45, .65, .85, .97]) {
    const s = sampleUrbanWalk('sparrow', t, height, stride);
    near(s.leftZ, s.rightZ); near(s.leftY, s.rightY); near(s.leftPitch, s.rightPitch);
    const c = sampleUrbanWalk('crow', t, height, stride);
    near(c.bodyY, 0);
    assert.ok(c.leftY === 0 || c.rightY === 0);
  }
  near(sampleUrbanWalk('sparrow', .15, height, stride).bodyY, 0);
  assert.ok(sampleUrbanWalk('sparrow', .65, height, stride).bodyY > .005);
  const a = sampleUrbanWalk('crow', .8, height, stride), b = sampleUrbanWalk('crow', .3, height, stride);
  assert.ok(a.leftY > b.leftY && b.rightY > a.rightY);
  for (const s of ['sparrow', 'crow']) {
    const start = sampleUrbanWalk(s, 0, height, stride), end = sampleUrbanWalk(s, 1 - 1e-8, height, stride);
    for (const key of Object.keys(start)) near(start[key], end[key]);
    near(sampleUrbanWalk(s, .21, height, stride).leftZ - sampleUrbanWalk(s, .11, height, stride).leftZ, stride * .1);
  }
});

test('three rapid sparrow taps and two slower crow taps keep low between distinct contacts', () => {
  for (const s of ['sparrow', 'crow']) {
    const p = peakAges[s].map(age => sampleUrbanForage(s, age));
    p.forEach(hit => near(hit.lean, 1));
    assert.ok(p[0].headYaw < 0 && p[1].headYaw > 0);
    for (let i = 1; i < p.length; i++) {
      const hold = sampleUrbanForage(s, (peakAges[s][i - 1] + peakAges[s][i]) / 2);
      assert.ok(hold.lean > 0 && hold.lean < .95);
    }
    for (const t of [-1, NaN, 2]) assert.equal(sampleUrbanForage(s, t), undefined);
  }
  assert.ok(peakAges.sparrow[1] - peakAges.sparrow[0] < peakAges.crow[1] - peakAges.crow[0]);
});

test('rigged bill reaches separate floor targets without lifting soles or moving the actor', () => {
  for (const species of ['sparrow', 'crow']) {
    const rig = rigFor(species);
    try {
      rig.root.position.set(3, 2, -7);
      rig.root.rotation.y = .37;
      const neutral = bill(rig);
      let last;
      for (const age of peakAges[species]) {
        rig.pose({ ...rest, foodPeckAge: age });
        const tip = bill(rig);
        assert.ok(tip.y >= 2 - 1e-5 && tip.y < 2 + .008, `${species} bill contact y=${tip.y}`);
        if (last) assert.ok(Math.hypot(tip.x - last.x, tip.z - last.z) > .002);
        last = tip;
        near(footY(rig, 'leftFoot'), 2, 1e-6);
        near(footY(rig, 'rightFoot'), 2, 1e-6);
        assert.deepEqual(rig.root.position.toArray(), [3, 2, -7]);
        near(rig.root.rotation.y, .37);
      }
      rig.setLod(2);
      assert.ok(bill(rig).y < 2.008, 'LOD replacement remembers an active peck');
      rig.pose(rest);
      assert.ok(bill(rig).distanceTo(neutral) < .004);
    } finally { rig.dispose(); }
  }
});

test('peck is ignored while walking, airborne, landing, reduced-motion or a different species', () => {
  for (const species of ['sparrow', 'crow', 'pigeon', 'magpie']) {
    const rig = rigFor(species), age = peakAges[species]?.[0] ?? .25;
    try {
      const other = species === 'pigeon' || species === 'magpie';
      for (const opts of (other ? [{}] : [
        { reducedMotion: true }, { mode: 'walk', steps: .123 }, { mode: 'flap', flapAge: .17 }, { landing: .1 },
      ])) {
        rig.pose({ ...rest, ...opts, foodPeckAge: age });
        const a = bill(rig);
        rig.pose({ ...rest, ...opts });
        near(a.distanceTo(bill(rig)), 0);
      }
    } finally { rig.dispose(); }
  }
});

test('existing flock runs each full feeding bout, eating one crumb at the first visual tap', () => {
  for (const species of ['sparrow', 'crow']) {
    near(urbanFlockPoseTime(species, flockFoodContactSeconds), peakAges[species][0]);
    const bird = makeFlockBird('urban', species, { x: 0, y: 0, z: 0 });
    bird.cooldown = 0;
    const crumb = { id: 'crumb', x: 0, y: 0, z: -.12, eaten: false };
    const sim = createBirdBehavior([bird], { groundAt: () => 0, canMove: () => true, perches: [], crumbs: [crumb] });
    sim.update(.01);
    assert.equal(bird.action, 'feed');
    for (let i = 0; i < 20; i++) sim.update(.01);
    assert.equal(crumb.eaten, false);
    sim.update(.01);
    assert.equal(crumb.eaten, true);
    assert.equal(bird.eaten, 1);
    while (bird.peckAge < urbanFoodPeckSeconds[species] - .03) sim.update(.01);
    assert.equal(bird.action, 'feed');
    for (let i = 0; i < 4; i++) sim.update(.01);
    assert.equal(bird.action, 'idle');
    assert.equal(bird.eaten, 1);
  }
});
