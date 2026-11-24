import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMERA_ORBIT_LIMIT, CameraOrbitControls, orbitViewDirection, birdOrbitPosition } from '../src/camera-orbit.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { nativeNear } from '../src/native/body-profile.ts';
import { resolveCamera, cameraNearRadius } from '../src/native/ported/motion/controls/camera-resolver.ts';
import { resolveNativeCamera } from '../src/native/ported/motion/controls/b2/native-camera.ts';

class Canvas extends EventTarget {
  captured = new Set();
  failCapture = false;
  setPointerCapture(id) { if (this.failCapture) throw Error('capture failed'); this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) {
    this.captured.delete(id);
    pointer(this, 'lostpointercapture', { pointerId: id });
  }
}

function pointer(canvas, type, fields = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, clientX: 400, clientY: 400, button: 0, buttons: 1, pointerType: 'mouse', ...fields });
  canvas.dispatchEvent(event);
  return event;
}

function setup(pitch = 0) {
  const canvas = new Canvas();
  const controls = new CameraOrbitControls(canvas, () => pitch);
  controls.setEnabled(true);
  return { canvas, controls };
}

function elevation(direction) { return Math.atan2(direction[1], Math.hypot(direction[0], direction[2])); }
function near(a, b, message) { assert.ok(Math.abs(a - b) < 1e-9, message ?? `${a} != ${b}`); }

const world = { sphereClear: () => true, sweepSphere: () => null };
const metrics = {
  body: { centreToSoleM: .1, eyeFromSoleM: { x: 0, y: .25, z: -.03 } },
  chaseTargetOffset: [0, .15, 0], chaseGroundOffset: [0, .8, 3], chaseAirOffset: [0, 1.2, 4],
};
const projection = { near: .01, verticalFovDegrees: 59, aspect: 16 / 9 };
const point = ([x, y, z]) => ({ x, y, z });
const vector = (a, b) => a.map((value, i) => value - b[i]);
const distance = (a, b) => Math.hypot(...vector(a, b));
const forwardOf = result => vector(result.lookAt, result.position);
function request(grounded = true, mode = 'third', heading = 0) {
  return { bird: { x: 0, y: grounded ? .1 : 8, z: 0, heading, grounded, vy: grounded ? 0 : -8 },
    mode, world, metrics, projection, acceptedSeconds: 1 / 60 };
}

test('third-person drag moves the camera around the bird rather than rotating the view in place', () => {
  const base = resolveNativeCamera(request());
  assert.equal(base.kind, 'resolved');
  const radius = distance(base.position, base.lookAt);
  for (const yaw of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const result = resolveNativeCamera({ ...request(), orbit: { yaw, pitch: null } });
    assert.equal(result.kind, 'resolved');
    assert.deepEqual(result.lookAt, base.lookAt, 'the bird is the fixed orbit centre');
    assert.ok(distance(result.position, base.position) > 3, 'the camera physically travels around the bird');
    near(distance(result.position, result.lookAt), radius);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(...result.position); camera.lookAt(...result.lookAt); camera.updateMatrixWorld(true);
    const centreOnScreen = new THREE.Vector3(...result.lookAt).project(camera);
    near(centreOnScreen.x, 0); near(centreOnScreen.y, 0);
  }
});

test('up/down orbit follows sky/ground at every heading in grounded/flying first/third person', () => {
  for (const grounded of [true, false]) for (const mode of ['first', 'third']) {
    for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2 + .4]) {
      const req = request(grounded, mode, heading);
      const base = resolveNativeCamera(req); assert.equal(base.kind, 'resolved');
      const { controls, canvas } = setup(elevation(forwardOf(base)));
      pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientY: 100 });
      const up = resolveNativeCamera({ ...req, orbit: controls.angles });
      assert.equal(up.kind, 'resolved');
      assert.ok(elevation(forwardOf(up)) > 1.1, `${mode} / grounded=${grounded} / heading=${heading}: up`);
      pointer(canvas, 'pointermove', { clientY: 700 });
      const down = resolveNativeCamera({ ...req, orbit: controls.angles });
      assert.equal(down.kind, 'resolved');
      assert.ok(elevation(forwardOf(down)) < -1.1, `${mode} / grounded=${grounded} / heading=${heading}: down`);
      if (mode === 'third') {
        assert.deepEqual(up.lookAt, base.lookAt); assert.deepEqual(down.lookAt, base.lookAt);
        assert.ok(up.position[1] < base.position[1], 'looking up lowers the orbiting camera');
        assert.ok(down.position[1] > base.position[1], 'looking down raises the orbiting camera');
        near(distance(up.position, up.lookAt), distance(base.position, base.lookAt));
      } else {
        assert.deepEqual(up.position, base.position, 'first person remains at the eyes');
        assert.deepEqual(down.position, base.position);
      }
      assert.deepEqual(up.up, [0, 1, 0]); assert.deepEqual(down.up, [0, 1, 0]);
    }
  }
});

