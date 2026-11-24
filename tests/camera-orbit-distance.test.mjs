import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { stableOrbitStep } from '../src/camera-orbit.ts';
import { resolveNativeCamera } from '../src/native/ported/motion/controls/b2/native-camera.ts';
import { cameraNearRadius, resolveCamera } from '../src/native/ported/motion/controls/camera-resolver.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { nativeNear } from '../src/native/body-profile.ts';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';
import { createMapQueries } from '../src/native/ported/motion/locomotion/b2/map-queries.ts';

const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
const point = ([x, y, z]) => ({ x, y, z });
const metrics = {
  body: { centreToSoleM: .1, eyeFromSoleM: { x: 0, y: .25, z: -.03 } },
  chaseTargetOffset: [0, .15, 0], chaseGroundOffset: [0, .8, 3], chaseAirOffset: [0, 1.2, 4],
};
const projection = { near: .01, verticalFovDegrees: 59, aspect: 16 / 9 };
const emptyWorld = { sphereClear: () => true, sweepSphere: () => null };
const req = (grounded, heading, hz, world = emptyWorld) => ({
  bird: { x: 0, y: grounded ? .1 : 8, z: 0, heading, grounded, vy: 0 },
  mode: 'third', world, metrics, projection, acceptedSeconds: 1 / hz,
});
const resolved = result => { assert.equal(result.kind, 'resolved', result.reason); return result; };
const sameRadius = (result, expected) => assert.ok(Math.abs(distance(result.position, result.lookAt) - expected) < 1e-9,
  `orbit radius ${distance(result.position, result.lookAt)} != ${expected}`);

for (const hz of [30, 60, 120]) {
  test(`empty-space drag, reversal, half-turn and release preserve radius at ${hz} Hz`, () => {
    for (const grounded of [true, false]) for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const request = req(grounded, heading, hz);
      let current = resolved(resolveNativeCamera(request));
      const radius = distance(current.position, current.lookAt);
      for (let i = 0; i < hz * 6; i++) {
        const seconds = i / hz;
        const orbit = seconds < 2 ? { yaw: seconds * 3, pitch: Math.sin(seconds * 2) } :
          seconds < 4 ? { yaw: (4 - seconds) * 3, pitch: -Math.sin(seconds * 2) } : { yaw: Math.PI, pitch: -.5 };
        current = resolved(resolveNativeCamera({ ...request, previousPosition: current.position, orbit }));
        assert.equal(current.cut, false);
        sameRadius(current, radius);
      }
    }
  });
}

function floorAndWall() {
  return {
    sphereClear(p, r) { return p.y > r && p.x < 1.2 - r; },
    sweepSphere(from, to, r) {
      const hits = [];
      if (to.y <= r && to.y < from.y) hits.push({ fraction: (from.y - r) / (from.y - to.y), normal: { x: 0, y: 1, z: 0 }, colliderId: 'floor' });
      if (to.x >= 1.2 - r && to.x > from.x) hits.push({ fraction: (1.2 - r - from.x) / (to.x - from.x), normal: { x: -1, y: 0, z: 0 }, colliderId: 'wall' });
      const hit = hits.filter(h => h.fraction >= 0 && h.fraction <= 1).sort((a, b) => a.fraction - b.fraction)[0];
      return hit ? { ...hit, point: { x: from.x + (to.x - from.x) * hit.fraction,
        y: from.y + (to.y - from.y) * hit.fraction, z: from.z + (to.z - from.z) * hit.fraction } } : null;
    },
  };
}

for (const hz of [30, 60, 120]) {
  test(`ground/wall stops rotation without zoom or unsafe chords at ${hz} Hz`, () => {
    const world = floorAndWall(), request = req(true, 0, hz, world);
    const clearance = cameraNearRadius(projection) + .001;
    let current = resolved(resolveNativeCamera(request));
    const radius = distance(current.position, current.lookAt);
    for (let i = 0; i < hz * 6; i++) {
      const orbit = { yaw: 2 * Math.sin(i / hz), pitch: i < hz * 3 ? 1.4 : -.8 };
      const next = resolved(resolveNativeCamera({ ...request, previousPosition: current.position, orbit }));
      sameRadius(next, radius);
      assert.equal(world.sphereClear(point(next.position), clearance), true);
      assert.equal(world.sweepSphere(point(current.position), point(next.position), clearance), null);
      assert.equal(world.sweepSphere(point(next.lookAt), point(next.position), clearance), null);
      assert.equal(next.occluded, false);
      current = next;
    }
    assert.ok(current.position[1] > 1, 'reversing vertical drag leaves the floor limit');
  });
}

test('horizontal drag still works while upward drag is constrained by ground', () => {
  const world = floorAndWall(), request = req(true, 0, 60, world);
  let current = resolved(resolveNativeCamera({ ...request, orbit: { yaw: 0, pitch: 1.4 } }));
  const radius = distance(current.position, current.lookAt), before = current.position;
  for (let i = 0; i < 120; i++) current = resolved(resolveNativeCamera({ ...request,
    previousPosition: current.position, orbit: { yaw: 1, pitch: 1.4 } }));
  sameRadius(current, radius);
  assert.ok(distance(current.position, before) > 1, 'yaw is not frozen by a blocked pitch');
});

