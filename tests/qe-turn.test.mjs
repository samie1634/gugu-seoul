import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputState, reduceInput, sampleInput } from '../src/input-reducer.ts';

const playing = { enabled: true, focused: true, hidden: false, paused: false, dialogOpen: false };
const press = (state, code) => reduceInput(state, { type: 'key-down', code, repeat: false }).state;
test('Q and E roll in opposite directions without turning and stop on release', () => {
  for (const [code, expected] of [['KeyQ', 1], ['KeyE', -1]]) {
    let state = press(createInputState(playing), code);
    assert.equal(sampleInput(state).input.roll, expected);
    assert.equal(sampleInput(state).input.turn, 0);
    state = reduceInput(state, { type: 'key-up', code }).state;
    assert.equal(sampleInput(state).input.roll, 0);
  }
});
test('opposite rotation keys cancel and lifecycle reset stops rotation', () => {
  let state = press(press(createInputState(playing), 'KeyQ'), 'KeyE');
  assert.equal(sampleInput(state).input.roll, 0);
  state = reduceInput(state, { type: 'reset' }).state;
  assert.equal(sampleInput(state).input.roll, 0);
});

test('R triggers one peck, not coo or turn, and ignores repeats', () => {
  const state = createInputState(playing);
  const down = reduceInput(state, { type: 'key-down', code: 'KeyR', repeat: false });
  assert.equal(down.command, 'peck');
  assert.equal(sampleInput(down.state).input.turn, 0);
  assert.equal(reduceInput(down.state, { type: 'key-down', code: 'KeyR', repeat: true }).command, null);
});
