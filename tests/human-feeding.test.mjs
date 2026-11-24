import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NpcSystem } from '../src/native/ported/npcs/runtime/simulation.ts';
import { paintPose } from '../src/native/ported/npcs/models/pose.ts';
import { createNpcModelLayer } from '../src/native/ported/npcs/models/index.ts';
import { createHumanFeeding, MAX_STREET_CRUMBS } from '../src/native/human-feeding.ts';
import { createStreetFlock } from '../src/native/street-flock.ts';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';

function system(humans = 3) {
  return new NpcSystem({ routes: [{ id: 'path', kinds: ['human'], points: [{ x: 0, z: 0 }, { x: 120, z: 0 }], loop: false }],
    spawnZones: [{ id: 'start', routeId: 'path', kinds: ['human'], center: { x: 60, z: 0 }, radius: 130, capacity: 20 }],
    groundAt: () => ({ height: 0, walkable: true, surface: 'stone' }), canTraverse: () => true },
  { seed: 18, limits: { human: humans, dog: 0, cat: 0, rat: 0 }, spawnMinDistance: 0, spawnMaxDistance: 200, despawnDistance: 250, lifetimeSeconds: [1000, 1000] });
}
const observer = { x: 60, y: 0, z: 10 };
const human = (id, humanRole, foodSequence = 0) => ({ id, kind: 'human', humanRole, foodSequence, x: 0, y: 0, z: 0, heading: 0, bodyScale: 1 });
const initial = () => Array.from({ length: MAX_STREET_CRUMBS }, (_, i) => ({ id: `original:${i}`, x: 20 + i, y: 0, z: 0, eaten: false }));

test('human population retains 18 ordinary people and guarantees distinct grandmother/grandfather roles', () => {
  const npcs = system(20);
  for (let i = 0; i < 100; i++) npcs.update(.05, { observer });
  const states = npcs.snapshot();
  assert.equal(states.length, 20);
  assert.equal(states.filter(s => s.humanRole === 'grandmother').length, 1);
  assert.equal(states.filter(s => s.humanRole === 'grandfather').length, 1);
  assert.equal(states.filter(s => s.humanRole === 'walker').length, 18);
  const grandma = states.find(s => s.humanRole === 'grandmother');
  npcs.despawn(grandma.id); npcs.update(.05, { observer });
  assert.equal(npcs.snapshot().filter(s => s.humanRole === 'grandmother').length, 1);
  npcs.dispose();
});

test('walkers release once per 20 moving seconds; elderly throw exactly once each 120 seconds and resume walking', () => {
  const npcs = system(), walked = new Map(), gait = new Map(), releases = new Map(), last = new Map();
  let throwSeen = false, resumed = false;
  for (let i = 0; i < 4850; i++) {
    npcs.update(.05, { observer });
    for (const state of npcs.snapshot()) {
      if (state.humanRole === 'walker') {
        const moved = state.gaitDistance - (gait.get(state.id) ?? 0);
        gait.set(state.id, state.gaitDistance);
        const seconds = (walked.get(state.id) ?? 0) + (moved / .05 > .025 ? .05 : 0);
        walked.set(state.id, seconds);
        assert.equal(state.foodSequence, Math.floor((seconds + 1e-7) / 20));
      } else {
        if (state.foodSequence !== (last.get(state.id) ?? 0)) {
          const history = releases.get(state.id) ?? []; history.push(state.age); releases.set(state.id, history);
        }
        last.set(state.id, state.foodSequence);
        if (Number.isFinite(state.foodThrowAge)) { throwSeen = true; assert.equal(state.speed, 0); }
        if (state.age > 122 && state.speed > .1) resumed = true;
      }
    }
  }
  assert.equal(releases.size, 2);
  for (const times of releases.values()) { assert.equal(times.length, 2); assert.ok(Math.abs(times[0] - 120.3) < .001); assert.ok(Math.abs(times[1] - times[0] - 120) < .001); }
  assert.ok(throwSeen && resumed);
  const before = npcs.snapshot();
  npcs.updateFrame({ frame: 1, simTime: 300, acceptedSeconds: .1, playing: false }, { observer });
  assert.deepEqual(npcs.snapshot(), before);
  npcs.dispose();
});

test('two elderly releases produce sixty animated grains, same sequence never duplicates, all remain within fixed pool', () => {
  const crumbs = initial(), feeding = createHumanFeeding(crumbs, () => 0);
  const feeders = [human('gma', 'grandmother', 1), human('gpa', 'grandfather', 1)];
  feeding.update(.05, feeders);
  assert.equal(feeding.snapshot().supplied, 60); assert.equal(feeding.snapshot().airborne, 60);
  assert.equal(crumbs.length, MAX_STREET_CRUMBS);
  assert.equal(crumbs.filter(c => c.id.startsWith('crumb:human:')).length, 60);
  assert.ok(crumbs.filter(c => c.id.startsWith('crumb:human:')).every(c => c.eaten));
  assert.ok(Array.from({ length: 64 }, (_, i) => feeding.visual(i)).filter(Boolean).every(p => p.y > .5));
  for (let i = 0; i < 16; i++) feeding.update(.05, feeders);
  assert.equal(feeding.snapshot().supplied, 60); assert.equal(feeding.snapshot().airborne, 0);
  assert.ok(crumbs.every(c => !c.eaten));
  const before = JSON.stringify(crumbs), stats = feeding.snapshot();
  for (const dt of [0, -1, Infinity, NaN, .2]) feeding.update(dt, [human('gma', 'grandmother', 2)]);
  assert.equal(JSON.stringify(crumbs), before); assert.deepEqual(feeding.snapshot(), stats);
  for (let seq = 2; seq < 100; seq++) { feeding.update(.05, [human('gma', 'grandmother', seq)]); assert.equal(crumbs.length, 64); assert.ok(feeding.snapshot().airborne <= 64); }
  assert.equal(new Set(crumbs.map(c => c.id)).size, 64);
  feeding.update(.1, []); assert.equal(feeding.snapshot().trackedHumans, 0);
  feeding.dispose(); assert.equal(feeding.snapshot().airborne, 0);
});

