import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlayTime, freshProgress, loadProgress, saveProgress, unlocked, formatTime, STORAGE_KEY } from '../src/progress.ts';

function memory(value = null) { return { value, getItem() { return this.value; }, setItem(key, text) { assert.equal(key, STORAGE_KEY); this.value = text; } }; }

test('appearances unlock at precisely 3 and 8 minutes of foreground play', () => {
  const p = freshProgress(); p.activeSeconds = 179.9;
  assert.equal(unlocked('white', p.activeSeconds), false);
  assert.deepEqual(addPlayTime(p, 0.1, true), ['white']); assert.equal(unlocked('white', p.activeSeconds), true);
  p.activeSeconds = 479.9;
  assert.deepEqual(addPlayTime(p, 0.1, true), ['owl']); assert.equal(unlocked('owl', p.activeSeconds), true);
});

test('intro, hidden tab and paused/dialog time are not counted; stalls are capped', () => {
  const p = freshProgress();
  for (let i = 0; i < 1000; i += 1) addPlayTime(p, 1, false);
  assert.equal(p.activeSeconds, 0);
  addPlayTime(p, 600, true); assert.equal(p.activeSeconds, 0.25);
  addPlayTime(p, NaN, true); addPlayTime(p, Infinity, true); addPlayTime(p, -1, true);
  assert.equal(p.activeSeconds, 0.25);
});

test('time, appearance and sound survive reload; a locked appearance cannot be restored', () => {
  const store = memory(); const p = { ...freshProgress(), activeSeconds: 490, look: 'owl', muted: true };
  assert.equal(saveProgress(store, p), true); assert.deepEqual(loadProgress(store), p);
  store.value = JSON.stringify({ ...p, activeSeconds: 10 }); assert.equal(loadProgress(store).look, 'pigeon');
  assert.equal(loadProgress(store).activeSeconds, 10);
});

test('invalid storage and unavailable storage recover without breaking play', () => {
  for (const value of ['oops', 'null', '[]', '{"version":2}', '{"version":1,"activeSeconds":-2}', '{"version":1,"activeSeconds":"480"}']) {
    assert.deepEqual(loadProgress(memory(value)), freshProgress());
  }
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
  assert.deepEqual(loadProgress(denied), freshProgress()); assert.equal(saveProgress(denied, freshProgress()), false);
  assert.equal(saveProgress(null, freshProgress()), false);
});

test('reset returns to the original look and relocks both unlockable appearances', () => {
  const store = memory(); saveProgress(store, { ...freshProgress(), activeSeconds: 1000, look: 'owl' });
  saveProgress(store, freshProgress()); assert.deepEqual(loadProgress(store), freshProgress());
  assert.equal(unlocked('white', loadProgress(store).activeSeconds), false);
});

test('remaining time is rounded upward and formatted without negative values', () => {
  assert.equal(formatTime(180), '03:00'); assert.equal(formatTime(1.1), '00:02'); assert.equal(formatTime(-5), '00:00');
});
