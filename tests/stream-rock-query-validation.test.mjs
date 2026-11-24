import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';
import { registerStreamRocks, withStreamStoneSupport } from '../src/native/stream-rock-shape.ts';
import { withCloudSupport } from '../src/native/cloud-platforms.ts';
import { createVehicleWorld } from '../src/native/vehicle-world.ts';
import { createNativeMotionState, advanceNativeMotion } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { createSpeciesActor } from '../src/species-core/actor.ts';
import { emptyInput } from '../src/simulation.ts';

const support = { id: 'base', layerId: 'base', height: .9, normal: { x: 0, y: 1, z: 0 }, surface: 'stone', walkable: true, landable: true };
const probe = { at: { x: 0, y: 1, z: 0 }, previousFeetY: 1, footRadiusM: .06, heightM: .25, maxRiseM: 0, maxDropM: .2 };
const clearWorld = { supportAt: () => null, sweepBody: () => null, sweepSphere: () => null, sphereClear: () => true };
const malformedSupports = [undefined, false, 0, '', {},
  ...[NaN, Infinity, -.1, 2].map(height => ({ ...support, height })),
  ...[{ x: 2, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: NaN, y: 1, z: 0 }, null].map(normal => ({ ...support, normal })),
  ...[{ id: '' }, { layerId: '' }, { surface: '' }, { walkable: 1 }, { landable: 'yes' }].map(patch => ({ ...support, ...patch })),
];
const from = { x: 0, y: 3, z: 0 }, to = { x: 0, y: 0, z: 0 };
const hit = { fraction: .5, point: { x: 0, y: 1.5, z: 0 }, normal: { x: 0, y: 1, z: 0 }, colliderId: 'base-hit' };
const malformedHits = [undefined, false, 0, '', {},
  ...[NaN, Infinity, -.1, 1.1].map(fraction => ({ ...hit, fraction })),
  ...[null, { x: NaN, y: 1.5, z: 0 }, { x: 1, y: 1.5, z: 0 }].map(point => ({ ...hit, point })),
  ...[null, { x: 2, y: 1, z: 0 }, { x: NaN, y: 1, z: 0 }].map(normal => ({ ...hit, normal })),
  { ...hit, colliderId: '' }, { ...hit, layerId: 7 },
  ...[null, { x: NaN, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 2, y: 0, z: 0 }].map(edgeSlide => ({ ...hit, edgeSlide })),
];
function setup() {
  const layout = makeMapLayout();
  const unregister = registerStreamRocks(layout, [{ x: 0, y: 1, z: 0, bedY: 0, radiusX: 2, radiusZ: 1.45 }]);
  return { layout, unregister };
}

test('malformed base support is rejected before a valid stone, cloud or vehicle can replace it', () => {
  const { layout, unregister } = setup();
  try {
    for (const value of malformedSupports) {
      const stone = withStreamStoneSupport({ ...clearWorld, supportAt: () => value, supportAtTime: () => value }, layout);
      assert.equal(stone.supportAt(probe), undefined);
      assert.equal(stone.supportAtTime(probe, 1), undefined);
      const cloud = { id: 'test-cloud', height: 1, rings: [[[-2,-2],[-2,2],[2,2],[2,-2],[-2,-2]]] };
      const car = { id: 'test-car', x: 0, y: -.51, z: 0, heading: 0, speed: 0, roadId: 'road', visible: true };
      const composed = createVehicleWorld(withCloudSupport(stone, [cloud]), () => [car]);
      assert.equal(composed.world.supportAt(probe), undefined);
    }
    const stone = withStreamStoneSupport({ ...clearWorld, supportAt: () => support }, layout);
    assert.equal(stone.supportAt(probe).id, 'stream:stone:0', 'valid lower support is still composed');
    assert.equal(withStreamStoneSupport(clearWorld, layout).supportAt(probe).id, 'stream:stone:0', 'null is a verified miss, not an error');
  } finally { unregister(); }
});

