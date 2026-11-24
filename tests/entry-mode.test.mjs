import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useIntegratedScene } from '../src/entry-mode.ts';

test('default and existing QA URLs enter the integrated scene', () => {
  for (const query of ['', '?native=b2', '?native=b2&native-preset=river']) {
    assert.equal(useIntegratedScene(new URLSearchParams(query)), true);
  }
});

test('legacy mode is available only when explicitly requested', () => {
  assert.equal(useIntegratedScene(new URLSearchParams('?native=legacy')), false);
  assert.equal(useIntegratedScene(new URLSearchParams('?other=legacy')), true);
});
