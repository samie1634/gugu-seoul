import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Controls, applyControlsGate } from '../src/input.ts';
import { createFrameClock, resetFrameClock } from '../src/frame-clock.ts';
import { freshProgress, addPlayTime } from '../src/progress.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { transactNativeFrame } from '../src/native/frame-transaction.ts';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';
import { createMapQueries } from '../src/native/ported/motion/locomotion/b2/map-queries.ts';
import { nativeNear } from '../src/native/body-profile.ts';

class ElementStub extends EventTarget {
  captured = new Set();
  style = { removeProperty() {}, transform: '' };
  querySelector() { return new ElementStub(); }
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 122, height: 122 }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}
const gateOpen = { enabled: true, focused: true, hidden: false, paused: false, dialogOpen: false };
const projection = { near: 0.12, verticalFovDegrees: 59, aspect: 16 / 9 };
function key(type, code, repeat = false) {
  const event = new Event(type, { cancelable: true }); Object.assign(event, { code, repeat }); window.dispatchEvent(event);
}
function harness(t, { preset = 'plaza', world } = {}) {
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget(); globalThis.Element = ElementStub;
  document.hasFocus = () => true; document.hidden = false;
  const controls = new Controls(new ElementStub(), new ElementStub(), new ElementStub());
  let gate = { ...gateOpen }; let clock = createFrameClock(gate); controls.setGate(gate);
  const engine = createNativeScene(new THREE.Scene(), 'pigeon', { preset, quality: 'mobile', sessionId: 'integration-test', world });
  const progress = freshProgress(); let worldTime = 0; let now = 0;
  function apply(changes) { gate = { ...gate, ...changes }; clock = applyControlsGate(controls, clock, gate); }
  window.addEventListener('blur', () => apply({ focused: false }));
  window.addEventListener('focus', () => apply({ focused: true }));
  function frame(timestamp, mode = 'third') {
    now = timestamp;
    const before = clock;
    const tick = transactNativeFrame(before, timestamp, controls,
      (input, dt) => engine.prepare(input, dt, { ...projection, near: nativeNear(engine.state.body, projection.verticalFovDegrees, projection.aspect) }, mode, 10 + worldTime + dt, false), () => clock === before);
    clock = clock === before ? tick.clock : resetFrameClock(clock);
    if (tick.status === 'committed') {
      worldTime += tick.acceptedSeconds; addPlayTime(progress, tick.acceptedSeconds, true); engine.world.update(worldTime, tick.acceptedSeconds);
    }
    return tick;
  }
  t.after(() => engine.dispose());
  return { engine, controls, progress, frame, apply, get clock() { return clock; }, get worldTime() { return worldTime; }, step(ms = 1000 / 60, mode) { return frame(now + ms, mode); } };
}
function pose(engine) {
  const result = []; engine.root.traverse(object => { result.push([object.name, ...object.position, ...object.quaternion, ...object.scale]); }); return result;
}
function actualWorld() { return createMapQueries(makeMapLayout({ terrain: 'sunken-channel', proportions: 'reference-scale' })); }
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('native preview is single-use and cannot overwrite a blur/cancelled input generation', t => {
  const h = harness(t); key('keydown', 'Space'); key('keyup', 'Space');
  const old = h.controls.preview(); assert.equal(old.input.flapPressed, true); assert.equal(h.controls.preview().input.flapPressed, true);
  window.dispatchEvent(new Event('blur')); assert.equal(old.commit(), false);
  window.dispatchEvent(new Event('focus')); assert.equal(h.controls.preview().input.flapPressed, false);
  key('keydown', 'Space'); const fresh = h.controls.preview(); assert.equal(fresh.commit(), true); assert.equal(fresh.commit(), false);
  assert.equal(h.controls.preview().input.flapPressed, false);
});