test('malformed base body, sphere and temporal camera hits cannot be hidden by nearer stones', () => {
  const { layout, unregister } = setup(), body = createNativeMotionState().body;
  try {
    for (const value of malformedHits) {
      const stone = withStreamStoneSupport({ ...clearWorld, sweepBody: () => value, sweepSphere: () => value, sweepCameraMotion: () => value }, layout);
      assert.equal(stone.sweepBody(from, to, body), undefined);
      assert.equal(stone.sweepSphere(from, to, .1), undefined);
      assert.equal(stone.sweepCameraMotion(from, to, .1), undefined);
      const composed = createVehicleWorld(withCloudSupport(stone, []), () => []);
      assert.equal(composed.world.sweepBody(from, to, body), undefined);
      assert.equal(composed.world.sweepSphere(from, to, .1), undefined);
    }
    assert.equal(withStreamStoneSupport(clearWorld, layout).sweepSphere(from, to, .1).colliderId, 'stream:stone:0');
    assert.equal(withStreamStoneSupport({ ...clearWorld, sweepSphere: () => hit }, layout).sweepSphere(from, to, .1).colliderId, 'base-hit');
  } finally { unregister(); }
});

test('stone-cloud-vehicle malformed query rolls back motion, events and the prepared actor/camera', () => {
  const { layout, unregister } = setup();
  try {
    for (const kind of ['support', 'sweep']) {
      let broken = false;
      const stone = withStreamStoneSupport({ ...clearWorld,
        supportAt: () => broken && kind === 'support' ? { ...support, height: NaN } : null,
        sweepBody: () => broken && kind === 'sweep' ? { ...hit, fraction: NaN } : null,
      }, layout);
      const vehicle = createVehicleWorld(withCloudSupport(stone, []), () => []);
      const state = createNativeMotionState({ feet: { x: 0, y: 1, z: 0 } }); state.support = vehicle.world.supportAt(probe);
      const actor = createSpeciesActor(new THREE.Scene(), { world: vehicle.world, initialState: state });
      try {
        const stateBefore = structuredClone(state), vehicleBefore = vehicle.snapshot(), actorBefore = actor.snapshot(); broken = true;
        const proposal = vehicle.preview([{ seconds: 0, states: [] }, { seconds: .05, states: [] }], 0, () => advanceNativeMotion(state, emptyInput(), .05, vehicle.world));
        assert.equal(proposal.result.status, 'blocked'); assert.equal(proposal.result.acceptedSeconds, 0);
        assert.deepEqual(proposal.result.events, []); assert.deepEqual(proposal.hits, []);
        assert.deepEqual(state, stateBefore); assert.deepEqual(proposal.result.state, stateBefore); assert.deepEqual(vehicle.snapshot(), vehicleBefore);
        const frame = actor.prepareFrame({ contractVersion: 1, frame: actorBefore.lastFrame + 1, simTime: .05, rawSeconds: .05, acceptedSeconds: .05, playing: true, quality: 'mobile', reducedMotion: false }, emptyInput(),
          { mode: 'third', verticalFovDegrees: 59, aspect: 16 / 9 });
        assert.equal(frame.kind, 'blocked'); assert.deepEqual(actor.snapshot(), actorBefore);
        broken = false;
        assert.equal(advanceNativeMotion(state, emptyInput(), .05, vehicle.world).status, 'advanced', 'verified recovery remains possible');
      } finally { actor.dispose(); }
    }
  } finally { unregister(); }
});

test('water immersion requires a verified sweep and clear destination before changing height', () => {
  const state = createNativeMotionState({ feet: { x: 0, y: -.03, z: 0 } }); state.grounded = false; state.mode = 'fall';
  const targetY = -.06 + state.body.centreToSoleM;
  const water = { id: 'water', y: 0, depth: .5, current: { x: 0, z: 0 } };
  for (const phase of ['segment', 'endpoint']) {
    let called = false;
    const world = { ...clearWorld, waterAt: () => water, sweepBody(from, to) {
      const immersion = Math.abs(to.y - targetY) < 1e-8;
      if (immersion && ((phase === 'segment' && from.y !== to.y) || (phase === 'endpoint' && from.y === to.y))) { called = true; return undefined; }
      return null;
    } };
    const result = advanceNativeMotion(state, emptyInput(), .025, world);
    assert.equal(called, true); assert.equal(result.status, 'blocked'); assert.equal(result.acceptedSeconds, 0);
    assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});
