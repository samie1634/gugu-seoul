import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controls, applyControlsGate, sampleControlsFrame } from '../src/input.ts';
import { createFrameClock } from '../src/frame-clock.ts';
import { advanceBird, createBirdState } from '../src/simulation.ts';
import { addPlayTime, freshProgress, loadProgress, saveProgress } from '../src/progress.ts';

class FakeElement extends EventTarget {
  style = { transform: '', removeProperty() { this.transform = ''; } };
  captured = new Set();
  failCapture = new Set();
  dialog = false;
  querySelector() { this.thumb ??= new FakeElement(); return this.thumb; }
  closest() { return this.dialog ? this : null; }
  setPointerCapture(id) { if (this.failCapture.has(id)) throw Error('NotFoundError'); this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) {
    this.captured.delete(id);
    const event = new Event('lostpointercapture'); Object.assign(event, { pointerId: id }); this.dispatchEvent(event);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 122, height: 122 }; }
}
function setup() {
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget(); document.querySelector = () => new FakeElement();
  document.hidden = false; document.focused = true; document.hasFocus = () => document.focused;
  globalThis.Element = FakeElement;
  const joystick = new FakeElement(); const flap = new FakeElement(); const descend = new FakeElement();
  const controls = new Controls(joystick, flap, descend); controls.enabled = true;
  return { controls, joystick, flap, descend };
}
function key(type, code, repeat = false, fromDialog = false) {
  const event = new Event(type, { cancelable: true }); Object.assign(event, { code, repeat });
  if (fromDialog) { const dialog = new FakeElement(); dialog.dialog = true; Object.defineProperty(event, 'target', { value: dialog }); }
  window.dispatchEvent(event); return event;
}
function pointer(element, type, id, x = 61, y = 61) {
  const event = new Event(type, { cancelable: true }); Object.assign(event, { pointerId: id, clientX: x, clientY: y }); element.dispatchEvent(event);
}

test('space key repeat holds the wing but never queues repeated flap impulses', () => {
  const { controls } = setup(); key('keydown', 'Space');
  assert.equal(controls.sample().flapPressed, true);
  for (let i = 0; i < 20; i += 1) { key('keydown', 'Space', true); const input = controls.sample(); assert.equal(input.flapPressed, false); assert.equal(input.flapHeld, true); }
  key('keyup', 'Space'); assert.equal(controls.sample().flapHeld, false);
  key('keydown', 'Space'); assert.equal(controls.sample().flapPressed, true);
});

test('blur and hidden-tab events release all keys and ignore orphan repeats', () => {
  const { controls } = setup(); key('keydown', 'Space'); key('keydown', 'KeyW'); controls.sample();
  window.dispatchEvent(new Event('blur'));
  assert.equal(controls.sample().flapHeld, false); assert.equal(controls.sample().forward, 0);
  key('keydown', 'Space', true); assert.equal(controls.sample().flapHeld, false); assert.equal(controls.sample().flapPressed, false);
  key('keydown', 'Space'); document.dispatchEvent(new Event('visibilitychange')); assert.equal(controls.sample().flapHeld, false);
});

test('touch supports simultaneous steering and flight; cancel and reset release captures', () => {
  const { controls, joystick, flap, descend } = setup();
  pointer(joystick, 'pointerdown', 1, 80, 20); pointer(flap, 'pointerdown', 2);
  const input = controls.sample(); assert.ok(input.forward > 0.5); assert.ok(input.turn > 0); assert.equal(input.flapPressed, true); assert.equal(input.flapHeld, true);
  pointer(flap, 'pointercancel', 2); assert.equal(controls.sample().flapHeld, false);
  pointer(descend, 'pointerdown', 3); assert.equal(controls.sample().descend, true);
  controls.reset(); assert.equal(controls.sample().forward, 0); assert.equal(controls.sample().descend, false); assert.equal(joystick.captured.size, 0);
  pointer(joystick, 'pointerdown', 4, 61, 20); assert.ok(controls.sample().forward > 0.5);
});

test('paused controls cannot move or queue a flap', () => {
  const { controls, flap } = setup(); controls.enabled = false;
  key('keydown', 'Space'); pointer(flap, 'pointerdown', 1);
  assert.equal(controls.sample().flapPressed, false); assert.equal(controls.sample().flapHeld, false);
});

test('DOM adapter combines two flap pointers and Space without duplicate impulses or premature release', () => {
  const { controls, flap } = setup();
  pointer(flap, 'pointerdown', 11); pointer(flap, 'pointerdown', 12); key('keydown', 'Space');
  assert.equal(controls.sample().flapPressed, true);
  pointer(flap, 'pointerup', 11);
  assert.equal(controls.sample().flapHeld, true); assert.equal(controls.sample().flapPressed, false);
  assert.deepEqual([...flap.captured], [12]);
  pointer(flap, 'pointercancel', 12);
  assert.equal(controls.sample().flapHeld, true); assert.equal(controls.sample().flapPressed, false);
  key('keyup', 'Space'); assert.equal(controls.sample().flapHeld, false);
  pointer(flap, 'pointerdown', 13); pointer(flap, 'pointerup', 13);
  const tap = controls.sample(); assert.equal(tap.flapPressed, true); assert.equal(tap.flapHeld, false);
  assert.equal(controls.sample().flapPressed, false);
});