test('left/right uses the same local viewing direction at all headings and any vertical angle', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const pitch of [-1.4, 0, 1.4]) {
    const { controls, canvas } = setup(pitch);
    const forward = [Math.sin(heading), 0, -Math.cos(heading)];
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientX: 500 });
    const right = orbitViewDirection(forward, controls.angles);
    assert.ok(right[0] * Math.cos(heading) + right[2] * Math.sin(heading) > 0);
    near(elevation(right), pitch);
    pointer(canvas, 'pointermove', { clientX: 300 });
    const left = orbitViewDirection(forward, controls.angles);
    assert.ok(left[0] * Math.cos(heading) + left[2] * Math.sin(heading) < 0);
    near(elevation(left), pitch);
  }
});

test('absolute look elevation survives heading, base-pitch, flight and view changes', () => {
  const { controls, canvas } = setup(-.2);
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientY: 250 });
  pointer(canvas, 'pointerup');
  for (const forward of [[0, -.4, -1], [1, 0, 0], [0, .3, 1], [-1, -1, .1]]) {
    near(elevation(orbitViewDirection(forward, controls.angles)), .55);
  }
  controls.cancel(); // Switching view cancels ownership without reversing the view.
  pointer(canvas, 'pointermove', { clientY: 100 }); near(controls.angles.pitch, .55);
  pointer(canvas, 'pointerdown', { clientY: 100 });
  pointer(canvas, 'pointermove', { clientY: 150 }); near(controls.angles.pitch, .3);
});

test('pitch limits respond immediately to reversal and do not accumulate hidden overshoot', () => {
  const { controls, canvas } = setup();
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientY: -10000 });
  near(controls.angles.pitch, CAMERA_ORBIT_LIMIT);
  pointer(canvas, 'pointermove', { clientY: -9990 }); near(controls.angles.pitch, CAMERA_ORBIT_LIMIT - .05);
  pointer(canvas, 'pointermove', { clientY: 10000 }); near(controls.angles.pitch, -CAMERA_ORBIT_LIMIT);
  pointer(canvas, 'pointermove', { clientY: 9990 }); near(controls.angles.pitch, -CAMERA_ORBIT_LIMIT + .05);
});

test('mouse, touch and pen use identical movement and only the first canvas pointer owns the drag', () => {
  for (const pointerType of ['mouse', 'touch', 'pen']) {
    const { controls, canvas } = setup();
    pointer(canvas, 'pointerdown', { pointerType });
    pointer(canvas, 'pointerdown', { pointerId: 2, clientY: 700, pointerType });
    pointer(canvas, 'pointermove', { pointerId: 2, clientY: 200, pointerType });
    assert.deepEqual(controls.angles, { yaw: 0, pitch: null });
    pointer(canvas, 'pointerup', { pointerId: 2, pointerType });
    pointer(canvas, 'pointermove', { clientY: 300, pointerType }); near(controls.angles.pitch, .5);
    assert.deepEqual([...canvas.captured], [1]);
    pointer(canvas, 'pointerup', { pointerType }); assert.equal(canvas.captured.size, 0);
    pointer(canvas, 'pointermove', { clientY: 100, pointerType }); near(controls.angles.pitch, .5);
  }
});

for (const terminal of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  test(`${terminal} releases drag ownership and permits a fresh gesture without a jump`, () => {
    const { controls, canvas } = setup();
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientY: 300 });
    pointer(canvas, terminal); assert.equal(canvas.captured.size, 0);
    pointer(canvas, 'pointermove', { clientY: 100 }); near(controls.angles.pitch, .5);
    pointer(canvas, 'pointerdown', { pointerId: 2, clientY: 800 });
    pointer(canvas, 'pointermove', { pointerId: 2, clientY: 820 }); near(controls.angles.pitch, .4);
  });
}

test('inactive/paused/dialog/blur/hidden gate releases capture and never revives the old gesture', () => {
  const { controls, canvas } = setup();
  for (let i = 0; i < 6; i++) {
    controls.reset();
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientY: 300 });
    controls.setEnabled(false); assert.equal(canvas.captured.size, 0);
    pointer(canvas, 'pointerdown', { pointerId: 2 }); pointer(canvas, 'pointermove', { clientY: 50 });
    near(controls.angles.pitch, .5);
    controls.setEnabled(true);
    pointer(canvas, 'pointermove', { clientY: 50 }); near(controls.angles.pitch, .5);
    pointer(canvas, 'pointerdown', { pointerId: 3, clientY: 100 });
    pointer(canvas, 'pointermove', { pointerId: 3, clientY: 120 }); near(controls.angles.pitch, .4);
  }
});

