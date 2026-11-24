import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cameraRelativeMovement, rebaseCameraOrbit } from '../src/camera-relative-movement.ts';
import { createInputState, reduceInput, sampleInput } from '../src/input-reducer.ts';
import { emptyInput, createBirdState, advanceBird } from '../src/simulation.ts';
import { createSpeciesActor } from '../src/species-core/index.ts';

const idle = emptyInput();
const close = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const world = {
  supportAt(p) {
    const min = Math.min(p.previousFeetY, p.at.y) - p.maxDropM, max = p.previousFeetY + p.maxRiseM;
    return min <= 1e-8 && max >= -1e-8 ? { id: 'floor', layerId: 'floor', height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'stone', walkable: true, landable: true } : null;
  },
  sweepBody: () => null, sphereClear: () => true, sweepSphere: () => null,
};
const gate = { enabled: true, focused: true, hidden: false, paused: false, dialogOpen: false };
function context(actor) { const s = actor.snapshot(); return { contractVersion: 1, frame: s.lastFrame + 1, simTime: s.state.time + 1 / 60, rawSeconds: 1 / 60, acceptedSeconds: 1 / 60, playing: true, quality: 'mobile', reducedMotion: false }; }
const view = orbit => ({ mode: 'third', verticalFovDegrees: 59, aspect: 390 / 844, orbit });
function step(actor, input, orbit = actor.snapshot().view.orbit, flirtAge = Infinity) {
  const draft = actor.prepareFrame(context(actor), input, view(orbit), undefined, Infinity, Infinity, flirtAge);
  assert.equal(draft.kind, 'ready', draft.reason); draft.commit(); return actor.snapshot();
}
const cameraDirection = s => s.camera.lookAt.map((v, i) => v - s.camera.position[i]);