test('cancelling one pending flap transfers its edge only to a surviving owner', () => {
  const { controls, flap } = setup();
  pointer(flap, 'pointerdown', 1); pointer(flap, 'pointerdown', 2); pointer(flap, 'pointercancel', 1);
  assert.equal(controls.sample().flapPressed, true); assert.equal(controls.sample().flapHeld, true);
  pointer(flap, 'lostpointercapture', 2); assert.equal(controls.sample().flapHeld, false);
  pointer(flap, 'pointerdown', 3); pointer(flap, 'pointercancel', 3);
  assert.equal(controls.sample().flapPressed, false);
  pointer(flap, 'pointerdown', 4); key('keydown', 'Space'); pointer(flap, 'pointercancel', 4);
  assert.equal(controls.sample().flapPressed, true); assert.equal(controls.sample().flapHeld, true);
});

test('failed native capture cancels just that pointer and cannot leave an unconsumed ghost tap', () => {
  const { controls, joystick, flap, descend } = setup();
  flap.failCapture.add(7); pointer(flap, 'pointerdown', 7);
  assert.equal(controls.sample().flapPressed, false); assert.equal(controls.sample().flapHeld, false);
  pointer(flap, 'pointerdown', 8); assert.equal(controls.sample().flapPressed, true);
  flap.failCapture.add(9); pointer(flap, 'pointerdown', 9);
  assert.equal(controls.sample().flapPressed, false); assert.equal(controls.sample().flapHeld, true);
  joystick.failCapture.add(10); pointer(joystick, 'pointerdown', 10, 61, 20);
  assert.equal(controls.sample().forward, 0); assert.equal(joystick.thumb.style.transform, '');
  pointer(joystick, 'pointerdown', 11, 61, 20); pointer(descend, 'pointerdown', 12);
  assert.ok(controls.sample().forward > 0.5); assert.equal(controls.sample().descend, true);
  controls.reset();
  assert.equal(joystick.captured.size + flap.captured.size + descend.captured.size, 0);
  assert.equal(controls.sample().flapHeld, false);
});

test('steering and multiple descend pointers keep independent ownership', () => {
  const { controls, joystick, flap, descend } = setup();
  pointer(joystick, 'pointerdown', 1, 80, 20); pointer(joystick, 'pointerdown', 2, 20, 100);
  pointer(descend, 'pointerdown', 3); pointer(descend, 'pointerdown', 4); pointer(flap, 'pointerdown', 5);
  assert.deepEqual([...joystick.captured], [1]); assert.ok(controls.sample().forward > 0.5);
  pointer(descend, 'pointercancel', 3); assert.equal(controls.sample().descend, true);
  pointer(joystick, 'lostpointercapture', 1);
  assert.equal(controls.sample().forward, 0); assert.equal(controls.sample().descend, true); assert.equal(controls.sample().flapHeld, true);
  pointer(descend, 'pointerup', 4); assert.equal(controls.sample().descend, false);
  pointer(joystick, 'pointerdown', 6, 61, 20); assert.ok(controls.sample().forward > 0.5);
});

const activeGate = { enabled: true, focused: true, hidden: false, paused: false, dialogOpen: false };

function runningGame(activeSeconds = 0) {
  const dom = setup(); let gate = { ...activeGate }; let clock = createFrameClock(gate);
  const bird = createBirdState(); const progress = { ...freshProgress(), activeSeconds, muted: true };
  let worldSeconds = 0;
  const apply = changes => { gate = { ...gate, ...changes }; clock = applyControlsGate(dom.controls, clock, gate); };
  const frame = timestamp => {
    const tick = sampleControlsFrame(dom.controls, clock, timestamp); clock = tick.clock;
    if (tick.input) {
      advanceBird(bird, tick.input, tick.acceptedSeconds, []);
      addPlayTime(progress, tick.acceptedSeconds, true); worldSeconds += tick.acceptedSeconds;
    }
    return tick;
  };
  window.addEventListener('blur', () => apply({ focused: false }));
  window.addEventListener('focus', () => apply({ focused: true }));
  document.addEventListener('visibilitychange', () => apply({ hidden: document.hidden }));
  return { ...dom, bird, progress, apply, frame, get clock() { return clock; }, get worldSeconds() { return worldSeconds; } };
}