test('failed capture, secondary mouse buttons, malformed coordinates and missed mouse-up do not leave ghost drags', () => {
  const { controls, canvas } = setup();
  canvas.failCapture = true;
  assert.doesNotThrow(() => pointer(canvas, 'pointerdown'));
  pointer(canvas, 'pointermove', { clientY: 50 }); assert.equal(controls.angles.pitch, null);
  canvas.failCapture = false;
  pointer(canvas, 'pointerdown', { button: 2 }); pointer(canvas, 'pointermove', { clientY: 50 });
  assert.equal(controls.angles.pitch, null);
  pointer(canvas, 'pointerdown', { clientX: NaN }); assert.equal(canvas.captured.size, 0);
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientY: NaN });
  assert.equal(canvas.captured.size, 0); assert.equal(controls.angles.pitch, null);
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { buttons: 0, clientY: 50 });
  assert.equal(canvas.captured.size, 0); assert.equal(controls.angles.pitch, null);
});

test('no drag keeps the normal base view, clicks do not lock pitch, and home/reset clears manual look', () => {
  const { controls, canvas } = setup(-.2);
  const base = new THREE.Vector3(.3, -.2, -.8).normalize().toArray();
  const resolved = orbitViewDirection(base, controls.angles);
  resolved.forEach((value, i) => near(value, base[i]));
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove'); pointer(canvas, 'pointerup');
  assert.equal(controls.angles.pitch, null);
  pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', { clientX: 450, clientY: 200 });
  controls.reset(); assert.equal(canvas.captured.size, 0);
  assert.deepEqual(controls.angles, { yaw: 0, pitch: null });
});

test('orbit centre translates with the bird and no-input orbit preserves the original chase exactly', () => {
  const target = [10, 6, -12], normal = [10, 8, -8], move = [12, -4, 8];
  assert.deepEqual(birdOrbitPosition(target, normal, { yaw: 0, pitch: null }), normal);
  const orbit = { yaw: 1.2, pitch: -.4 };
  const position = birdOrbitPosition(target, normal, orbit);
  const shifted = birdOrbitPosition(target.map((v, i) => v + move[i]), normal.map((v, i) => v + move[i]), orbit);
  shifted.forEach((v, i) => near(v, position[i] + move[i]));
  near(distance(position, target), distance(normal, target));
});

function floorAndWall() {
  return {
    sphereClear(p, r) { return p.y > r - 1e-9 && p.x < 1.2 - r + 1e-9; },
    sweepSphere(from, to, r) {
      const hits = [];
      if (to.y <= r && to.y < from.y) hits.push({ fraction: (from.y - r) / (from.y - to.y), normal: { x: 0, y: 1, z: 0 }, colliderId: 'floor' });
      if (to.x >= 1.2 - r && to.x > from.x) hits.push({ fraction: (1.2 - r - from.x) / (to.x - from.x), normal: { x: -1, y: 0, z: 0 }, colliderId: 'wall' });
      const hit = hits.filter(h => h.fraction >= 0 && h.fraction <= 1).sort((a, b) => a.fraction - b.fraction)[0];
      return hit ? { ...hit, point: { x: from.x + (to.x - from.x) * hit.fraction, y: from.y + (to.y - from.y) * hit.fraction, z: from.z + (to.z - from.z) * hit.fraction } } : null;
    },
  };
}

test('orbit clips against ground/walls and every displayed motion chord remains collision-safe', () => {
  const world = floorAndWall(), radius = cameraNearRadius(projection) + .001;
  let current = resolveNativeCamera({ ...request(), world });
  assert.equal(current.kind, 'resolved');
  for (let i = 0; i < 240; i++) {
    const orbit = { yaw: i / 239 * Math.PI * 2, pitch: i < 120 ? .85 : -.7 };
    const result = resolveNativeCamera({ ...request(), world, previousPosition: current.position, orbit });
    assert.equal(result.kind, 'resolved'); assert.equal(result.cut, false);
    assert.equal(world.sphereClear(point(result.position), radius), true);
    assert.equal(world.sweepSphere(point(current.position), point(result.position), radius), null);
    assert.deepEqual(result.lookAt, [0, .25, 0]);
    current = result;
  }
  const sky = resolveNativeCamera({ ...request(), world, orbit: { yaw: 0, pitch: .85 } });
  assert.equal(sky.kind, 'resolved'); assert.ok(sky.position[1] > radius);
  assert.ok(elevation(forwardOf(sky)) > 0 && elevation(forwardOf(sky)) < .85, 'ground limits the angle instead of zooming');
  const normal = resolveNativeCamera({ ...request(), world });
  near(distance(sky.position, sky.lookAt), distance(normal.position, normal.lookAt));
});

