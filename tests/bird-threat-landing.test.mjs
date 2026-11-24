import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBirdBehavior, makeFlockBird } from '../src/native/bird-behavior.ts';
import { createStreetFlock } from '../src/native/street-flock.ts';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';
import { feedingGroundAt } from '../src/native/feeding-ground.ts';

const at = (x = 0, y = 0, z = 0) => ({ x, y, z });
const world = (extra = {}) => ({ groundAt: () => 0, canMove: () => true, perches: [], crumbs: [], ...extra });
const threat = { ...at(-1, 1), species: 'kestrel' };
const advance = (sim, seconds, observer) => { for (let i = 0; i < Math.round(seconds / .025); i++) sim.update(.025, observer); };

for (const species of ['pigeon', 'sparrow']) test(`${species} makes one short flight, waits on the ground, and resumes its original crumb`, () => {
  const bird = makeFlockBird('bird', species, at()), crumb = { ...at(0, 0, -.1), id: 'original-food', eaten: false };
  bird.cooldown = 0;
  const sim = createBirdBehavior([bird], world({ crumbs: [crumb] }));
  sim.update(.025); assert.equal(bird.action, 'feed');
  let maxHeight = 0;
  for (let i = 0; i < 200; i++) { sim.update(.025, threat); maxHeight = Math.max(maxHeight, bird.y); }
  assert.ok(maxHeight > .5 && maxHeight < 2);
  assert.equal(bird.airborne, false); assert.equal(bird.y, 0); assert.equal(bird.action, 'idle');
  assert.ok(Math.hypot(bird.x, bird.z) <= 5.01);
  const refuge = at(bird.x, bird.y, bird.z);
  advance(sim, 20, threat);
  assert.deepEqual(at(bird.x, bird.y, bird.z), refuge);
  assert.equal(bird.eaten, 0); assert.equal(crumb.eaten, false);
  assert.equal(sim.snapshot().events.filter(e => e.type === 'escape').length, 1);
  advance(sim, 4);
  assert.equal(bird.airborne, false); assert.equal(bird.eaten, 1); assert.equal(crumb.eaten, true);
  assert.ok(Math.hypot(bird.x - crumb.x, bird.z - crumb.z) < .2);
});

for (const species of ['crow', 'magpie']) for (const kind of ['wire', 'roof']) test(`${species} lands on a verified ${kind} and looks back toward its departure point`, () => {
  const bird = makeFlockBird('bird', species, at()), perch = { ...at(4, 4, -2), id: 'seat', kind };
  const sim = createBirdBehavior([bird], world({ perches: [perch] }));
  advance(sim, 6, threat);
  assert.equal(bird.action, 'perch'); assert.equal(bird.airborne, false);
  assert.deepEqual(at(bird.x, bird.y, bird.z), at(perch.x, perch.y, perch.z));
  assert.equal(bird.heading, Math.atan2(-perch.x, perch.z));
  advance(sim, 20, threat);
  assert.equal(bird.airborne, false); assert.equal(bird.action, 'perch');
  assert.equal(sim.snapshot().events.filter(e => e.type === 'perch').length, 1);
  advance(sim, 5);
  assert.equal(bird.airborne, false); assert.equal(bird.y, 0);
});

test('an obstructed nearest perch is skipped and corvids reserve distinct reachable high slots', () => {
  const birds = [makeFlockBird('crow', 'crow', at()), makeFlockBird('magpie', 'magpie', at(.4))];
  const perches = [
    { ...at(1, 4), id: 'blocked', kind: 'roof' },
    { ...at(4, 4), id: 'wire:0', kind: 'wire' },
    { ...at(5, 4), id: 'wire:1', kind: 'wire' },
  ];
  const sim = createBirdBehavior(birds, world({ perches, canMove: (_from, to) => !(to.x === 1 && to.y === 4) }));
  advance(sim, 6, threat);
  assert.ok(birds.every(b => b.action === 'perch' && !b.airborne && b.y === 4));
  assert.deepEqual(new Set(birds.map(b => b.targetId)), new Set(['wire:0', 'wire:1']));
});

test('a rejected takeoff cannot trigger a vertical climb and bounded searches do not run every frame', () => {
  let checks = 0;
  const bird = makeFlockBird('pigeon', 'pigeon', at());
  const sim = createBirdBehavior([bird], world({ canMove: (from, to, flying) => { checks++; return !flying || Math.hypot(from.x - to.x, from.z - to.z) < .0001; } }));
  advance(sim, .025, threat);
  assert.deepEqual(at(bird.x, bird.y, bird.z), at()); assert.equal(bird.airborne, false);
  assert.ok(checks <= 150, `${checks} bounded initial checks`);
  const initialChecks = checks;
  advance(sim, 10, threat);
  assert.equal(checks, initialChecks, 'waiting does not re-search each frame');
  assert.deepEqual(at(bird.x, bird.y, bird.z), at()); assert.equal(bird.airborne, false);
});

