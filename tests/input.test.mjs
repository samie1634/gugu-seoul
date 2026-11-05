import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controls } from '../src/input.ts';

class FakeElement extends EventTarget {
  style = { transform: '', removeProperty() { this.transform = ''; } };
  captured = new Set();
  querySelector() { return new FakeElement(); }
  closest() { return null; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 122, height: 122 }; }
}
function setup() {
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget(); document.querySelector = () => new FakeElement();
  globalThis.Element = FakeElement;
  const joystick = new FakeElement(); const flap = new FakeElement(); const descend = new FakeElement();
  const controls = new Controls(joystick, flap, descend); controls.enabled = true;
  return { controls, joystick, flap, descend };
}
function key(type, code, repeat = false) { const event = new Event(type, { cancelable: true }); Object.assign(event, { code, repeat }); window.dispatchEvent(event); }
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
