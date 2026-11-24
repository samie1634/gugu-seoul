import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pigeonHeadCycle } from '../src/native/ported/birds/rig-core/pose.ts';

test('pigeon head holds back then returns forward once per walking stride', () => {
  assert.equal(pigeonHeadCycle(0), 0);
  assert.ok(pigeonHeadCycle(0.5) > 0.7);
  assert.ok(pigeonHeadCycle(0.995) < 0.01);
});