test('invalid orbit or unavailable collision checks fail closed', () => {
  for (const orbit of [{ yaw: NaN, pitch: 0 }, { yaw: 0, pitch: Infinity }, { yaw: 0, pitch: Math.PI }, null]) {
    assert.deepEqual(resolveNativeCamera({ ...request(), orbit }), { kind: 'blocked', reason: 'invalid-view' });
  }
  const result = resolveNativeCamera({ ...request(), orbit: { yaw: 1, pitch: -.5 }, world: { ...world, sweepSphere: () => undefined } });
  assert.deepEqual(result, { kind: 'blocked', reason: 'invalid-query' });
});

test('legacy route uses the same bird-centred orbit and ground collision, not a view-only postprocess', () => {
  const bird = { ...request().bird, y: .7 };
  const base = resolveCamera({ bird, mode: 'third', obstacles: [], dt: 1 / 60 });
  assert.equal(base.kind, 'resolved');
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const pitch of [.8, -.8]) {
      const orbit = resolveCamera({ bird, mode: 'third', obstacles: [], dt: 1 / 60, orbit: { yaw, pitch } });
      assert.equal(orbit.kind, 'resolved');
      assert.deepEqual(orbit.lookAt, base.lookAt);
      if (pitch < 0) near(elevation(forwardOf(orbit)), pitch);
      else assert.ok(elevation(forwardOf(orbit)) >= elevation(forwardOf(base)) - 1e-9 && elevation(forwardOf(orbit)) < pitch);
      near(distance(orbit.position, orbit.lookAt), distance(base.position, base.lookAt));
      assert.ok(distance(orbit.position, base.position) > 1);
      assert.ok(orbit.position[1] > cameraNearRadius({ near: .12, verticalFovDegrees: 59, aspect: 16 / 9 }));
    }
  }
});

test('actual scene adopts the orbit atomically, keeps the bird centred, and preserves first-person eyes across view/appearance changes', () => {
  const engine = createNativeScene(new THREE.Scene(), 'pigeon', { preset: 'plaza', quality: 'mobile', sessionId: 'camera-orbit-test' });
  const projection = { near: nativeNear(engine.state.body, 59, 16 / 9), verticalFovDegrees: 59, aspect: 16 / 9 };
  const idle = { forward: 0, turn: 0, flapPressed: false, flapHeld: false, descend: false };
  const orbit = { yaw: Math.PI / 2, pitch: -.6 };
  const radius = cameraNearRadius(projection) + .001;
  try {
    const initial = engine.camera.position;
    for (let i = 0; i < 80; i++) {
      const before = engine.camera.position;
      const proposal = engine.prepare(idle, 1 / 60, projection, 'third', 10 + (i + 1) / 60, false, Infinity, orbit);
      assert.equal(proposal.kind, 'ready', proposal.reason); assert.deepEqual(engine.camera.position, before);
      proposal.commit();
      assert.equal(engine.queries.sphereClear(point(engine.camera.position), radius), true);
      assert.equal(engine.queries.sweepSphere(point(before), point(engine.camera.position), radius), null);
      near(engine.camera.lookAt[0], engine.state.x); near(engine.camera.lookAt[2], engine.state.z);
    }
    assert.ok(distance(initial, engine.camera.position) > .5, 'scene camera actually orbits');
    assert.ok(Math.abs(elevation(forwardOf(engine.camera)) + .6) < .001, 'smoothed orbit converges to requested view');
    const first = engine.prepare(idle, 1 / 60, projection, 'first', 12, false, Infinity, orbit);
    assert.equal(first.kind, 'ready', first.reason); first.commit();
    let snapshot = engine.snapshot();
    snapshot.camera.position.forEach((v, i) => near(v, Object.values(snapshot.posedEye)[i]));
    near(elevation(forwardOf(snapshot.camera)), orbit.pitch);
    assert.equal(engine.selectLook('white'), true);
    snapshot = engine.snapshot();
    snapshot.camera.position.forEach((v, i) => near(v, Object.values(snapshot.posedEye)[i]));
    near(elevation(forwardOf(snapshot.camera)), orbit.pitch);
    const third = engine.prepare(idle, 1 / 60, projection, 'third', 13, false, Infinity, orbit);
    assert.equal(third.kind, 'ready', third.reason); third.commit();
    near(engine.camera.lookAt[0], engine.state.x); near(engine.camera.lookAt[2], engine.state.z);
  } finally { engine.dispose(); }
});