test('late camera undefined rolls back actual motion, posed rig, clock, progress and IDs; a fresh tap retries once', t => {
  const base = actualWorld(); let fail = false;
  const world = { ...base, sphereClear: (...args) => fail ? undefined : base.sphereClear(...args) };
  const h = harness(t, { world }); h.frame(0); h.frame(17);
  const before = h.engine.snapshot(); const beforePose = pose(h.engine); const seconds = h.clock.activeSeconds;
  key('keydown', 'Space'); key('keyup', 'Space'); fail = true;
  const rejected = h.frame(5017, 'first'); assert.equal(rejected.status, 'blocked'); assert.equal(rejected.acceptedSeconds, 0);
  const after = h.engine.snapshot(); assert.deepEqual(after.state, before.state); assert.deepEqual(after.camera, before.camera);
  assert.deepEqual(pose(h.engine), beforePose); assert.equal(after.sequence, before.sequence); assert.equal(after.batchSequence, before.batchSequence);
  assert.deepEqual(after.waterPhase, before.waterPhase); near(h.clock.activeSeconds, seconds); near(h.progress.activeSeconds, seconds);
  assert.deepEqual(after.modeVisits, before.modeVisits);
  assert.equal(h.clock.previousTimestampMs, null); assert.equal(h.controls.preview().input.flapPressed, true);
  fail = false; assert.equal(h.frame(9017).acceptedSeconds, 0); assert.equal(h.frame(9034).status, 'committed');
  assert.equal(h.engine.state.flaps, 1); near(h.progress.activeSeconds, seconds + 0.017);
  assert.equal(h.engine.snapshot().rawEvents.filter(event => event.type === 'flap').length, 1);
});

test('a validated null support continues falling while later undefined leaves the last committed frame intact', t => {
  let unavailable = false;
  const world = { supportAt: () => unavailable ? undefined : null, sweepBody: () => null, sphereClear: () => true, sweepSphere: () => null };
  const h = harness(t, { world }); h.frame(0); assert.equal(h.frame(20).status, 'committed');
  assert.ok(h.engine.snapshot().sole.y < 0); assert.equal(h.engine.state.grounded, false);
  const previous = { ...h.engine.state }; unavailable = true;
  assert.equal(h.frame(40).status, 'blocked'); assert.deepEqual(h.engine.state, previous); near(h.clock.activeSeconds, 0.02);
});

test('real Controls tap/hold/landing consumes one clock and one canonical event stream', t => {
  const h = harness(t); key('keydown', 'Space'); h.frame(0);
  for (let i = 0; i < 25; i++) { key('keydown', 'Space', true); assert.equal(h.step().status, 'committed'); }
  assert.equal(h.engine.state.flaps, 1); assert.equal(h.engine.state.mode, 'glide');
  key('keyup', 'Space'); key('keydown', 'ShiftLeft');
  for (let i = 0; i < 240 && !h.engine.state.grounded; i++) h.step();
  key('keyup', 'ShiftLeft'); assert.equal(h.engine.state.grounded, true);
  for (let i = 0; i < 20; i++) h.step();
  const snapshot = h.engine.snapshot(); const flaps = snapshot.recentEvents.filter(event => event.type === 'flap'); const lands = snapshot.recentEvents.filter(event => event.type === 'land');
  assert.equal(flaps.length, 1); assert.equal(lands.length, 1); assert.ok(lands[0].supportId); assert.ok(lands[0].impactSpeed >= 0);
  assert.equal(flaps[0].actorId, 'player-bird'); assert.equal(flaps[0].sourceId, 'motion-stream'); assert.equal(flaps[0].rawId, 'player-bird:1');
  assert.equal(new Set(snapshot.recentEvents.map(event => event.id)).size, snapshot.recentEvents.length);
  for (const event of snapshot.recentEvents) assert.deepEqual(Object.keys(event.position).sort(), ['x', 'y', 'z']);
  near(h.engine.state.time, h.clock.activeSeconds); near(h.progress.activeSeconds, h.clock.activeSeconds); near(h.worldTime, h.clock.activeSeconds);
});