test('simultaneous sixty elderly grains and eighteen walker grains all release without dropping pending grains', () => {
  const crumbs = initial(), feeding = createHumanFeeding(crumbs, () => 0);
  const humans = [human('gma', 'grandmother', 1), human('gpa', 'grandfather', 1),
    ...Array.from({ length: 18 }, (_, i) => human(`walker:${i}`, 'walker', 1))];
  feeding.update(.05, humans);
  assert.equal(feeding.snapshot().supplied, 64); assert.equal(feeding.snapshot().pendingGrains, 14);
  for (let i = 0; i < 30; i++) { feeding.update(.05, humans); assert.equal(crumbs.length, 64); assert.ok(feeding.snapshot().airborne <= 64); }
  assert.equal(feeding.snapshot().supplied, 78); assert.equal(feeding.snapshot().batches, 20);
  assert.equal(feeding.snapshot().pendingGrains, 0); assert.equal(feeding.snapshot().airborne, 0);
  assert.equal(new Set(crumbs.map(c => c.id)).size, 64);
});

test('one walking release reuses consumed food first and invalid landing is retried without silent food loss', () => {
  const crumbs = initial(); crumbs[17].eaten = true;
  let valid = true;
  const feeding = createHumanFeeding(crumbs, (x, z) => valid && Math.abs(x) < 2 && Math.abs(z) < 2 ? 0 : null);
  feeding.update(.05, [human('walker', 'walker', 1)]);
  assert.equal(feeding.snapshot().supplied, 1); assert.equal(crumbs[17].id, 'crumb:human:1'); assert.equal(crumbs[0].id, 'original:0');
  valid = false; feeding.update(.05, [human('gma', 'grandmother', 1)]); assert.equal(feeding.snapshot().supplied, 1);
  valid = true; feeding.update(.05, [human('gma', 'grandmother', 1)]); assert.equal(feeding.snapshot().supplied, 31);
  assert.ok(crumbs.filter(c => c.id.startsWith('crumb:human:')).every(c => Math.abs(c.x) < 2 && Math.abs(c.z) < 2));
});

test('elderly appearance and throw arm change geometry without adding instance shapes or moving soles', () => {
  const draw = (humanRole, foodThrowAge = Infinity) => {
    const counts = {}, values = [], soles = [];
    let region;
    paintPose({ kind: 'human', humanRole, foodThrowAge, variant: 0, action: 'idle', speed: 0, gaitDistance: 0, age: 120, bodyScale: 1 }, {
      region(r) { region = r; },
      part(shape, ...numbers) { counts[shape] = (counts[shape] ?? 0) + 1; assert.ok(numbers.every(Number.isFinite)); values.push(numbers); if (region === 'limbs' && shape === 'block') soles.push(numbers[1] - numbers[4] / 2); },
      link(...numbers) { counts.taper = (counts.taper ?? 0) + 1; assert.ok(numbers.every(Number.isFinite)); values.push(numbers); },
    });
    return { counts, values, soles };
  };
  const adult = draw('walker'), grandma = draw('grandmother'), grandpa = draw('grandfather');
  assert.notDeepEqual(adult.values, grandma.values); assert.notDeepEqual(grandma.values, grandpa.values);
  for (const age of [0, .3, .6, 1, 1.2]) { const throwPose = draw('grandmother', age); assert.deepEqual(throwPose.counts, adult.counts); assert.ok(throwPose.soles.every(y => Math.abs(y) < 1e-8)); }
  assert.notDeepEqual(draw('grandmother', .3).values, draw('grandmother', .6).values);
  const parent = new THREE.Scene(), models = createNpcModelLayer(parent, 48);
  assert.equal(models.stats.drawCalls, 4); models.dispose(); assert.equal(parent.children.length, 0);
});

test('actual flock displays new grains on map ground without awarding the player food or allocating unbounded meshes', () => {
  const parent = new THREE.Scene(), flock = createStreetFlock(parent, makeMapLayout({ data: 'osm' }));
  const origin = flock.snapshot().feedingGround, feeder = { ...human('gma', 'grandmother', 1), ...origin };
  flock.update(.05, { ...origin, species: 'pigeon' }, [feeder]);
  assert.equal(flock.snapshot().humanFeeding.supplied, 30); assert.equal(flock.playerEaten, 0);
  const extras = parent.getObjectByName('street-flock:food-and-perches');
  assert.equal(extras.children.filter(c => c.name.startsWith('crumb:')).length, 64);
  for (let i = 0; i < 20; i++) flock.update(.05, { ...origin, species: 'pigeon' }, [feeder]);
  assert.equal(flock.snapshot().humanFeeding.airborne, 0);
  const generated = flock.snapshot().crumbs.filter(c => c.id.startsWith('crumb:human:'));
  assert.equal(generated.length, 30); assert.ok(generated.every(c => c.y === origin.y));
  const model = parent.getObjectByName(generated[0].id); assert.equal(model.position.x, generated[0].x);
  flock.dispose(); assert.equal(parent.children.length, 0);
});
