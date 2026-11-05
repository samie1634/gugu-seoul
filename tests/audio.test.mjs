import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BirdAudio } from '../src/audio.ts';

test('a user-started audio graph schedules three coos and a wing beat; mute reaches the master gain', async () => {
  const oscillators = []; const gains = [];
  const param = () => ({ value: 0, setValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; } });
  const node = () => ({ connect(next) { return next; }, start() {}, stop() {} });
  globalThis.AudioContext = class {
    sampleRate = 100;
    currentTime = 2;
    state = 'suspended';
    destination = node();
    async resume() { this.state = 'running'; }
    createGain() { const gain = { ...node(), gain: param() }; gains.push(gain); return gain; }
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return node(); }
    createBiquadFilter() { return { ...node(), frequency: param() }; }
    createOscillator() {
      const oscillator = { ...node(), frequency: param(), start(time) { this.started = time; }, stop(time) { this.stopped = time; } };
      oscillators.push(oscillator); return oscillator;
    }
  };
  const audio = new BirdAudio(); await audio.start(); audio.coo(); audio.flap();
  assert.equal(audio.cooCount, 1); assert.equal(audio.flapCount, 1); assert.equal(oscillators.length, 3);
  assert.deepEqual(oscillators.map(o => o.started), [2, 2.24, 2.52]);
  for (const oscillator of oscillators) assert.ok(oscillator.stopped > oscillator.started);
  audio.setMuted(true); assert.equal(gains[0].gain.value, 0);
  audio.setMuted(false); assert.equal(gains[0].gain.value, 0.32);
});

test('audio initialization failure does not prevent silent play', async () => {
  globalThis.AudioContext = class { constructor() { throw Error('unsupported'); } };
  const audio = new BirdAudio(); await audio.start(); audio.coo(); audio.flap(); audio.setFlight(true);
  assert.equal(audio.cooCount, 0);
});
