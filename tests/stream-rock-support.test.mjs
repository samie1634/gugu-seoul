import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';
import { createMapQueries } from '../src/native/ported/motion/locomotion/b2/map-queries.ts';
import { createStreamHabitat } from '../src/native/stream-habitat.ts';
import { createStreamRockGeometry, registerStreamRocks, withStreamStoneSupport } from '../src/native/stream-rock-shape.ts';
import { createSpeciesActor } from '../src/species-core/index.ts';
import { emptyInput } from '../src/simulation.ts';
import { createNativeMotionState, nativeFeet } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { buildNativeAppearance } from '../src/species-core/index.ts';
const probe = (x, y, z, radius = .08) => ({ at: { x, y, z }, previousFeetY: y + .2, maxDropM: .5, maxRiseM: 0, footRadiusM: radius, heightM: .25 });
const clearWorld = { supportAt: () => null, sweepBody: () => null, sweepSphere: () => null, sphereClear: () => true };

test('irregular visible stone crown and collider agree, including sides and underside', () => {
  const layout = makeMapLayout(), unregister = registerStreamRocks(layout, [{ x: 0, y: 1, z: 0, bedY: 0, radiusX: 2, radiusZ: 1.45 }]);
  const world = withStreamStoneSupport(clearWorld, layout), geometry = createStreamRockGeometry();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.scale.set(2, 1, 1.45); mesh.updateMatrixWorld(true);
  try {
    assert.equal(world.supportAt(probe(0, 1, 0)).height, 1);
    assert.equal(world.supportAt(probe(1.95, 1, 0)), null, 'outside crown has no invisible support');
    assert.equal(world.supportAt(probe(0, 1, 0, 2)), null, 'entire sole disk must fit');
    const ray = new THREE.Raycaster(new THREE.Vector3(.6, 4, .2), new THREE.Vector3(0, -1, 0));
    const visibleTop = ray.intersectObject(mesh)[0].point.y;
    assert.ok(Math.abs(world.supportAt(probe(.6, 1, .2)).height - visibleTop) < 1e-7);
    const hit = world.sweepSphere({ x: .6, y: 4, z: .2 }, { x: .6, y: -1, z: .2 }, .1);
    assert.equal(hit.colliderId, 'stream:stone:0'); assert.ok(Math.abs(hit.point.y - visibleTop - .1) < 1e-6);
    assert.ok(world.sweepSphere({ x: -4, y: .5, z: 0 }, { x: 4, y: .5, z: 0 }, .1));
    assert.ok(world.sweepSphere({ x: 0, y: -1, z: 0 }, { x: 0, y: 2, z: 0 }, .1));
    assert.equal(world.sphereClear({ x: 0, y: .5, z: 0 }, .01), false, 'inside shell is solid');
    assert.equal(world.sphereClear({ x: 0, y: 1.1, z: 0 }, .1), true, 'resting tangent is clear');
    assert.equal(world.sweepSphere({ x: 0, y: 1.1, z: 0 }, { x: 0, y: 2, z: 0 }, .1), null, 'upward takeoff does not stick');
  } finally { unregister(); geometry.dispose(); mesh.material.dispose(); }
  assert.equal(world.supportAt(probe(0, 1, 0)), null);
});

