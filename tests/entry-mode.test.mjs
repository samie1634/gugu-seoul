import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useIntegratedScene } from '../src/entry-mode.ts';

test('default and existing QA URLs enter the integrated scene', () => {
  for (const query of ['', '?native=b2', '?native=b2&native-preset=river']) {
    assert.equal(useIntegratedScene(new URLSearchParams(query)), true);
  }
});

test('old legacy selectors no longer activate the retired local model', () => {
  assert.equal(useIntegratedScene(new URLSearchParams('?native=legacy')), true);
  assert.equal(useIntegratedScene(new URLSearchParams('?other=legacy')), true);
});
