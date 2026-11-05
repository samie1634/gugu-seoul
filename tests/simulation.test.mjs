import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceBird, createBirdState, emptyInput, BODY_RADIUS, GLIDE_DELAY, MAX_ALTITUDE, BOUNDS } from '../src/simulation.ts';

function run(bird, input, seconds, obstacles = [], hz = 90) {
  for (let i = 0; i < Math.round(seconds * hz); i += 1) advanceBird(bird, { ...input, flapPressed: input.flapPressed && i === 0 }, 1 / hz, obstacles);
}

test('a tap produces one upward impulse and an eventual soft landing', () => {
  const bird = createBirdState();
  advanceBird(bird, { ...emptyInput(), flapPressed: true }, 1 / 60, []);
  assert.ok(bird.y > BODY_RADIUS); assert.ok(bird.vy > 8); assert.equal(bird.flaps, 1);
  run(bird, emptyInput(), 3);
  assert.equal(bird.grounded, true); assert.equal(bird.y, BODY_RADIUS); assert.equal(bird.vy, 0);
});

test('holding becomes glide after a delay, without repeated ascent', () => {
  const bird = createBirdState(); bird.y = 40; bird.grounded = false;
  const input = { ...emptyInput(), flapPressed: true, flapHeld: true };
  run(bird, input, GLIDE_DELAY / 2);
  assert.equal(bird.mode, 'flap');
  run(bird, { ...input, flapPressed: false }, 4);
  assert.equal(bird.flaps, 1); assert.equal(bird.mode, 'glide');
  assert.ok(bird.vy < 0 && bird.vy > -2); assert.ok(bird.y < 44);
});

test('separate wing beats gain height, while a held key cannot do so indefinitely', () => {
  const bird = createBirdState();
  for (let i = 0; i < 8; i += 1) run(bird, { ...emptyInput(), flapPressed: true }, 0.25);
  assert.ok(bird.y > 15); assert.equal(bird.flaps, 8);
});

test('walking, turning, wall collision and backwards motion remain on the floor', () => {
  const bird = createBirdState();
  const wall = { x: -37, z: -5, width: 15, depth: 4, height: 12 };
  run(bird, { ...emptyInput(), forward: 1 }, 5, [wall]);
  assert.ok(bird.z >= -3 + BODY_RADIUS - 0.001); assert.equal(bird.y, BODY_RADIUS);
  const z = bird.z;
  run(bird, { ...emptyInput(), forward: -1 }, 1, [wall]); assert.ok(bird.z > z);
  run(bird, { ...emptyInput(), turn: 1 }, 0.5, [wall]); assert.ok(bird.heading > 0.8);
});

test('a descending bird can perch on a roof and take off again', () => {
  const bird = createBirdState(); bird.y = 15; bird.grounded = false;
  const roof = { x: -37, z: -10, width: 100, depth: 150, height: 8 };
  run(bird, { ...emptyInput(), descend: true }, 1.2, [roof]);
  assert.equal(bird.grounded, true); assert.equal(bird.y, 8 + BODY_RADIUS);
  advanceBird(bird, { ...emptyInput(), flapPressed: true }, 1 / 60, [roof]);
  assert.equal(bird.grounded, false); assert.ok(bird.y > 8 + BODY_RADIUS);
});

test('gate passages permit walking underneath a floating roof, but stop upward passage', () => {
  const roof = { x: -37, z: -10, width: 100, depth: 150, minY: 3, height: 5 };
  const bird = createBirdState();
  run(bird, { ...emptyInput(), forward: 1 }, 1, [roof]); assert.ok(bird.z < 4); assert.equal(bird.grounded, true);
  run(bird, { ...emptyInput(), flapPressed: true }, 0.25, [roof]);
  assert.ok(bird.y + BODY_RADIUS <= 3 + 0.001);
});

test('ceiling, world bounds and long stalled frames cannot escape the playable area', () => {
  const bird = createBirdState(); bird.y = MAX_ALTITUDE - 0.02; bird.grounded = false; bird.vy = 16;
  bird.x = BOUNDS.maxX; bird.heading = Math.PI / 2;
  advanceBird(bird, { ...emptyInput(), flapPressed: true }, 30, []);
  assert.ok(bird.y <= MAX_ALTITUDE); assert.ok(bird.x <= BOUNDS.maxX);
  assert.ok(Math.abs(bird.z - 8) < 2);
});

test('60 Hz and 120 Hz produce comparable flight paths', () => {
  const a = createBirdState(); const b = createBirdState(); a.y = b.y = 50; a.grounded = b.grounded = false;
  const input = { ...emptyInput(), flapHeld: true, turn: 0.2 };
  run(a, input, 3, [], 60); run(b, input, 3, [], 120);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.35);
});
