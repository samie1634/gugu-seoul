import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NORMAL_FLIGHT_TUNING, FED_FLIGHT_TUNING, flightTuningAfterFood } from '../src/native/flight-feeding.ts';
import { createNativeMotionState, advanceNativeMotion } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { nativeNear } from '../src/native/body-profile.ts';
import { PIGEON_FED_TUNING, PIGEON_PLAYER_TUNING } from '../src/pigeon-kinematics.ts';
import { createStreetFlock } from '../src/native/street-flock.ts';
import { feedingOrigin, clearFeedingPath } from '../src/native/feeding-ground.ts';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';
import { createMapNpcAdapter } from '../src/native/ported/npcs/runtime/map-adapter.ts';
import { NpcSystem } from '../src/native/ported/npcs/runtime/simulation.ts';
import { worldAnchors, createNpcModelLayer } from '../src/native/ported/npcs/models/index.ts';
import { PROFILES } from '../src/native/ported/npcs/src/profiles.ts';

const empty = { forward: 0, turn: 0, flapPressed: false, flapHeld: false, descend: false };
test('food restores exactly v25 flight tuning; gravity, freefall and vertical flap remain unchanged while feeding doubles walking', () => {
  assert.deepEqual(NORMAL_FLIGHT_TUNING, { walkSpeed: .9, flightSpeed: 12, glideSpeed: 15 });
  assert.deepEqual(FED_FLIGHT_TUNING, { walkSpeed: 1.8, flightSpeed: 70 / 3.6, glideSpeed: 60 / 3.6 });
  assert.equal(flightTuningAfterFood(0), NORMAL_FLIGHT_TUNING);
  assert.equal(flightTuningAfterFood(1), FED_FLIGHT_TUNING);
  const world = { supportAt: () => null, sweepBody: () => null };
  for (const input of [{ ...empty, forward: 1 }, { ...empty, forward: 1, flapHeld: true }, { ...empty, forward: 1, descend: true }, { ...empty, flapPressed: true }]) {
    let normal = createNativeMotionState({ feet: { x: 0, y: 150, z: 0 }, tuning: NORMAL_FLIGHT_TUNING });
    let fed = createNativeMotionState({ feet: { x: 0, y: 150, z: 0 }, tuning: FED_FLIGHT_TUNING });
    normal.grounded = fed.grounded = false;
    for (let i = 0; i < 15; i++) {
      const first = { ...input, flapPressed: i === 0 && input.flapPressed };
      normal = advanceNativeMotion(normal, first, .05, world).state;
      fed = advanceNativeMotion(fed, first, .05, world).state;
      assert.equal(normal.y, fed.y); assert.equal(normal.vy, fed.vy);
      assert.equal(normal.flaps, fed.flaps); assert.equal(normal.heldSeconds, fed.heldSeconds);
      if (input.descend) { assert.equal(normal.x, fed.x); assert.equal(normal.z, fed.z); }
    }
    if (input.forward && !input.descend) assert.ok(Math.hypot(fed.vx, fed.vz) > Math.hypot(normal.vx, normal.vz));
  }
});

test('only a committed food contact enables the faster speed, preserved across appearance changes', () => {
  const engine = createNativeScene(new THREE.Scene(), 'pigeon', { quality: 'mobile' });
  const prepare = age => engine.prepare(empty, .05, { near: nativeNear(engine.state.body, 59, 16 / 9), verticalFovDegrees: 59, aspect: 16 / 9 }, 'third', 10, false, age);
  try {
    const preview = prepare(.21); assert.equal(preview.kind, 'ready');
    assert.equal(engine.snapshot().flock.playerInteractions.eaten, 0);
    assert.deepEqual(engine.state.tuning, NORMAL_FLIGHT_TUNING);
    // Preview does not consume crumbs or grant speed. A fresh accepted frame does.
    for (const age of [0, .05, .10, .15, .20, .25]) { const p = prepare(age); assert.equal(p.kind, 'ready'); p.commit(); }
    assert.equal(engine.snapshot().flock.playerInteractions.eaten, 1);
    const next = prepare(.3); assert.equal(next.kind, 'ready'); next.commit();
    assert.deepEqual(engine.state.tuning, PIGEON_FED_TUNING);
    assert.equal(engine.state.tuning.walkSpeed, 2 * PIGEON_PLAYER_TUNING.walkSpeed);
    assert.equal(engine.state.tuning.flightSpeed, FED_FLIGHT_TUNING.flightSpeed);
    assert.equal(engine.state.tuning.glideSpeed, FED_FLIGHT_TUNING.glideSpeed);
    assert.equal(engine.selectLook('white'), true);
    assert.deepEqual(engine.state.tuning, PIGEON_FED_TUNING);
    assert.equal(engine.home(), true);
    assert.deepEqual(engine.state.tuning, PIGEON_FED_TUNING);
    const home = prepare(Infinity); assert.equal(home.kind, 'ready'); home.commit();
    assert.deepEqual(engine.state.tuning, PIGEON_FED_TUNING);
  } finally { engine.dispose(); }
});