test('legacy orbit keeps distance during yaw and constrained ground pitch', () => {
  const request = { bird: { x: 0, y: .7, z: 0, grounded: true, heading: 0, vy: 0 }, mode: 'third', obstacles: [], dt: 1 / 60 };
  let current = resolved(resolveCamera(request));
  const radius = distance(current.position, current.lookAt);
  for (let i = 0; i < 300; i++) {
    current = resolved(resolveCamera({ ...request, previousPosition: current.position,
      orbit: { yaw: i / 30, pitch: i < 150 ? 1.4 : -.8 } }));
    sameRadius(current, radius);
    assert.equal(current.cut, false);
    assert.equal(current.occluded, false);
    assert.ok(current.position[1] > cameraNearRadius({ near: .12, verticalFovDegrees: 59, aspect: 16 / 9 }) + .001);
  }
});

test('zero time freezes, reduced-motion half-turn stays finite, and first-person eye never orbits', () => {
  const request = req(false, 0, 60), orbit = { yaw: Math.PI, pitch: .8 };
  const base = resolved(resolveNativeCamera(request));
  const paused = resolved(resolveNativeCamera({ ...request, previousPosition: base.position, acceptedSeconds: 0, orbit }));
  assert.deepEqual(paused.position, base.position);
  const reduced = resolved(resolveNativeCamera({ ...request, previousPosition: base.position, reducedMotion: true, orbit }));
  sameRadius(reduced, distance(base.position, base.lookAt));
  const first = resolved(resolveNativeCamera({ ...request, mode: 'first', orbit }));
  const firstBase = resolved(resolveNativeCamera({ ...request, mode: 'first' }));
  assert.deepEqual(first.position, firstBase.position);
  assert.ok(distance(first.lookAt, firstBase.lookAt) > 1);
});

test('stable orbit defers already obstructed starts and never accepts unchecked candidates', () => {
  assert.equal(stableOrbitStep([0, 0, 0], [0, 1, 3], [3, 1, 0], .1, () => false), null);
  const approved = [];
  const result = stableOrbitStep([0, 0, 0], [0, 1, 3], [3, 1, 0], .1, p => {
    if (p[0] < .1) { approved.push(p); return true; } return false;
  });
  assert.ok(approved.includes(result));
  assert.ok(result[0] < .1);
  assert.ok(Math.abs(Math.hypot(...result) - Math.sqrt(10)) < 1e-9);
});

test('actual OSM scene keeps fixed bird-centred distance during repeated drag and release', () => {
  const engine = createNativeScene(new THREE.Scene(), 'pigeon', { preset: 'plaza', mapData: 'osm', quality: 'mobile', sessionId: 'orbit-distance-test' });
  const projection = { near: nativeNear(engine.state.body, 59, 16 / 9), verticalFovDegrees: 59, aspect: 16 / 9 };
  const clearance = cameraNearRadius(projection) + .001;
  const idle = { forward: 0, turn: 0, flapPressed: false, flapHeld: false, descend: false };
  const radius = distance(engine.camera.position, engine.camera.lookAt);
  try {
    for (let i = 0; i < 240; i++) {
      const before = engine.camera.position;
      const orbit = i < 180 ? { yaw: i / 25, pitch: Math.sin(i / 30) } : { yaw: 1, pitch: -.6 };
      const proposal = engine.prepare(idle, 1 / 60, projection, 'third', 10 + (i + 1) / 60, false, Infinity, orbit);
      assert.equal(proposal.kind, 'ready', proposal.reason); proposal.commit();
      sameRadius(engine.camera, radius);
      assert.equal(engine.queries.sphereClear(point(engine.camera.position), clearance), true);
      assert.equal(engine.queries.sweepSphere(point(before), point(engine.camera.position), clearance), null);
      assert.equal(engine.camera.occluded, false);
    }
  } finally { engine.dispose(); }
});


test('manual orbit still recovers an already occluded roof-drop camera without an unsafe cut', () => {
  const drop = JSON.parse(fs.readFileSync(new URL('./fixtures/camera-drop.json', import.meta.url), 'utf8'));
  const world = createMapQueries(makeMapLayout({ terrain: 'sunken-channel', proportions: 'reference-scale' }));
  const body = drop.state.body;
  const metrics = { body, chaseTargetOffset: [0, body.eyeFromSoleM.y - body.centreToSoleM, 0],
    chaseGroundOffset: [0, body.heightM * 3.2 - body.centreToSoleM, body.heightM * 10],
    chaseAirOffset: [0, body.heightM * 5.2 - body.centreToSoleM, body.heightM * 14.5] };
  const clearance = cameraNearRadius(drop.projection) + .001;
  for (const orbit of [{ yaw: .2, pitch: -.3 }, { yaw: 1, pitch: .5 }]) {
    let previous = drop.camera.position, current;
    for (let i = 0; i < 180; i++) {
      current = resolved(resolveNativeCamera({ bird: drop.state, mode: 'third', world, metrics,
        projection: drop.projection, acceptedSeconds: 1 / 60, previousPosition: previous, orbit }));
      assert.equal(current.cut, false);
      assert.equal(world.sphereClear(point(current.position), clearance), true);
      assert.equal(world.sweepSphere(point(previous), point(current.position), clearance), null);
      previous = current.position;
    }
    assert.equal(current.occluded, false);
    assert.ok(distance(current.position, current.lookAt) < 4);
  }
});
