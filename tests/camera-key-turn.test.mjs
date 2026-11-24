import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInputState, reduceInput, sampleInput } from '../src/input-reducer.ts';
import { cameraRelativeMovement, rebaseCameraOrbit, turnCameraOrbit, CAMERA_KEY_TURN_SPEED } from '../src/camera-relative-movement.ts';
import { CameraOrbitControls } from '../src/camera-orbit.ts';
import { SPECIES } from '../src/species-core/appearance.ts';
import { createSpeciesActor } from '../src/species-core/index.ts';
import { emptyInput } from '../src/simulation.ts';

const gate = { enabled: true, focused: true, hidden: false, paused: false, dialogOpen: false };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const close = (a, b, error = 1e-8) => assert.ok(Math.abs(wrap(a - b)) < error, `${a} != ${b}`);
const press = (state, code) => reduceInput(state, { type: 'key-down', code, repeat: false }).state;
const neutralOrbit = { yaw: 0, pitch: null };
const world = {
  supportAt(p) {
    const min = Math.min(p.previousFeetY, p.at.y) - p.maxDropM, max = p.previousFeetY + p.maxRiseM;
    return min <= 1e-8 && max >= -1e-8 ? { id: 'floor', layerId: 'floor', height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'stone', walkable: true, landable: true } : null;
  },
  sweepBody: () => null, sphereClear: () => true, sweepSphere: () => null,
};
const direction = s => s.camera.lookAt.map((v, i) => v - s.camera.position[i]);
function context(s, seconds) {
  return { contractVersion: 1, frame: s.lastFrame + 1, simTime: s.state.time + seconds, rawSeconds: seconds, acceptedSeconds: seconds, playing: true, quality: 'mobile', reducedMotion: false };
}

test('left/right arrow keys and the mobile pad add camera rotation; opposite keys, release and gates stop it', () => {
  for (const [code, axis] of [['ArrowLeft', -1], ['ArrowRight', 1]]) {
    let s = press(createInputState(gate), code);
    assert.equal(sampleInput(s).input.cameraTurn, axis);
    assert.equal(sampleInput(s).input.turn, axis, 'existing lateral movement is preserved');
    s = reduceInput(s, { type: 'key-up', code }).state;
    assert.equal(sampleInput(s).input.cameraTurn, 0);
  }
  assert.equal(sampleInput(press(press(createInputState(gate), 'ArrowLeft'), 'ArrowRight')).input.cameraTurn, 0);
  for (const patch of [{ paused: true }, { hidden: true }, { focused: false }, { dialogOpen: true }, { enabled: false }]) {
    const s = reduceInput(press(createInputState(gate), 'ArrowRight'), { type: 'gate', gate: { ...gate, ...patch } }).state;
    assert.equal(sampleInput(s).input.cameraTurn, 0);
    assert.equal(sampleInput(reduceInput(s, { type: 'gate', gate }).state).input.cameraTurn, 0);
  }
  for (const key of ['KeyA', 'KeyD', 'KeyQ', 'KeyE']) assert.equal(sampleInput(press(createInputState(gate), key)).input.cameraTurn, 0);
  const mobile = reduceInput(createInputState(gate), { type: 'pointer-down', id: 8, control: 'stick', axes: [1, 0] }).state;
  assert.equal(sampleInput(mobile).input.cameraTurn, 1);
  assert.equal(sampleInput(mobile).input.turn, 1);
});

test('key turns are frame-rate independent, preserve drag pitch and reject inactive/invalid time', () => {
  for (const hz of [30, 60, 120]) for (const sign of [-1, 1]) {
    let orbit = { yaw: 2.9, pitch: -.7 };
    for (let i = 0; i < hz * 2; i++) orbit = turnCameraOrbit(orbit, sign, 1 / hz);
    close(orbit.yaw, 2.9 + sign * CAMERA_KEY_TURN_SPEED * 2);
    assert.equal(orbit.pitch, -.7);
  }
  for (const dt of [0, -1, .11, NaN, Infinity]) assert.deepEqual(turnCameraOrbit(neutralOrbit, 1, dt), neutralOrbit);
  for (const axis of [undefined, NaN, Infinity]) assert.deepEqual(turnCameraOrbit(neutralOrbit, axis, .05), neutralOrbit);
});