for (const data of ['osm', 'procedural']) test(`${data}: birds spawn apart and walk to the shared starting food`, () => {
  const layout = makeMapLayout({ data }), origin = feedingOrigin(layout), flock = createStreetFlock(new THREE.Scene(), layout);
  try {
    const initial = flock.snapshot(), birds = initial.birds.filter(b => b.visible && b.species !== 'heron' && b.species !== 'duck');
    assert.equal(birds.length, 18);
    assert.equal(initial.crumbs.length, 64);
    assert.ok(initial.crumbs.every(c => Math.hypot(c.x - origin.x, c.z - origin.z) < 2));
    assert.ok(initial.crumbs.some(c => Math.hypot(c.x - origin.x, c.z - origin.z) <= .25));
    for (let i = 0; i < birds.length; i++) {
      assert.ok(Math.hypot(birds[i].x - origin.x, birds[i].z - origin.z) >= 4.9);
      assert.ok(clearFeedingPath(layout, birds[i], origin));
      for (let j = i + 1; j < birds.length; j++) assert.ok(Math.hypot(birds[i].x - birds[j].x, birds[i].z - birds[j].z) >= 1);
    }
    const approached = new Set(), walked = new Set();
    for (let i = 0; i < 800; i++) {
      flock.update(.05, { ...origin, species: 'pigeon' });
      for (const b of flock.snapshot().birds) {
        if (b.steps > 1) walked.add(b.species);
        if (Math.hypot(b.x - origin.x, b.z - origin.z) <= 2.3) approached.add(b.species);
      }
    }
    for (const species of ['pigeon', 'sparrow', 'crow', 'magpie']) {
      assert.ok(walked.has(species), `${species} walks`); assert.ok(approached.has(species), `${species} approaches food`);
    }
    assert.ok(flock.snapshot().crumbsRemaining < 64);
  } finally { flock.dispose(); }
});

test('other animals keep bounded counts, enter from distinct places and repeatedly walk to the start', () => {
  const layout = makeMapLayout({ data: 'osm' }), origin = feedingOrigin(layout), adapter = createMapNpcAdapter(layout, { feedingWalks: true });
  for (const existing of createMapNpcAdapter(layout).navigation.spawnZones)
    assert.ok(adapter.navigation.spawnZones.some(zone => zone.id === existing.id), 'existing city starts remain available');
  const zones = adapter.navigation.spawnZones.filter(z => z.id.startsWith('feeding-spawn:'));
  assert.equal(zones.length, 16); assert.ok(zones.every(z => z.capacity === 1));
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++)
    assert.ok(Math.hypot(zones[i].center.x - zones[j].center.x, zones[i].center.z - zones[j].center.z) >= 2);
  for (const zone of zones) {
    const route = adapter.navigation.routes.find(r => r.id === zone.routeId), profile = PROFILES[zone.kinds[0]];
    assert.ok(clearFeedingPath(layout, route.points[0], route.points[1], profile.radius + 1.1, profile.height));
  }
  const system = new NpcSystem(adapter.navigation), approached = new Set(), travelled = { dog: 0, cat: 0, rat: 0 };
  let spawnEvents = 0;
  for (let i = 0; i < 1200; i++) {
    system.update(.05, { observer: origin });
    spawnEvents += system.drainEvents().filter(e => e.type === 'spawn' && e.kind !== 'human').length;
    for (const n of system.snapshot().filter(n => n.kind !== 'human')) {
      travelled[n.kind] = Math.max(travelled[n.kind], n.gaitDistance);
      if (Math.hypot(n.x - origin.x, n.z - origin.z) < 2.5) approached.add(n.kind);
    }
  }
  assert.deepEqual(system.stats.counts, { human: 20, dog: 4, cat: 5, rat: 7 });
  assert.equal(spawnEvents, 16, 'no walking animal is repeatedly despawned and recreated');
  assert.deepEqual([...approached].sort(), ['cat', 'dog', 'rat']);
  assert.ok(Object.values(travelled).every(distance => distance > 25), 'walking continues after the first arrival');
  assert.equal(system.stats.droppedEvents, 0); system.dispose();
});


test('redistributed pedestrians retain their existing rendered conversation pose', () => {
  const parent = new THREE.Scene(), models = createNpcModelLayer(parent);
  const state = { id: 'talking-human', kind: 'human', action: 'talk', x: 0, y: 0, z: 0,
    heading: 0, speed: 0, gaitDistance: 0, age: 5, variant: 0, surface: 'stone', routeId: 'walk', bodyScale: 1 };
  const anchors = worldAnchors(state); assert.ok(anchors); assert.deepEqual(anchors.sole, { x: 0, y: 0, z: 0 });
  models.sync([state]); assert.ok(models.root.children.some(mesh => mesh.visible && mesh.count > 0));
  const talkingCounts = models.root.children.map(mesh => mesh.count);
  models.sync([{ ...state, action: 'idle' }]);
  assert.deepEqual(talkingCounts, models.root.children.map(mesh => mesh.count));
  models.dispose();
});