test('modal commands commit their input state before synchronous gate and fresh-input changes', () => {
  const game = runningGame(); let pauses = 0; let coos = 0; let views = 0; let open = false;
  game.controls.onCoo = () => coos++; game.controls.onView = () => views++;
  game.controls.onPause = () => {
    pauses++; open = !open; game.apply({ dialogOpen: open });
    if (!open) { key('keydown', 'Space'); key('keyup', 'Space'); }
  };
  pointer(game.flap, 'pointerdown', 1); key('keydown', 'KeyW');
  assert.equal(key('keydown', 'Escape').defaultPrevented, true);
  assert.equal(pauses, 1); assert.equal(game.flap.captured.size, 0); assert.equal(game.controls.sample().forward, 0);
  key('keydown', 'Escape', true); key('keydown', 'Escape');
  key('keydown', 'Space', false, true); key('keydown', 'KeyC', false, true); key('keydown', 'KeyV', false, true);
  assert.equal(pauses, 1); assert.equal(coos + views, 0);
  key('keyup', 'Escape'); key('keydown', 'Escape', false, true);
  assert.equal(pauses, 2); assert.equal(game.controls.sample().flapPressed, true);
  assert.equal(game.controls.sample().flapPressed, false);
  key('keydown', 'KeyC'); key('keydown', 'KeyC'); key('keydown', 'KeyV'); key('keydown', 'KeyV', true);
  assert.equal(coos, 1); assert.equal(views, 1);
});

test('the production frame sampler preserves a fresh DOM tap across zero-dt start and resume frames', () => {
  const game = runningGame();
  key('keydown', 'Space'); key('keyup', 'Space');
  assert.equal(game.frame(0).input, null); assert.equal(game.frame(0).input, null); assert.equal(game.bird.flaps, 0);
  assert.equal(game.frame(17).input.flapPressed, true); game.frame(34); assert.equal(game.bird.flaps, 1);
  key('keydown', 'Space'); key('keyup', 'Space'); window.dispatchEvent(new Event('blur'));
  game.frame(5000); window.dispatchEvent(new Event('focus'));
  assert.equal(game.frame(6000).input, null); game.frame(6017); assert.equal(game.bird.flaps, 1);
  window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus'));
  key('keydown', 'Space'); key('keyup', 'Space');
  assert.equal(game.frame(9000).input, null); game.frame(9017); game.frame(9034);
  assert.equal(game.bird.flaps, 2);
});

test('all lifecycle gates discard captures, reject fresh inactive keys, and restart without elapsed-time jumps', () => {
  for (const reason of [{ focused: false }, { hidden: true }, { dialogOpen: true }, { paused: true }, { enabled: false }]) {
    const game = runningGame(); game.frame(0); game.frame(20);
    pointer(game.flap, 'pointerdown', 1); pointer(game.descend, 'pointerdown', 2); pointer(game.joystick, 'pointerdown', 3, 61, 20);
    game.apply(reason); key('keydown', 'Space'); key('keydown', 'KeyW');
    const before = JSON.stringify(game.bird); const seconds = game.progress.activeSeconds;
    assert.equal(game.frame(5000).input, null); assert.equal(JSON.stringify(game.bird), before); assert.equal(game.progress.activeSeconds, seconds);
    assert.equal(game.flap.captured.size + game.descend.captured.size + game.joystick.captured.size, 0);
    game.apply(activeGate); assert.equal(game.frame(6000).input, null);
    const resumed = game.frame(6020); assert.equal(resumed.input.flapPressed, false); assert.equal(resumed.input.flapHeld, false); assert.equal(resumed.input.forward, 0);
    assert.ok(Math.abs(game.progress.activeSeconds - seconds - 0.02) < 1e-12);
  }
});

test('visible blur/focus between RAFs breaks the clock chain and shares only accepted time with legacy physics and storage', () => {
  const game = runningGame(100); const beforeAge = game.bird.flapAge;
  assert.equal(game.frame(0).acceptedSeconds, 0); assert.equal(game.frame(20).acceptedSeconds, 0.02);
  const stalled = game.frame(5020); assert.equal(stalled.rawSeconds, 0.25); assert.equal(stalled.acceptedSeconds, 0.1);
  window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus'));
  assert.equal(game.frame(15020).acceptedSeconds, 0); assert.equal(game.frame(15040).acceptedSeconds, 0.02);
  assert.ok(Math.abs(game.clock.activeSeconds - 0.14) < 1e-12);
  assert.equal(game.worldSeconds, game.clock.activeSeconds);
  assert.ok(Math.abs(game.bird.flapAge - beforeAge - game.worldSeconds) < 1e-12);
  assert.ok(Math.abs(game.progress.activeSeconds - 100 - game.worldSeconds) < 1e-12);
  let value; const storage = { setItem(_key, text) { value = text; }, getItem() { return value; } };
  saveProgress(storage, game.progress); assert.deepEqual(loadProgress(storage), game.progress); assert.equal(loadProgress(storage).version, 1);
});

test('source input keeps original hold-to-glide behavior with one flap per aggregate press', () => {
  const game = runningGame(); key('keydown', 'Space'); pointer(game.flap, 'pointerdown', 1); pointer(game.flap, 'pointerdown', 2);
  game.frame(0);
  for (let timestamp = 17; timestamp <= 510; timestamp += 17) { key('keydown', 'Space', true); game.frame(timestamp); }
  assert.equal(game.bird.flaps, 1); assert.equal(game.bird.mode, 'glide');
  key('keyup', 'Space'); pointer(game.flap, 'pointercancel', 1); game.frame(527); assert.equal(game.bird.mode, 'glide');
  pointer(game.flap, 'pointerup', 2); assert.equal(game.frame(544).input.flapHeld, false);
});