test('ground escape rejects holes and can select a different clear direction', () => {
  const bird = makeFlockBird('sparrow', 'sparrow', at());
  const groundAt = (x, z) => x > 2 && Math.abs(z) < 1 ? null : 0;
  const sim = createBirdBehavior([bird], world({ groundAt }));
  advance(sim, 6, threat);
  assert.equal(bird.airborne, false); assert.equal(groundAt(bird.x, bird.z), bird.y);
  assert.ok(Math.abs(bird.z) > 1, 'uses another direction instead of the unsupported straight-ahead target');
});

test('a landing point removed during flight is never marked grounded there', () => {
  const bird = makeFlockBird('pigeon', 'pigeon', at());
  let missing;
  const groundAt = (x, z) => missing && Math.hypot(x - missing.x, z - missing.z) < .3 ? null : 0;
  const sim = createBirdBehavior([bird], world({ groundAt }));
  sim.update(.025, threat); missing = { ...bird.destination };
  advance(sim, 7, threat);
  assert.equal(bird.airborne, false); assert.equal(groundAt(bird.x, bird.z), bird.y);
  assert.ok(Math.hypot(bird.x - missing.x, bird.z - missing.z) > .3);
});

test('return is interrupted safely if the kestrel comes back', () => {
  const bird = makeFlockBird('pigeon', 'pigeon', at()), crumb = { ...at(), id: 'food', eaten: false };
  bird.targetId = crumb.id;
  const sim = createBirdBehavior([bird], world({ crumbs: [crumb] }));
  advance(sim, 6, threat); advance(sim, .3);
  assert.equal(bird.action, 'return'); assert.equal(bird.airborne, true);
  advance(sim, 5, threat);
  assert.equal(bird.airborne, false); assert.equal(crumb.eaten, false);
  advance(sim, 5);
  assert.equal(bird.airborne, false); assert.equal(crumb.eaten, true);
});

for (const data of ['osm', 'procedural']) test(`${data}: sustained alarm settles the visible feeding flock on real supports`, () => {
  const layout = makeMapLayout({ data }), flock = createStreetFlock(new THREE.Scene(), layout);
  try {
    const initial = flock.snapshot(), observer = { ...initial.feedingGround, species: 'kestrel' };
    for (let i = 0; i < 400; i++) flock.update(.05, observer);
    const snapshot = flock.snapshot();
    const birds = snapshot.birds.filter(b => ['pigeon', 'sparrow', 'crow', 'magpie'].includes(b.species));
    assert.equal(birds.length, 16);
    for (const bird of birds) {
      assert.equal(bird.airborne, false, bird.id);
      if (bird.species === 'pigeon' || bird.species === 'sparrow') assert.equal(feedingGroundAt(layout, bird.x, bird.z), bird.y);
      else {
        assert.equal(bird.action, 'perch');
        assert.ok(snapshot.perches.some(p => p.id === bird.targetId && Math.hypot(p.x - bird.x, p.y - bird.y, p.z - bird.z) < .03));
        const original = initial.birds.find(b => b.id === bird.id);
        assert.ok(Math.abs(bird.heading - Math.atan2(original.x - bird.x, bird.z - original.z)) < .001);
      }
    }
  } finally { flock.dispose(); }
});

test('a nearby return destination still passes through collision validation instead of snapping', () => {
  const bird = makeFlockBird('pigeon', 'pigeon', at(.02));
  bird.home = at(); bird.action = 'return'; bird.airborne = true;
  const checks = [];
  const sim = createBirdBehavior([bird], world({ groundAt: (x, z) => Math.hypot(x, z) < .001 ? 0 : null,
    canMove: (from, to) => { checks.push({ from: { ...from }, to: { ...to } }); return from.x === to.x && from.y === to.y && from.z === to.z; } }));
  sim.update(.025);
  assert.equal(bird.x, .02, 'cannot snap across a rejected two-centimetre segment');
  assert.ok(checks.some(c => c.from.x === .02 && c.to.x === 0), 'checks the short final segment');
});

test('an airborne bird with no escape route keeps retrying instead of entering a permanent waiting hover', () => {
  const bird = makeFlockBird('pigeon', 'pigeon', at(0, 2)); bird.airborne = true;
  let blocked = true, checks = 0;
  const sim = createBirdBehavior([bird], world({ canMove: (from, to, flying) => {
    checks++; return !flying || !blocked || (from.x === to.x && from.y === to.y && from.z === to.z);
  } }));
  sim.update(.025, threat);
  assert.equal(bird.action, 'flee'); assert.equal(bird.airborne, true);
  const initialChecks = checks;
  advance(sim, .5, threat); assert.equal(checks, initialChecks, 'failed airborne routes have bounded retry cadence');
  blocked = false;
  advance(sim, 4, threat);
  assert.equal(bird.airborne, false); assert.equal(bird.y, 0); assert.equal(bird.action, 'idle');
});
