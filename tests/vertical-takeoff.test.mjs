import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNativeMotionState, advanceNativeMotion } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { createBirdState, advanceBird, emptyInput } from '../src/simulation.ts';
import { createInputState, reduceInput, sampleInput } from '../src/input-reducer.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { nativeNear } from '../src/native/body-profile.ts';

const idle = emptyInput();
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const flatWorld = {
  sweepBody: () => null,
  supportAt(probe) {
    if (0 < Math.min(probe.previousFeetY, probe.at.y) - probe.maxDropM || 0 > probe.previousFeetY + probe.maxRiseM) return null;
    return { id: 'floor', layerId: 'ground', height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'stone', walkable: true, landable: true };
  },
};
function nativeStep(state, input, seconds = 1 / 60) {
  const result = advanceNativeMotion(state, input, seconds, flatWorld);
  assert.equal(result.status, 'advanced', result.reason); return result.state;
}

for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  test(`Space-only kestrel takeoff is vertical at heading ${heading}, including hold/glide and release`, () => {
    let state = createNativeMotionState({ canHover: true, feet: { x: 2, y: 0, z: 3 } }); state.heading = heading;
    const start = { x: state.x, y: state.y, z: state.z };
    for (let frame = 0; frame < 120; frame++) {
      state = nativeStep(state, { ...idle, flapPressed: frame === 0, flapHeld: frame < 70 });
      near(state.x, start.x); near(state.z, start.z); assert.equal(state.vx, 0); assert.equal(state.vz, 0);
      if (frame === 5) { assert.ok(state.y > start.y + .7); assert.ok(state.vy > 0); }
    }
    assert.equal(state.flaps, 1, 'holding does not add repeated vertical impulses');
  });
}

test('kestrel separate neutral wing beats gain altitude without any horizontal motion', () => {
  let state = createNativeMotionState({ canHover: true, feet: { x: 0, y: 0, z: 0 } });
  for (let frame = 0; frame < 120; frame++) state = nativeStep(state, { ...idle, flapPressed: frame % 15 === 0 });
  assert.equal(state.flaps, 8); assert.ok(state.y > 15);
  assert.equal(state.x, 0); assert.equal(state.z, 0);
});

test('kestrel pre-existing horizontal momentum decays smoothly at the existing 3.5/s response rate, never teleports or turns', () => {
  let state = createNativeMotionState({ canHover: true, feet: { x: 0, y: 30, z: 0 } });
  state.grounded = false; state.mode = 'fall'; state.vx = 2; state.vz = -3; state.heading = Math.PI / 2;
  const result = nativeStep(state, { ...idle, flapPressed: true, flapHeld: true }, .1);
  near(result.vx, 2 * Math.exp(-.35)); near(result.vz, -3 * Math.exp(-.35));
  assert.ok(result.x > 0 && result.x < .2); assert.ok(result.z < 0 && result.z > -.3);
  assert.ok(result.vy > 0);
});

test('kestrel releasing direction while holding Space stops thrust; adding direction restores existing flight acceleration', () => {
  let state = createNativeMotionState({ canHover: true, feet: { x: 0, y: 30, z: 0 } }); state.grounded = false;
  state = nativeStep(state, { ...idle, forward: 1, flapPressed: true, flapHeld: true }, .1);
  const moving = state.vz;
  state = nativeStep(state, { ...idle, flapHeld: true }, .1);
  near(state.vz, moving * Math.exp(-.35));
  const slowing = state.vz;
  state = nativeStep(state, { ...idle, forward: 1, flapHeld: true }, .1);
  assert.ok(state.vz < slowing);
});

test('kestrel WASD and arrow-key directional commands retain movement, while Space, Shift and roll alone do not generate thrust', () => {
  const gate = { enabled: true, focused: true, hidden: false, paused: false, dialogOpen: false };
  const pressed = keys => {
    let state = createInputState(gate);
    for (const code of keys) state = reduceInput(state, { type: 'key-down', code, repeat: false }).state;
    return sampleInput(state).input;
  };
  for (const key of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const state = nativeStep(createNativeMotionState({ canHover: true }), pressed(['Space', key]), .1);
    assert.ok(Math.hypot(state.vx, state.vz) > .1, key);
  }
  for (const keys of [['Space'], ['Space', 'ShiftLeft'], ['Space', 'KeyQ'], ['Space', 'KeyW', 'KeyS'], ['Space', 'ArrowLeft', 'ArrowRight']]) {
    const state = nativeStep(createNativeMotionState({ canHover: true }), pressed(keys), .1);
    assert.equal(state.vx, 0, keys.join('+')); assert.equal(state.vz, 0, keys.join('+')); assert.ok(state.vy > 0);
  }
});