test('all species rotate first/third-person view in both arrow directions without feedback acceleration', () => {
  for (const speciesId of SPECIES) {
    for (const mode of ['first', 'third']) for (const sign of [-1, 1]) {
      const actor = createSpeciesActor(new THREE.Scene(), { world, appearance: { speciesId, skinId: 'default' }, view: { mode, verticalFovDegrees: 59, aspect: 16 / 9 } });
      const controls = new CameraOrbitControls(new EventTarget(), () => -.2);
      try {
        for (let i = 0; i < 60; i++) {
          const before = actor.snapshot(), dt = 1 / 60;
          const raw = { ...emptyInput(), turn: sign, cameraTurn: sign, flapHeld: i >= 30, flapPressed: i === 30 };
          const input = cameraRelativeMovement(raw, direction(before), before.state.heading);
          const nextOrbit = turnCameraOrbit(controls.angles, raw.cameraTurn, dt);
          const frame = actor.prepareFrame(context(before, dt), input, { mode, verticalFovDegrees: 59, aspect: 16 / 9, orbit: nextOrbit });
          assert.equal(frame.kind, 'ready', `${speciesId}/${mode}: ${frame.reason}`);
          frame.commit();
          controls.rebaseHeading(before.state.heading, actor.state.heading, raw.cameraTurn, dt);
          const after = actor.snapshot();
          close(controls.angles.yaw, after.view.orbit.yaw);
          close(after.state.heading + after.view.orbit.yaw, sign * CAMERA_KEY_TURN_SPEED * (i + 1) * dt);
        }
        const s = actor.snapshot(), d = direction(s), yaw = Math.atan2(d[0], -d[2]);
        assert.ok(sign * yaw > .5, `${speciesId}/${mode}: displayed camera turns the requested way`);
        assert.ok(Math.abs(wrap(yaw - sign * CAMERA_KEY_TURN_SPEED)) < .7, `${speciesId}/${mode}: yaw ${yaw} should not have feedback acceleration`);
      } finally { actor.dispose(); }
    }
  }
});

test('rejected camera preparation leaves committed camera and control orbit unchanged', () => {
  let broken = false;
  const actor = createSpeciesActor(new THREE.Scene(), { world: { ...world, sphereClear: () => broken ? undefined : true } });
  const controls = new CameraOrbitControls(new EventTarget(), () => 0);
  try {
    const before = actor.snapshot(), raw = { ...emptyInput(), turn: 1, cameraTurn: 1 };
    broken = true;
    const frame = actor.prepareFrame(context(before, .05), cameraRelativeMovement(raw, direction(before), before.state.heading),
      { mode: 'third', verticalFovDegrees: 59, aspect: 16 / 9, orbit: turnCameraOrbit(controls.angles, 1, .05) });
    assert.equal(frame.kind, 'blocked');
    assert.deepEqual(actor.snapshot(), before); assert.deepEqual(controls.angles, neutralOrbit);
    close(rebaseCameraOrbit(turnCameraOrbit(neutralOrbit, 1, .05), 0, .3).yaw, .08 - .3);
  } finally { actor.dispose(); }
});

test('touch camera turns proportionally, supports two fingers and stops on release/cancel/gates', () => {
  for (const axis of [-1, -.4, .4, 1]) {
    let s = reduceInput(createInputState(gate), { type: 'pointer-down', id: 8, control: 'stick', axes: [axis, 0] }).state;
    assert.equal(sampleInput(s).input.cameraTurn, sampleInput(s).input.turn);
    assert.equal(Math.sign(sampleInput(s).input.cameraTurn), Math.sign(axis));
    s = reduceInput(s, { type: 'pointer-down', id: 9, control: 'flap' }).state;
    assert.equal(sampleInput(s).input.flapHeld, true);
    assert.equal(Math.sign(sampleInput(s).input.cameraTurn), Math.sign(axis));
    for (const type of ['pointer-up', 'pointer-cancel', 'lost-pointer-capture']) {
      const next = reduceInput(s, { type, id: 8, control: 'stick' }).state;
      assert.equal(sampleInput(next).input.cameraTurn, 0);
      assert.equal(sampleInput(next).input.flapHeld, true);
    }
    for (const patch of [{ paused: true }, { hidden: true }, { focused: false }, { dialogOpen: true }, { enabled: false }]) {
      const next = reduceInput(s, { type: 'gate', gate: { ...gate, ...patch } }).state;
      assert.equal(sampleInput(next).input.cameraTurn, 0);
      assert.equal(sampleInput(reduceInput(next, { type: 'gate', gate }).state).input.cameraTurn, 0);
    }
    s = press(s, axis < 0 ? 'ArrowLeft' : 'ArrowRight');
    assert.equal(sampleInput(s).input.cameraTurn, Math.sign(axis), 'combined input is clamped');
  }
});
