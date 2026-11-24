import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeMotionState, advanceNativeMotion } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';

test('C descends three times the prior acceleration while keeping horizontal momentum and ignoring flap', () => {
  let state = createNativeMotionState({ feet: { x: 0, y: 100, z: 0 } });
  state.grounded = false; state.mode = 'fall'; state.vx = 2; state.vz = -3;
  const world = { supportAt: () => null, sweepBody: () => null };
  const input = { forward: 0, turn: 0, flapPressed: true, flapHeld: true, descend: true };
  const out = advanceNativeMotion(state, input, 0.1, world);
  assert.equal(out.status, 'advanced');
  assert.ok(Math.abs(out.state.vy + 8.82) < 1e-8);
  assert.equal(out.state.vx, 2); assert.equal(out.state.vz, -3);
  assert.equal(out.state.mode, 'fall');
  assert.equal(out.events.some(event => event.type === 'flap'), false);
  let current=out.state;
  for(let i=0;i<9;i++) current=advanceNativeMotion(current,{...input,flapPressed:false},0.1,world).state;
  assert.ok(Math.abs(current.vy+88.2)<1e-7);
});