test('directional kestrel native speed formula is unchanged for forward, reverse and turn-only inputs', () => {
  for (const forward of [-1, 0, 1]) {
    const initial = createNativeMotionState({ canHover: true, feet: { x: 0, y: 30, z: 0 } }); initial.grounded = false;
    // With no turn, forward=0 is deliberately the new neutral behavior.
    const result = nativeStep(initial, { ...idle, forward }, .1);
    const targetSpeed = forward ? initial.tuning.flightSpeed * (1 + forward * .14) : 0;
    near(result.vz, -targetSpeed * (1 - Math.exp(-.35)));
  }
  const state = createNativeMotionState({ canHover: true, feet: { x: 0, y: 30, z: 0 } }); state.grounded = false;
  const result = nativeStep(state, { ...idle, turn: 1 }, .1);
  near(result.heading, .135); assert.ok(result.vx > 0); assert.ok(result.vz < 0);
});

test('C descent keeps its 88.2m/s² acceleration, exact horizontal momentum and flap suppression', () => {
  for (const turn of [0, 1]) {
    const initial = createNativeMotionState({ canHover: true, feet: { x: 0, y: 100, z: 0 } });
    initial.grounded = false; initial.vx = 2; initial.vz = -3;
    let state = initial;
    for (let frame = 0; frame < 10; frame++) state = nativeStep(state, { ...idle, turn, accelerate: true, descend: true, flapPressed: frame === 0, flapHeld: true }, .1);
    near(state.vy, -88.2); assert.equal(state.vx, 2); assert.equal(state.vz, -3);
    near(state.x, initial.x + 2); near(state.z, initial.z - 3); assert.equal(state.flaps, 0); assert.equal(state.mode, 'fall');
  }
});

test('legacy pigeon and owl flight keep forward airspeed without direction input', () => {
  const bird = createBirdState(), x = bird.x, z = bird.z;
  for (let frame = 0; frame < 90; frame++) advanceBird(bird, { ...idle, flapPressed: frame === 0, flapHeld: frame < 60 }, 1 / 60, []);
  near(bird.x, x); assert.ok(bird.z < z - 10); assert.equal(bird.flaps, 1);
  const c = createBirdState(); c.y = 30; c.grounded = false;
  advanceBird(c, { ...idle, descend: true }, .1, []);
  near(c.vy, -2.5); near(c.vz, -17 * (1 - Math.exp(-.35)));
});

test('native non-kestrels keep forward flight, while ground rest and C remain unchanged', () => {
  let state = createNativeMotionState({ feet: { x: 0, y: 0, z: 0 } });
  state = nativeStep(state, idle); near(state.x, 0); near(state.z, 0);
  for (let i = 0; i < 120; i++) state = nativeStep(state, { ...idle, flapPressed: i % 15 === 0, flapHeld: true });
  assert.ok(state.z < -15); assert.ok(Math.hypot(state.vx, state.vz) > 10); assert.equal(state.canHover, false);
  const falling = { ...state, vx: 2, vz: -3 };
  const next = nativeStep(falling, { ...idle, descend: true }, .1);
  near(next.vx, 2); near(next.vz, -3);
});

test('actual real-map kestrel scene accepts a vertical Space-only takeoff in first and third person', () => {
  const engine = createNativeScene(new THREE.Scene(), 'pigeon', { mapData: 'osm', preset: 'plaza', quality: 'mobile', sessionId: 'vertical-takeoff-test' });
  try {
    assert.equal(engine.selectAppearance({ speciesId: 'kestrel', skinId: 'default' }), true);
    const start = engine.state;
    const projection = { near: nativeNear(start.body, 59, 16 / 9), verticalFovDegrees: 59, aspect: 16 / 9 };
    for (let frame = 0; frame < 90; frame++) {
      const proposal = engine.prepare({ ...idle, flapPressed: frame === 0, flapHeld: true }, 1 / 60, projection, frame < 45 ? 'third' : 'first', 10 + frame / 60, false);
      assert.equal(proposal.kind, 'ready', proposal.reason); proposal.commit();
      near(engine.state.x, start.x); near(engine.state.z, start.z);
      if (frame === 5) assert.ok(engine.state.y > start.y + .7);
    }
    assert.equal(engine.snapshot().blockedFrames, 0); assert.equal(engine.state.flaps, 1);
  } finally { engine.dispose(); }
});

 test('all native appearances derive hover permission from species, including swaps and home', () => {
  const engine = createNativeScene(new THREE.Scene(), 'pigeon', { quality: 'mobile' });
  try {
    for (const speciesId of ['kestrel', 'pigeon', 'sparrow', 'crow', 'magpie', 'tawny-owl', 'eagle-owl', 'heron']) {
      assert.equal(engine.selectAppearance({ speciesId, skinId: 'default' }), true, speciesId);
      assert.equal(engine.state.canHover, speciesId === 'kestrel', speciesId);
      assert.equal(engine.home(), true);
      assert.equal(engine.state.canHover, speciesId === 'kestrel', `${speciesId} home`);
    }
  } finally { engine.dispose(); }
});