test('water phase and pose freeze in the same modal/blur clock boundary and restart without backlog', t => {
  const h = harness(t, { preset: 'river' }); h.frame(0); h.frame(20);
  const initialPhase = h.engine.snapshot().waterPhase;
  h.frame(40); assert.notDeepEqual(h.engine.snapshot().waterPhase, initialPhase);
  const before = h.engine.snapshot(); const beforePose = pose(h.engine);
  h.apply({ dialogOpen: true }); key('keydown', 'Space'); h.frame(5000);
  assert.deepEqual(h.engine.state, before.state); assert.deepEqual(h.engine.snapshot().waterPhase, before.waterPhase); assert.deepEqual(pose(h.engine), beforePose);
  h.apply({ dialogOpen: false }); assert.equal(h.frame(6000).acceptedSeconds, 0); h.frame(6020);
  assert.equal(h.engine.state.flaps, 0); near(h.clock.activeSeconds, 0.06);
  window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); key('keydown', 'Space'); key('keyup', 'Space');
  assert.equal(h.frame(10000).acceptedSeconds, 0); h.frame(10020); assert.equal(h.engine.state.flaps, 1); near(h.clock.activeSeconds, 0.08);
});

test('native first-person consumes the posed eye on both bridge layers and returns by a verified intentional home cut', t => {
  const h = harness(t, { preset: 'under-bridge' }); h.frame(0); assert.equal(h.frame(20, 'first').status, 'committed');
  let snapshot = h.engine.snapshot(); near(snapshot.sole.y, -3.12); assert.ok(snapshot.camera.position[1] < -2.9);
  near(snapshot.camera.position[1], snapshot.posedEye.y);
  const time = h.engine.state.time; const source = h.engine.state.sourceId; const seq = h.engine.state.nextEventSequence;
  assert.equal(h.engine.home(), true); snapshot = h.engine.snapshot(); assert.equal(snapshot.camera.cut, true); near(snapshot.sole.y, 0);
  near(h.engine.state.time, time); assert.equal(h.engine.state.sourceId, source); assert.equal(h.engine.state.nextEventSequence, seq);
  assert.ok(snapshot.camera.position[1] > 0);
});

test('existing appearance changes preserve the sole, source time and sequence; a rejected new body is atomic', t => {
  const base = actualWorld(); let rejectLarge = false;
  const world = { ...base, sweepBody: (from, to, body) => rejectLarge && body.heightM > 0.3 ? undefined : base.sweepBody(from, to, body) };
  const h = harness(t, { world }); h.frame(0); h.frame(20);
  const before = h.engine.snapshot(); assert.equal(h.engine.selectLook('white'), true);
  assert.deepEqual(h.engine.snapshot().sole, before.sole); assert.equal(h.engine.state.nextEventSequence, before.state.nextEventSequence);
  rejectLarge = true; const white = h.engine.snapshot(); assert.equal(h.engine.selectLook('owl'), false); assert.deepEqual(h.engine.state, white.state); assert.equal(h.engine.look, 'white');
  rejectLarge = false; assert.equal(h.engine.selectLook('owl'), true);
  assert.deepEqual(h.engine.snapshot().sole, before.sole); near(h.engine.state.time, before.state.time);
  assert.equal(h.engine.state.sourceId, before.state.sourceId); assert.equal(h.engine.state.nextEventSequence, before.state.nextEventSequence);
  assert.ok(h.engine.state.body.heightM > 0.6); assert.deepEqual(h.engine.root.scale.toArray(), [1, 1, 1]);
});

test('focus loss during query validation invalidates the input and clock proposal together', t => {
  const base = actualWorld(); let interrupt = false;
  const world = { ...base, sphereClear: (...args) => { if (interrupt) { interrupt = false; window.dispatchEvent(new Event('blur')); } return base.sphereClear(...args); } };
  const h = harness(t, { world }); h.frame(0); h.frame(20); const before = { ...h.engine.state };
  key('keydown', 'Space'); interrupt = true; const tick = h.frame(40);
  assert.equal(tick.status, 'blocked'); assert.equal(tick.reason, 'stale-proposal'); assert.deepEqual(h.engine.state, before);
  near(h.clock.activeSeconds, 0.02); assert.equal(h.clock.gate.focused, false); assert.equal(h.controls.preview().input.flapPressed, false);
});