test('stone wrapper retains unavailable query semantics and late registration/disposal', () => {
  const layout = makeMapLayout(), world = withStreamStoneSupport(clearWorld, layout);
  assert.equal(world.supportAt(probe(0, 1, 0)), null);
  const unregister = registerStreamRocks(layout, [{ x: 0, y: 1, z: 0, bedY: 0, radiusX: 2, radiusZ: 1.45 }]);
  try {
    const blocked = withStreamStoneSupport({ supportAt: () => undefined, sweepBody: () => undefined, sweepSphere: () => undefined, sphereClear: () => undefined }, layout);
    assert.equal(blocked.supportAt(probe(0, 1, 0)), undefined);
    assert.equal(blocked.sweepSphere({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, .1), undefined);
    assert.equal(blocked.sphereClear({ x: 0, y: .5, z: 0 }, .1), undefined);
    assert.equal(world.supportAt(probe(0, 1, 0)).height, 1);
  } finally { unregister(); }
  assert.equal(world.supportAt(probe(0, 1, 0)), null);
});

for (const options of [{ data: 'osm' }, { terrain: 'sunken-channel' }]) test(`player can land, rest and take off from actual stream rock: ${JSON.stringify(options)}`, () => {
  const scene = new THREE.Scene(), layout = makeMapLayout(options), base = createMapQueries(layout), habitat = createStreamHabitat(scene, layout, base), world = withStreamStoneSupport(base, layout);
  const rock = habitat.supports.find(p => p.kind === 'rock'); assert.ok(rock);
  const appearance = { speciesId: 'pigeon', skinId: 'default' }, rig = buildNativeAppearance(appearance, 0), body = rig.body; rig.dispose();
  const initial = createNativeMotionState({ body, feet: { x: rock.x, y: rock.y + .8, z: rock.z } });
  initial.grounded = false; initial.mode = 'fall';
  const actor = createSpeciesActor(scene, { world, appearance, initialState: initial, view: { mode: 'third', verticalFovDegrees: 59, aspect: 16 / 9 } });
  const run = input => {
    const before = actor.snapshot();
    const frame = actor.prepareFrame({ contractVersion: 1, frame: before.lastFrame + 1, simTime: before.state.time + .05, rawSeconds: .05, acceptedSeconds: .05, playing: true, quality: 'mobile', reducedMotion: false }, input,
      { mode: 'third', verticalFovDegrees: 59, aspect: 16 / 9 });
    assert.equal(frame.kind, 'ready', frame.reason); frame.commit();
  };
  try {
    for (let i = 0; i < 100; i++) run(emptyInput());
    assert.equal(actor.state.grounded, true); assert.match(actor.state.support.id, /^stream:stone:/);
    assert.ok(Math.abs(nativeFeet(actor.state).y - rock.y) < 2e-6);
    const landed = actor.state.y;
    run({ ...emptyInput(), flapPressed: true, flapHeld: true });
    for (let i = 0; i < 10; i++) run({ ...emptyInput(), flapHeld: true });
    assert.equal(actor.state.grounded, false); assert.ok(actor.state.y > landed + .1);
  } finally { actor.dispose(); habitat.dispose(); }
});

for (const options of [{ data: 'osm' }, { terrain: 'sunken-channel' }]) test(`stone lips settle safely without widened support or water-snap overlap: ${JSON.stringify(options)}`, async () => {
  const { advanceNativeMotion } = await import('../src/native/ported/motion/locomotion/b2/native-motion.ts');
  const { withCloudSupport } = await import('../src/native/cloud-platforms.ts');
  const { createVehicleWorld } = await import('../src/native/vehicle-world.ts');
  const scene = new THREE.Scene(), layout = makeMapLayout(options), base = createMapQueries(layout), habitat = createStreamHabitat(scene, layout, base);
  const world = createVehicleWorld(withCloudSupport(withStreamStoneSupport(base, layout), []), () => []).world;
  const rock = habitat.supports.find(p => p.kind === 'rock');
  try {
    for (const speciesId of ['pigeon', 'kestrel', 'eagle-owl', 'heron']) {
      const rig = buildNativeAppearance({ speciesId, skinId: 'default' }, 0), body = rig.body; rig.dispose();
      for (const angle of [0, .7, 1.5, 2.9, 4.3, 5.4]) for (const offset of [.75, .81, .835, .95, 1.1]) {
        let state = createNativeMotionState({ body, feet: { x: rock.x + Math.cos(angle) * rock.radiusX * offset, y: rock.y + .8, z: rock.z + Math.sin(angle) * rock.radiusZ * offset } });
        state.grounded = false; state.mode = 'fall';
        const label = `${speciesId}/${angle}/${offset}`;
        for (let i = 0; i < 500; i++) {
          const next = advanceNativeMotion(state, emptyInput(), .025, world);
          assert.equal(next.status, 'advanced', `${label} frame${i}: ${next.reason}`); state = next.state;
          assert.equal(world.sweepBody(state, state, body), null, `${label}: committed body cannot overlap a stone`);
        }
        assert.ok(state.grounded || state.mode === 'rest', `${label}: never remain suspended in fall`);
        if (state.grounded) assert.ok(world.supportAt({ at: nativeFeet(state), previousFeetY: nativeFeet(state).y, footRadiusM: body.footSupportRadiusM, heightM: body.heightM, maxRiseM: .000002, maxDropM: .000002 }), 'full foot support still required');
        const before = state.y;
        let next = advanceNativeMotion(state, { ...emptyInput(), flapPressed: true, flapHeld: true }, .025, world);
        assert.equal(next.status, 'advanced'); state = next.state;
        for (let i = 0; i < 10; i++) { next = advanceNativeMotion(state, { ...emptyInput(), flapHeld: true }, .025, world); assert.equal(next.status, 'advanced'); state = next.state; }
        assert.ok(state.y > before, `${label}: can relaunch after settling`);
      }
    }
  } finally { habitat.dispose(); }
});

test('actual first/third-person actor remains usable across the reported OSM stone lips', () => {
  const scene = new THREE.Scene(), layout = makeMapLayout({ data: 'osm' }), base = createMapQueries(layout), habitat = createStreamHabitat(scene, layout, base), world = withStreamStoneSupport(base, layout);
  const rock = habitat.supports.find(p => p.kind === 'rock'), appearance = { speciesId: 'pigeon', skinId: 'default' };
  const rig = buildNativeAppearance(appearance, 0), body = rig.body; rig.dispose();
  try {
    for (const mode of ['first', 'third']) for (const offset of [.81, .835]) {
      const initial = createNativeMotionState({ body, feet: { x: rock.x + rock.radiusX * offset, y: rock.y + .8, z: rock.z } }); initial.grounded = false; initial.mode = 'fall';
      const view = { mode, verticalFovDegrees: 59, aspect: 16 / 9 }, actor = createSpeciesActor(scene, { world, appearance, initialState: initial, view });
      try {
        for (let i = 0; i < 500; i++) {
          const before = actor.snapshot(), frame = actor.prepareFrame({ contractVersion: 1, frame: before.lastFrame + 1, simTime: before.state.time + .025, rawSeconds: .025, acceptedSeconds: .025, playing: true, quality: 'mobile', reducedMotion: false }, emptyInput(), view);
          assert.equal(frame.kind, 'ready', `${mode}/${offset}/${i}: ${frame.reason}`); frame.commit();
        }
        assert.ok(actor.state.grounded || actor.state.mode === 'rest');
      } finally { actor.dispose(); }
    }
  } finally { habitat.dispose(); }
});