test('keyboard W and mobile forward stick both move toward the displayed camera heading', () => {
  let keyboard = createInputState(gate), mobile = createInputState(gate);
  keyboard = reduceInput(keyboard, { type: 'key-down', code: 'KeyW', repeat: false }).state;
  mobile = reduceInput(mobile, { type: 'pointer-down', id: 8, control: 'stick', axes: [0, -1] }).state;
  for (const source of [keyboard, mobile]) for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const raw = sampleInput(source).input, direction = [Math.sin(heading), -.8, -Math.cos(heading)];
    const input = cameraRelativeMovement(raw, direction, 0);
    close(input.moveHeading, heading); assert.equal(input.forward, 1); assert.equal(input.turn, 0);
    const bird = createBirdState(); advanceBird(bird, input, .1, []);
    close(bird.heading, heading); assert.ok(bird.vx * direction[0] + bird.vz * direction[2] > 0);
  }
});
test('diagonal stick is capped, backwards faces its travel, pitch never changes ground speed', () => {
  const input = cameraRelativeMovement({ ...idle, forward: 1, turn: 1 }, [0, 100, -1], 2);
  close(input.moveHeading, Math.PI / 4); assert.equal(input.forward, 1);
  close(cameraRelativeMovement({ ...idle, forward: -1 }, [0, 0, -1], 0).moveHeading, Math.PI);
  const slow = cameraRelativeMovement({ ...idle, forward: .3 }, [1, 50, 0], 0);
  assert.equal(slow.forward, .3); close(slow.moveHeading, Math.PI / 2);
  close(cameraRelativeMovement({ ...idle, forward: 1 }, [0, 1, 0], .7).moveHeading, .7);
});
test('stationary camera orbit does not turn the bird or create walking', () => {
  const actor = createSpeciesActor(new THREE.Scene(), { world });
  try {
    for (let i = 0; i < 30; i++) step(actor, cameraRelativeMovement(idle, [1, 0, 0], 0), { yaw: 1, pitch: -.2 });
    close(actor.state.heading, 0); close(actor.state.x, 0); close(actor.state.z, 0); assert.equal(actor.state.mode, 'rest');
  } finally { actor.dispose(); }
});
test('camera-relative heading and rebased orbit commit atomically without chase-camera rotation feedback', () => {
  const actor = createSpeciesActor(new THREE.Scene(), { world });
  try {
    for (let i = 0; i < 120; i++) step(actor, idle, { yaw: Math.PI / 2, pitch: -.3 });
    let orbit = { yaw: Math.PI / 2, pitch: -.3 };
    const initial = actor.snapshot(), target = Math.atan2(cameraDirection(initial)[0], -cameraDirection(initial)[2]);
    for (let i = 0; i < 180; i++) {
      const before = actor.snapshot(), input = cameraRelativeMovement({ ...idle, forward: 1 }, cameraDirection(before), before.state.heading);
      const after = step(actor, input, orbit);
      orbit = rebaseCameraOrbit(orbit, before.state.heading, after.state.heading);
      close(orbit.yaw, after.view.orbit.yaw); close(after.state.heading, target, .015);
      close(after.state.heading + orbit.yaw, Math.PI / 2, .015);
    }
    assert.ok(actor.state.x > 2); assert.ok(Math.abs(actor.state.z) < .05);
    close(actor.root.rotation.y, -actor.state.heading);
  } finally { actor.dispose(); }
});
test('kestrel neutral Space stays vertical; airborne directional input turns toward the camera without adding flap events', () => {
  const actor = createSpeciesActor(new THREE.Scene(), { world, appearance: { speciesId: 'kestrel', skinId: 'default' } });
  try {
    let s = step(actor, cameraRelativeMovement({ ...idle, flapHeld: true, flapPressed: true }, [1, 0, 0], 0));
    close(s.state.x, 0); close(s.state.z, 0); assert.equal(s.state.flaps, 1); assert.ok(s.state.y > .1);
    for (let i = 0; i < 20; i++) s = step(actor, cameraRelativeMovement({ ...idle, flapHeld: true, forward: 1 }, [1, .6, 0], 0));
    close(s.state.heading, Math.PI / 2); assert.ok(s.state.x > .5); close(s.state.z, 0); assert.equal(s.state.flaps, 1);
    const vy = s.state.vy;
    s = step(actor, cameraRelativeMovement({ ...idle, descend: true }, [1, 0, 0], 0));
    assert.ok(s.state.vy < vy); assert.equal(s.state.flaps, 1);
  } finally { actor.dispose(); }
});
test('world-relative/autonomous input omitting moveHeading retains original turning semantics', () => {
  const actor = createSpeciesActor(new THREE.Scene(), { world });
  try {
    const s = step(actor, { ...idle, forward: 1, turn: .5 }, { yaw: 1.2, pitch: null });
    close(s.state.heading, .5 * 2.35 / 60); assert.equal(s.view.orbit.yaw, 1.2);
  } finally { actor.dispose(); }
});
test('failed and stale camera frames do not rotate the bird or mutate committed camera', () => {
  let broken = false;
  const actor = createSpeciesActor(new THREE.Scene(), { world: { ...world, sphereClear: () => broken ? undefined : true } });
  try {
    const before = actor.snapshot(), input = cameraRelativeMovement({ ...idle, forward: 1 }, [1, 0, 0], 0);
    broken = true; const bad = actor.prepareFrame(context(actor), input, view({ yaw: 1, pitch: null }));
    assert.equal(bad.kind, 'blocked'); assert.deepEqual(actor.snapshot(), before);
    broken = false; const draft = actor.prepareFrame(context(actor), input, view({ yaw: 1, pitch: null }));
    step(actor, idle); assert.equal(draft.isCurrent(), false); assert.throws(() => draft.commit()); close(actor.state.heading, 0);
  } finally { actor.dispose(); }
});
test('flirt elbow morph is preserved by frame commit, restored by cancellation and cleared by walking', () => {
  const actor = createSpeciesActor(new THREE.Scene(), { world });
  const weights = () => { const values = []; actor.root.traverse(o => { if (o instanceof THREE.Mesh && o.morphTargetInfluences) values.push(...o.morphTargetInfluences); }); return values; };
  try {
    const draft = actor.prepareFrame(context(actor), idle, view({ yaw: 0, pitch: null }), undefined, Infinity, Infinity, .7);
    assert.equal(draft.kind, 'ready'); assert.deepEqual(weights(), [0, 0]);
    draft.commit(); assert.deepEqual(weights(), [1, 1]);
    const next = actor.prepareFrame(context(actor), idle, undefined, undefined, Infinity, Infinity, Infinity);
    assert.equal(next.kind, 'ready'); next.cancel(); assert.deepEqual(weights(), [1, 1]);
    step(actor, { ...idle, forward: 1 }, undefined, .7); assert.deepEqual(weights(), [0, 0]);
  } finally { actor.dispose(); }
});

test('first-person manual direction keeps the camera world heading as the bird turns', () => {
  const actor = createSpeciesActor(new THREE.Scene(), { world, view: { mode: 'first', verticalFovDegrees: 59, aspect: 390 / 844 } });
  try {
    const before = actor.snapshot();
    const input = cameraRelativeMovement({ ...idle, forward: 1 }, [1, 0, 0], 0);
    const draft = actor.prepareFrame(context(actor), input, { mode: 'first', verticalFovDegrees: 59, aspect: 390 / 844, orbit: { yaw: Math.PI / 2, pitch: 0 } });
    assert.equal(draft.kind, 'ready', draft.reason); draft.commit();
    const after = actor.snapshot(), d = cameraDirection(after);
    close(after.state.heading, Math.PI / 2); close(after.view.orbit.yaw, 0); close(Math.atan2(d[0], -d[2]), Math.PI / 2);
    assert.ok(after.state.x > before.state.x);
  } finally { actor.dispose(); }
});