test('actual native eye and near volume resolve in desktop, portrait and landscape without raising the eye', () => {
  for (const preset of ['plaza', 'under-bridge']) {
    const engine = createNativeScene(new THREE.Scene(), 'pigeon', { preset, quality: 'mobile' });
    try {
      for (const aspect of [1280 / 720, 390 / 844, 844 / 390]) {
        const projection = { near: nativeNear(engine.state.body, 59, aspect), verticalFovDegrees: 59, aspect };
        const stage = engine.prepare({ forward: 0, turn: 0, flapPressed: false, flapHeld: false, descend: false }, 1 / 60, projection, 'first', 10, false);
        assert.equal(stage.kind, 'ready'); stage.commit();
        const snapshot = engine.snapshot(); near(snapshot.camera.position[1], snapshot.posedEye.y);
        assert.ok(projection.near > 0.001 && projection.near <= 0.12);
      }
    } finally { engine.dispose(); }
  }
});

test('native close focus keeps a verified wall contact reversible without changing eye height or body size', t => {
  const h = harness(t, { preset: 'wall' }); h.frame(0);
  const body = { ...h.engine.state.body };
  key('keydown', 'KeyW');
  for (let i = 0; i < 180; i++) assert.equal(h.step().status, 'committed');
  key('keyup', 'KeyW');
  const contactZ = h.engine.state.z;
  assert.ok(contactZ > -179.5);
  assert.equal(h.engine.queries.sweepBody(h.engine.state, h.engine.state, h.engine.state.body), null);
  key('keydown', 'KeyS');
  for (let i = 0; i < 75; i++) assert.equal(h.step().status, 'committed');
  key('keyup', 'KeyS');
  assert.ok(h.engine.state.z < contactZ - 0.7);
  assert.deepEqual(h.engine.state.body, body);
  const snapshot = h.engine.snapshot();
  const nativeProjection = { ...projection, near: nativeNear(body, projection.verticalFovDegrees, projection.aspect) };
  const lensRadius = nativeProjection.near * Math.hypot(1, Math.tan(59 * Math.PI / 360), Math.tan(59 * Math.PI / 360) * projection.aspect);
  assert.equal(h.engine.queries.sphereClear({ x: snapshot.camera.position[0], y: snapshot.camera.position[1], z: snapshot.camera.position[2] }, lensRadius + 0.001), true);
  near(h.clock.activeSeconds, h.engine.state.time);
});

test('real tap and descent settle on the precise roof ridge and retain support after inertia stops', t => {
  const h = harness(t, { preset: 'roof' }); h.frame(0); h.step();
  key('keydown', 'Space'); h.step(); key('keyup', 'Space'); key('keydown', 'ShiftLeft');
  for (let i = 0; i < 180; i++) assert.equal(h.step().status, 'committed');
  key('keyup', 'ShiftLeft');
  const s = h.engine.snapshot();
  assert.equal(s.state.grounded, true); assert.equal(s.state.mode, 'rest');
  assert.equal(s.state.support.id, 'gate:upper-roof'); near(s.sole.y, 20);
  assert.equal(h.engine.queries.sweepBody(s.state, s.state, s.body), null);
  const lands = s.recentEvents.filter(event => event.type === 'land');
  assert.equal(lands.length, 1); assert.equal(lands[0].surface, 'roof-tile'); near(lands[0].position.y, 20);
});

test('appearance changes validate the new native lens before committing a larger bird', t => {
  const base=actualWorld(); let rejectLargeLens=false;
  const world={ ...base, sphereClear: (point,radius) => rejectLargeLens && radius > 0.08 ? undefined : base.sphereClear(point,radius) };
  const h=harness(t,{world}); h.frame(0); h.step();
  const before=h.engine.snapshot(); const beforePose=pose(h.engine);
  rejectLargeLens=true;
  assert.equal(h.engine.selectLook('owl'),false);
  assert.deepEqual(h.engine.state,before.state); assert.equal(h.engine.look,before.look);
  assert.deepEqual(h.engine.snapshot().camera,before.camera); assert.deepEqual(pose(h.engine),beforePose);
  rejectLargeLens=false; assert.equal(h.engine.selectLook('owl'),true);
  assert.equal(h.engine.look,'owl'); near(h.engine.state.time,before.state.time);
});
