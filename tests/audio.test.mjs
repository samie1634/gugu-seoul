import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { audioSha256, resolveAudioAsset, usableAudioResponse } from '../src/audio-assets.ts';
import { BirdAudio } from '../src/audio.ts';
import { HUMAN_SCREAM_CLIP } from '../src/human-reaction-audio.ts';
import { ORIGINAL_AUDIO_CLIPS } from '../src/audio-clips.ts';
import { createFrameClock, isPlaying } from '../src/frame-clock.ts';
import { applyControlsGate } from '../src/input.ts';

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup(t, options = {}) {
  const sources = []; const oscillators = []; const gains = []; const contexts = []; const requests = []; const digests = []; const decoded = [];
  function global(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  const param = (value = 0) => ({
    value, events: [],
    setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); },
    setTargetAtTime(value, time) { this.value = value; this.events.push(['target', value, time]); },
    exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exponential', value, time]); },
    linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); },
  });
  const node = () => ({
    starts: [], stops: [], disconnected: false, onended: null,
    connect(next) { this.connectedTo = next; return next; }, disconnect() { this.disconnected = true; },
    start(...args) { this.starts.push(args); }, stop(...args) { this.stops.push(args); }, finish() { this.onended?.(); },
  });
  global('location', { href: options.pageHref ?? 'https://example.test/gugu-seoul/index.html?view=native#start' });
  global('AudioContext', class {
    sampleRate = 100;
    currentTime = 2;
    state = 'suspended';
    destination = node();
    resumeCalls = 0;
    constructor() { if (options.unavailable) throw Error('unsupported'); contexts.push(this); }
    async resume() {
      this.resumeCalls++;
      if (options.resume) await options.resume(this.resumeCalls);
      this.state = 'running';
    }
    createGain() { const gain = { ...node(), gain: param() }; gains.push(gain); return gain; }
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { const source = { ...node(), playbackRate: param(1), detune: param(), loop: false }; sources.push(source); return source; }
    createBiquadFilter() { return { ...node(), frequency: param() }; }
    createOscillator() { const oscillator = { ...node(), frequency: param() }; oscillators.push(oscillator); return oscillator; }
    async decodeAudioData(bytes) {
      decoded.push(bytes);
      if (options.decodeFailure) throw Error('decode');
      const clipId = new Uint8Array(bytes)[0];
      return { clipId, duration: clipId === 17 ? 1.752 : [1.2, 1.2, 1.25, 1.25, 1.3, 4.944, 1.704,15.072625,26.52,7.008,2.7][clipId - 1] ?? 20 };
    }
  });
  global('fetch', async (url, init) => {
    url = String(url);
    requests.push({ url, init });
    if (url.endsWith(HUMAN_SCREAM_CLIP.path)) return options.human ? (options.humanResponse?.() ?? validResponse(16)) : { ok: false, status: 404 };
    const index = ORIGINAL_AUDIO_CLIPS.findIndex(clip => url.endsWith(clip.path));
    assert.notEqual(index, -1);
    if (options.fetch) return options.fetch(index, url, init);
    return { ok: false, status: 404 };
  });
  if (options.validHashes) t.mock.method(crypto.subtle, 'digest', async (algorithm, bytes) => {
    digests.push({ algorithm, bytes });
    return Uint8Array.from(Buffer.from(([...ORIGINAL_AUDIO_CLIPS, HUMAN_SCREAM_CLIP][new Uint8Array(bytes)[0] - 1]).sha256, 'hex')).buffer;
  });
  return { sources, oscillators, gains, contexts, requests, digests, decoded, originals: () => sources.filter(source => source.buffer?.clipId) };
}

const validResponse = index => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([index + 1]).buffer });

test('manifest keeps coos and single wing beat, and restores one previous full flock wing recording', () => {
  assert.equal(ORIGINAL_AUDIO_CLIPS.length, 16);
  assert.equal(ORIGINAL_AUDIO_CLIPS.filter(clip => clip.kind === 'coo').length, 5);
  const wing = ORIGINAL_AUDIO_CLIPS[5];
  assert.equal(wing.kind, 'flap');
  assert.equal(wing.path, 'species-audio/assets/user-wings-v2/bird-wings-598020.mp3');
  assert.equal(wing.sha256, '300be343203f270a5f2e12e6e4670694944f01c660cd645228bcd5a1f59531e7');
});

test('nothing initializes, fetches, or queues sound before user start', async t => {
  const fake = setup(t); const audio = new BirdAudio();
  audio.coo(); audio.flap(); audio.setFlight(true); audio.setMuted(false);
  assert.equal(audio.originalAudioStatus.state, 'idle');
  assert.equal(fake.contexts.length + fake.requests.length + fake.sources.length, 0);
  await audio.start();
  assert.equal(audio.cooCount + audio.flapCount, 0);
  assert.equal(fake.sources.length, 0); // No generated wind or replay of pre-start actions.
});

test('missing recordings and owl stay silent without synthesized fallback', async t => {
  const fake = setup(t); const audio = new BirdAudio(); await audio.start();
  audio.coo(); audio.flap(); audio.coo(true); audio.setFlight(true);
  assert.equal(audio.originalAudioStatus.state, 'missing');
  assert.equal(fake.sources.length, 0); assert.equal(fake.oscillators.length, 0);
  assert.equal(audio.cooCount + audio.flapCount, 0);
  audio.setMuted(true); audio.setMuted(false);
  assert.equal(fake.gains[0].gain.value, 0.32);
});

test('verified originals cycle five whole coos and the new single wing segment at unchanged rate', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse });
  const audio = new BirdAudio(); await audio.start();
  assert.equal(audio.originalAudioStatus.state, 'ready');
  assert.equal(fake.digests.length, ORIGINAL_AUDIO_CLIPS.length); assert.equal(fake.decoded.length, ORIGINAL_AUDIO_CLIPS.length);
  for (const request of fake.requests) {
    assert.ok(request.url.startsWith('https://example.test/gugu-seoul/species-audio/'));
    assert.equal(request.init.mode, 'same-origin'); assert.equal(request.init.redirect, 'error');
    assert.equal(request.init.credentials, 'same-origin'); assert.ok(request.init.signal);
  }
  assert.ok(fake.digests.every(digest => digest.algorithm === 'SHA-256'));
  const coos = []; const flaps = [];
  for (let i = 0; i < 6; i++) { audio.coo(); const source = fake.originals().at(-1); coos.push(source.buffer.clipId); source.finish(); }
  for (let i = 0; i < 7; i++) { audio.flap(); const source = fake.originals().at(-1); flaps.push(source.buffer.clipId); source.finish(); }
  assert.deepEqual(coos, [1, 2, 3, 4, 5, 1]); assert.deepEqual(flaps, [6, 6, 6, 6, 6, 6, 6]);
  for (const source of fake.originals()) {
    const clip = ORIGINAL_AUDIO_CLIPS[source.buffer.clipId - 1];
    assert.deepEqual(source.starts, clip.kind === 'coo' ? [[2, 0]] : [[2, clip.segment.offsetSeconds, clip.segment.durationSeconds]]);
    assert.equal(source.playbackRate.value, 1);
    assert.equal(source.detune.value, 0); assert.equal(source.loop, false); assert.equal(source.stops.length, 0);
  }
  audio.coo(true); assert.equal(fake.oscillators.length, 0);
  assert.equal(fake.originals().length, 14);
});

test('each flap plays exactly one bounded beat with a short fade and no repeated or queued recording', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse });
  const audio = new BirdAudio(); await audio.start();
  for (let variant = 0; variant < 6; variant++) {
    const previousCount = fake.originals().length;
    audio.flap();
    const source = fake.originals().at(-1);
    const segment = ORIGINAL_AUDIO_CLIPS[5].segment;
    assert.equal(source.buffer.clipId, 6);
    assert.equal(fake.originals().length, previousCount + 1);
    assert.equal(audio.flapCount, variant + 1);
    assert.equal(source.loop, false); assert.equal(source.playbackRate.value, 1);
    assert.ok(segment.offsetSeconds >= 0 && segment.durationSeconds > 0 && segment.durationSeconds <= 0.5);
    assert.ok(segment.offsetSeconds + segment.durationSeconds <= source.buffer.duration);
    assert.deepEqual(source.starts, [[2, segment.offsetSeconds, segment.durationSeconds]]);
    const envelope = source.connectedTo;
    const attack = Math.min(0.005, segment.durationSeconds / 2);
    const release = Math.min(0.010, segment.durationSeconds / 2);
    assert.deepEqual(envelope.gain.events, [
      ['set', 0, 2], ['linear', 1, 2 + attack],
      ['set', 1, 2 + segment.durationSeconds - release], ['linear', 0, 2 + segment.durationSeconds],
    ]);
    assert.ok(envelope.gain.events.every(event => event[2] >= 2 && event[2] <= 2 + segment.durationSeconds));
    for (let repeat = 0; repeat < 30; repeat++) audio.flap();
    assert.equal(fake.originals().length, previousCount + 1, 'Repeated calls cannot layer or queue voices');
    assert.equal(audio.flapCount, variant + 1);
    source.finish();
    assert.ok(source.disconnected && envelope.disconnected);
    assert.equal(fake.originals().length, previousCount + 1, 'Ending one beat never replays blocked calls');
  }
  const gainCount = fake.gains.length;
  audio.coo(); const coo = fake.originals().at(-1);
  assert.deepEqual(coo.starts, [[2, 0]]); assert.equal(fake.gains.length, gainCount, 'Coo has no clipping envelope');
});

test('overlapping calls and repeated unlock create only one graph, load, and voice per kind', async t => {
  const unlock = deferred();
  const fake = setup(t, { validHashes: true, fetch: validResponse, resume: () => unlock.promise });
  const audio = new BirdAudio(); const first = audio.start(); const second = audio.start();
  assert.equal(fake.contexts.length, 1); assert.equal(fake.contexts[0].resumeCalls, 1); assert.equal(fake.requests.length, ORIGINAL_AUDIO_CLIPS.length + 1);
  audio.coo(); audio.flap(); assert.equal(fake.originals().length, 0);
  unlock.resolve(); await Promise.all([first, second]);
  assert.equal(fake.originals().length, 0);
  audio.coo(); audio.coo(); audio.flap(); audio.flap();
  assert.equal(fake.originals().length, 2);
  await audio.start(); assert.equal(fake.requests.length, ORIGINAL_AUDIO_CLIPS.length + 1);
  fake.originals()[0].finish(); audio.coo(); assert.equal(fake.originals().length, 3);
});

test('loading stays silent and never replays old actions after files arrive', async t => {
  const files = deferred(); const fake = setup(t, { validHashes: true, fetch: async index => { await files.promise; return validResponse(index); } });
  const audio = new BirdAudio(); const starting = audio.start();
  await Promise.resolve();
  assert.equal(audio.originalAudioStatus.state, 'loading');
  audio.coo(); audio.flap(); assert.equal(fake.oscillators.length, 0); assert.equal(fake.sources.length, 0);
  files.resolve(); await starting;
  assert.equal(audio.originalAudioStatus.state, 'ready'); assert.equal(fake.originals().length, 0);
  audio.coo(); audio.flap(); assert.equal(fake.originals().length, 2);
});

test('mute and inactive gate stop original clips and never queue or resume them', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse }); const audio = new BirdAudio();
  await audio.start(); audio.coo(); audio.flap();
  audio.setMuted(true);
  assert.ok(fake.originals().every(source => source.stops.length === 1 && source.disconnected));
  audio.coo(); audio.flap(); audio.setMuted(false); assert.equal(fake.originals().length, 2);
  audio.coo(); audio.flap(); audio.setActive(false);
  assert.ok(fake.originals().every(source => source.stops.length === 1 && source.disconnected));
  audio.coo(); audio.flap(); audio.setFlight(true); assert.equal(fake.oscillators.length, 0);
  audio.setActive(true); assert.equal(fake.originals().length, 4);
  audio.coo(); audio.flap(); assert.equal(fake.originals().length, 6);
  audio.muted = true; assert.ok(fake.originals().every(source => source.stops.length === 1));
});

test('files resolving while muted or inactive do not start clips', async t => {
  const files = deferred(); const fake = setup(t, { validHashes: true, fetch: async index => { await files.promise; return validResponse(index); } });
  const audio = new BirdAudio(); audio.muted = true; audio.setActive(false);
  const starting = audio.start(); audio.coo(); audio.flap(); files.resolve(); await starting;
  assert.equal(audio.originalAudioStatus.state, 'ready'); assert.equal(fake.originals().length, 0);
  audio.muted = false; audio.setActive(true); assert.equal(fake.originals().length, 0);
});

test('an actual SHA-256 mismatch fails before decoding and stays silent', async t => {
  const fake = setup(t, { fetch: validResponse }); const audio = new BirdAudio(); await audio.start();
  assert.equal(audio.originalAudioStatus.state, 'failed');
  assert.ok(audio.originalAudioStatus.clips.every(clip => clip.error === 'integrity'));
  assert.equal(fake.decoded.length, 0); audio.coo(); audio.flap(); assert.equal(fake.oscillators.length, 0);
});

test('HTTP, network, and decode errors remain distinguishable from missing files', async t => {
  const fake = setup(t, { validHashes: true, decodeFailure: true, fetch: index => {
    if (index === 0) return { ok: false, status: 503 };
    if (index === 1) throw Error('offline');
    if (index === 2) return { ok: false, status: 404 };
    return validResponse(index);
  } });
  const audio = new BirdAudio(); await audio.start(); const clips = audio.originalAudioStatus.clips;
  assert.equal(audio.originalAudioStatus.state, 'failed');
  assert.equal(clips[0].error, 'fetch'); assert.equal(clips[1].error, 'fetch'); assert.equal(clips[2].state, 'missing');
  assert.equal(clips[3].error, 'decode'); assert.equal(fake.decoded.length, ORIGINAL_AUDIO_CLIPS.length-3);
});

test('partial availability plays only verified variants and stays silent for unavailable kinds', async t => {
  const fake = setup(t, { validHashes: true, fetch: index => index === 3 ? validResponse(index) : { ok: false, status: 404 } });
  const audio = new BirdAudio(); await audio.start(); audio.coo(); audio.flap();
  assert.equal(audio.originalAudioStatus.state, 'missing');
  assert.equal(fake.originals().length, 1); assert.equal(fake.originals()[0].buffer.clipId, 4);
  assert.equal(fake.sources.length, 1);
});

test('a rejected unlock can be retried on a later gesture without refetching or queued playback', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse, resume: count => { if (count === 1) throw Error('blocked'); } });
  const audio = new BirdAudio(); await audio.start(); audio.coo(); audio.flap();
  assert.equal(fake.originals().length, 0);
  await audio.start(); assert.equal(fake.contexts[0].resumeCalls, 2); assert.equal(fake.requests.length, ORIGINAL_AUDIO_CLIPS.length + 1);
  assert.equal(fake.originals().length, 0); audio.coo(); assert.equal(fake.originals().length, 1);
});

test('audio initialization failure does not fetch assets or prevent silent play', async t => {
  const fake = setup(t, { unavailable: true });
  const audio = new BirdAudio(); await audio.start(); audio.coo(); audio.flap(); audio.setFlight(true); audio.setActive(false);
  assert.equal(audio.cooCount, 0); assert.equal(fake.requests.length, 0);
});

// Execute production functions, not a test copy of the gate ordering. Loading the
// entire main module would instead require WebGL and boot the unrelated scene.
function mainAudioGate(audio) {
  const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ['applyGate', 'coo'].includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(functions.size, 2, 'Production applyGate and coo must be found, rather than silently using test substitutes');
  const production = ts.transpileModule([...functions.values()].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const factory = new Function('audio', 'isPlaying', 'createFrameClock', 'applyControlsGate', `
    let started = false, contextUsable = true, focused = true, hidden = false, paused = false;
    const looksDialog = { open: false }, helpDialog = { open: false };
    const anyDialog = () => looksDialog.open || helpDialog.open;
    let gate = { enabled: false, focused, hidden, paused, dialogOpen: false };
    let clock = createFrameClock(gate), introPreviousTimestamp = 123;
    const controls = { gate: null, setGate(value) { this.gate = value; } };
    const native = { cancelHunt() {} };
    const cameraOrbit = { enabled: false, setEnabled(value) { this.enabled = value; } };
    let cooAge = 10, walkedSinceCoo = 10;
    const progress = { look: 'pigeon' }, bubble = { hidden: true, textContent: '' };
    const cooBubble = bubble;
    ${production}
    applyGate();
    return {
      coo,
      change(values) {
        if ('started' in values) started = values.started;
        if ('contextUsable' in values) contextUsable = values.contextUsable;
        if ('focused' in values) focused = values.focused;
        if ('hidden' in values) hidden = values.hidden;
        if ('paused' in values) paused = values.paused;
        if ('looksOpen' in values) looksDialog.open = values.looksOpen;
        if ('helpOpen' in values) helpDialog.open = values.helpOpen;
        applyGate();
      },
      snapshot() { return { gate, controlsGate: controls.gate, cameraEnabled: cameraOrbit.enabled, clockGate: clock.gate, introPreviousTimestamp, cooAge, bubble: { ...bubble } }; }
    };
  `);
  return factory(audio, isPlaying, createFrameClock, applyControlsGate);
}

test('production applyGate enables ready BirdAudio on the very first start, without a second lifecycle event', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse });
  const audio = new BirdAudio(); const main = mainAudioGate(audio);
  assert.equal(isPlaying(main.snapshot().gate), false);
  main.coo(); audio.flap(); assert.equal(audio.cooCount + audio.flapCount, 0);
  // This is the start-button sequence: update started/focus, applyGate, unlock.
  main.change({ started: true, focused: true }); await audio.start();
  assert.equal(audio.originalAudioStatus.state, 'ready');
  main.coo(); audio.flap();
  assert.equal(audio.cooCount, 1, 'First start must not leave audio using the previous disabled gate');
  assert.equal(audio.flapCount, 1); assert.equal(fake.originals().length, 2);
  const firstWing = ORIGINAL_AUDIO_CLIPS[5].segment;
  assert.deepEqual(fake.originals().map(source => source.starts), [[[2, 0]], [[2, firstWing.offsetSeconds, firstWing.durationSeconds]]]);
  const state = main.snapshot();
  assert.equal(state.cameraEnabled, true); assert.deepEqual(state.controlsGate, state.gate);
  assert.deepEqual(state.clockGate, state.gate); assert.equal(state.introPreviousTimestamp, null);
  assert.equal(state.bubble.textContent, '구구구'); assert.equal(state.cooAge, 0);
  // Visibility is updated by the projected-bubble frame renderer, not coo().
  assert.equal(state.bubble.hidden, true);
});

test('production applyGate immediately stops and re-enables audio for every pause/resume transition', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse });
  const audio = new BirdAudio(); const main = mainAudioGate(audio);
  main.change({ started: true }); await audio.start();
  const transitions = [
    ['blur/focus', { focused: false }, { focused: true }],
    ['looks dialog open/close', { looksOpen: true }, { looksOpen: false }],
    ['help dialog open/close', { helpOpen: true }, { helpOpen: false }],
    ['hidden/resume', { hidden: true }, { hidden: false }],
    ['pause/resume', { paused: true }, { paused: false }],
    ['context lost/restored', { contextUsable: false }, { contextUsable: true }],
  ];
  for (const [label, stop, resume] of transitions) {
    main.coo(); audio.flap(); const current = fake.originals().slice(-2);
    assert.equal(current.length, 2, `${label}: active playback exists`);
    assert.ok(current.every(source => source.stops.length === 0), `${label}: fresh playback`);
    const count = fake.originals().length;
    main.change(stop);
    assert.ok(current.every(source => source.stops.length === 1 && source.disconnected), `${label}: stop on the first gate event`);
    assert.equal(isPlaying(main.snapshot().gate), false);
    main.coo(); audio.flap(); assert.equal(fake.originals().length, count, `${label}: disabled calls are not played`);
    main.change(resume);
    assert.equal(isPlaying(main.snapshot().gate), true);
    assert.equal(fake.originals().length, count, `${label}: no old action is replayed`);
    main.coo(); audio.flap(); assert.equal(fake.originals().length, count + 2, `${label}: fresh calls work immediately after one resume`);
    fake.originals().slice(-2).forEach(source => source.finish());
  }
});

test('production applyGate handles overlapping pause reasons and loading completion without replay', async t => {
  const files = deferred();
  const fake = setup(t, { validHashes: true, fetch: async index => { await files.promise; return validResponse(index); } });
  const audio = new BirdAudio(); const main = mainAudioGate(audio);
  main.change({ started: true }); const starting = audio.start(); await Promise.resolve();
  main.coo(); audio.flap(); assert.equal(fake.oscillators.length, 0);
  main.change({ hidden: true, focused: false, helpOpen: true });
  assert.ok(fake.oscillators.every(source => source.disconnected));
  files.resolve(); await starting;
  assert.equal(audio.originalAudioStatus.state, 'ready'); assert.equal(fake.originals().length, 0);
  main.change({ hidden: false }); main.coo(); audio.flap();
  main.change({ focused: true }); main.coo(); audio.flap();
  assert.equal(fake.originals().length, 0, 'Remaining dialog keeps resumed visibility/focus silent');
  main.change({ helpOpen: false }); assert.equal(fake.originals().length, 0);
  main.coo(); audio.flap(); assert.equal(fake.originals().length, 2);
});


test('water entry plays one unchanged original, with mute/pause/unlock/no-overlap gates', async t => {
  const fake=setup(t,{validHashes:true,fetch:validResponse});const audio=new BirdAudio();
  audio.splash();assert.equal(fake.sources.length,0);await audio.start();assert.equal(fake.sources.length,0);
  const manifest=ORIGINAL_AUDIO_CLIPS.find(clip=>clip.kind==='splash');
  assert.equal(manifest.sha256,'802ad251e9fd9cebceadcb970d27567e73a93e083bc6c0bd31399f94d904e2aa');
  assert.equal(manifest.segment,undefined);
  audio.splash();const source=fake.originals().at(-1);assert.equal(source.buffer.clipId,7);
  assert.deepEqual(source.starts,[[2,0]]);assert.equal(source.playbackRate.value,1);assert.equal(source.loop,false);
  for(let i=0;i<100;i++)audio.splash();assert.equal(audio.splashCount,1);assert.equal(fake.sources.length,1);
  source.finish();assert.equal(fake.sources.length,1);audio.splash();assert.equal(audio.splashCount,2);
  audio.setMuted(true);audio.splash();audio.setMuted(false);assert.equal(audio.splashCount,2);
  audio.setActive(false);audio.splash();audio.setActive(true);assert.equal(audio.splashCount,2);
  audio.splash();assert.equal(audio.splashCount,3);assert.equal(fake.oscillators.length,0);
});

test('missing splash never substitutes a synthesized sound or another recording', async t => {
  const fake=setup(t,{validHashes:true,fetch:index=>index===6?{ok:false,status:404}:validResponse(index)});
  const audio=new BirdAudio();await audio.start();audio.splash();
  assert.equal(audio.splashCount,0);assert.equal(fake.sources.length,0);assert.equal(fake.oscillators.length,0);
});

test('city recordings share the master and honor pause/mute without synthesized fallback',async t=>{
 const fake=setup(t,{validHashes:true,fetch:validResponse});const audio=new BirdAudio();const p={x:0,y:0,z:0};const pair={...p,id:'two-people',visible:true};
 audio.cityAmbience(p,[pair]);assert.equal(fake.sources.length,0);
 await audio.start();audio.cityAmbience(p,[pair]);
 assert.equal(fake.sources.length,2);assert.deepEqual(fake.sources.map(s=>s.buffer.clipId),[8,9]);
 for(let i=0;i<50;i++)audio.cityAmbience(p,[pair]);assert.equal(fake.sources.length,2);
 audio.setMuted(true);audio.cityAmbience(p,[pair]);assert.equal(fake.sources.length,2);
 audio.setMuted(false);audio.cityAmbience(p,[]);assert.equal(fake.sources.length,3);assert.equal(fake.sources.at(-1).buffer.clipId,8);
 audio.setActive(false);audio.cityAmbience(p,[pair]);assert.equal(fake.sources.length,3);assert.equal(fake.oscillators.length,0);
});

test('traffic manifest packages the exact Pixabay engine recording without changing other originals', () => {
  const engine = ORIGINAL_AUDIO_CLIPS.find(clip => clip.kind === 'traffic');
  assert.ok(engine);
  assert.equal(engine.path, 'species-audio/assets/pixabay-city-v1/engine-82134.mp3');
  assert.equal(engine.segment, undefined);
  const bytes = readFileSync(new URL('../public/' + engine.path, import.meta.url));
  assert.equal(bytes.length, 140160);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), engine.sha256);
  assert.equal(engine.sha256, '506c0c9d4c91e2e2977d57a2b9916e8eb084eb816f3ee0a6a2a309a8e36fc54d');
});

test('engine follows actual cars in three dimensions and remains one unchanged loop', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse });
  const audio = new BirdAudio();
  const listener = { x: 0, y: 0, z: 0 };
  const car = { ...listener, id: 'rendered-car', visible: true };
  const engineId = ORIGINAL_AUDIO_CLIPS.findIndex(clip => clip.kind === 'traffic') + 1;
  const engines = () => fake.originals().filter(source => source.buffer.clipId === engineId);
  audio.cityAmbience(listener, [], [car]);
  assert.equal(fake.sources.length, 0, 'No fetch, sound, or queued car before start');
  await audio.start();
  audio.cityAmbience(listener, []);
  assert.equal(engines().length, 0, 'Backward-compatible caller cannot invent car positions');
  audio.cityAmbience(listener, [], [{ ...car, visible: false }, { ...car, x: NaN }]);
  assert.equal(engines().length, 0);
  audio.cityAmbience(listener, [], [car]);
  const source = engines()[0];
  assert.equal(source.loop, true); assert.equal(source.playbackRate.value, 1);
  assert.equal(source.detune.value, 0); assert.deepEqual(source.starts, [[]]);
  assert.equal(source.connectedTo.connectedTo, fake.gains[0], 'Engine uses existing master');
  const level = () => source.connectedTo.gain.value;
  const near = level(); assert.equal(near, .32);
  audio.cityAmbience(listener, [], [{ ...car, x: 30 }]);
  const far = level(); assert.ok(far > 0 && far < near);
  audio.cityAmbience({ ...listener, y: 30 }, [], [car]);
  assert.equal(level(), far, 'Altitude attenuates exactly like horizontal distance');
  for (let i = 0; i < 100; i++) audio.cityAmbience(listener, [], [car, { ...car, id: 'second-car', x: 10 }]);
  assert.equal(engines().length, 1, 'Many cars and updates cannot layer engine loops');
  audio.cityAmbience({ ...listener, y: 65 }, [], [car]);
  assert.equal(source.stops.length, 1); assert.ok(source.disconnected);
  audio.cityAmbience(listener, [], [car]);
  const restarted = engines().at(-1);
  audio.cityAmbience(listener, [], []);
  assert.equal(restarted.stops.length, 1, 'Removing the last car stops the engine');
  assert.equal(fake.oscillators.length, 0);
});

test('engine pause, mute and suspension stop immediately without interrupting existing recording kinds', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse });
  const audio = new BirdAudio();
  const listener = { x: 0, y: 0, z: 0 };
  const car = { ...listener, id: 'car', visible: true };
  const pair = { ...listener, id: 'pair', visible: true };
  await audio.start();
  const update = () => audio.cityAmbience(listener, [pair], [car]);
  update();
  assert.deepEqual(fake.originals().map(source => source.buffer.clipId), [8, 10, 9]);
  assert.equal(fake.sources.length, 3);
  audio.cityAmbience(listener, [pair], []);
  assert.equal(fake.originals()[1].stops.length, 1);
  assert.equal(fake.originals()[0].stops.length, 0, 'Wind continues when cars disappear');
  assert.equal(fake.originals()[2].stops.length, 0, 'Mutual conversation continues when cars disappear');
  const transitions = [
    [() => audio.setMuted(true), () => audio.setMuted(false)],
    [() => audio.setActive(false), () => audio.setActive(true)],
    [() => { fake.contexts[0].state = 'suspended'; }, () => { fake.contexts[0].state = 'running'; }],
  ];
  for (const [stop, resume] of transitions) {
    update(); stop(); update();
    assert.ok(fake.sources.every(source => source.stops.length === 1 && source.disconnected));
    const count = fake.sources.length;
    resume(); assert.equal(fake.sources.length, count, 'Resume waits for current committed anchors');
    update(); assert.equal(fake.sources.length, count + 3);
  }
  assert.equal(fake.contexts.length, 1); assert.equal(fake.oscillators.length, 0);
});

for (const failure of ['missing', 'integrity', 'decode']) {
  test(`failed engine ${failure} stays silent while existing wind/conversation still work`, async t => {
    const engineIndex = ORIGINAL_AUDIO_CLIPS.findIndex(clip => clip.kind === 'traffic');
    const fake = setup(t, { validHashes: true, fetch: index => index === engineIndex && failure === 'missing' ? { ok: false, status: 404 } : validResponse(index) });
    if (failure === 'integrity') t.mock.method(crypto.subtle, 'digest', async (_algorithm, bytes) => {
      const index = new Uint8Array(bytes)[0] - 1;
      return Uint8Array.from(Buffer.from(index === engineIndex ? '0'.repeat(64) : ORIGINAL_AUDIO_CLIPS[index].sha256, 'hex')).buffer;
    });
    const audio = new BirdAudio();
    const starting = audio.start();
    if (failure === 'decode') {
      const original = fake.contexts[0].decodeAudioData.bind(fake.contexts[0]);
      fake.contexts[0].decodeAudioData = bytes => {
        if (new Uint8Array(bytes)[0] === engineIndex + 1) throw Error('engine decode failed');
        return original(bytes);
      };
    }
    await starting;
    const listener = { x: 0, y: 0, z: 0 };
    const emitter = { ...listener, id: 'actual', visible: true };
    audio.cityAmbience(listener, [emitter], [emitter]);
    assert.deepEqual(fake.originals().map(source => source.buffer.clipId), [8, 9]);
    assert.equal(fake.oscillators.length, 0);
    const engine = audio.originalAudioStatus.clips[engineIndex];
    assert.equal(failure === 'missing' ? engine.state : engine.error, failure);
  });
}

test('production 5Hz city caller reads committed native vehicle positions without phantom cars', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse });
  const audio = new BirdAudio(); await audio.start();
  const file = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let block;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(file).replaceAll(' ', '') === 'native&&worldTime>=nextCityAudioCheck') block = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(block, 'Execute the production city audio block');
  assert.ok(ts.isBlock(block.parent) && ts.isIfStatement(block.parent.parent) && block.parent.parent.expression.getText(file) === 'activeStep', 'Audio positions only sampled after an accepted game frame');
  const production = ts.transpileModule(block.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const listener = { x: 0, y: 0, z: 0 };
  const committed = { states: [] };
  const native = { snapshot: () => ({ npcs: { states: [] } }), traffic: { snapshot: () => committed } };
  const frame = new Function('audio', 'native', `let nextCityAudioCheck=0; return (bird,worldTime)=>{${production}};`)(audio, native);
  frame(listener, 0);
  const engineId = ORIGINAL_AUDIO_CLIPS.findIndex(clip => clip.kind === 'traffic') + 1;
  const engines = () => fake.originals().filter(source => source.buffer.clipId === engineId);
  assert.equal(engines().length, 0);
  committed.states = [{ id: 'actual-car', ...listener, visible: true }];
  frame(listener, .1); assert.equal(engines().length, 0, 'Keeps existing 5Hz sampling limit');
  frame(listener, .2); assert.equal(engines().length, 1);
  const engine = engines()[0]; assert.equal(engine.connectedTo.gain.value, .32);
  committed.states = [{ ...committed.states[0], x: 35 }];
  frame(listener, .4); assert.ok(engine.connectedTo.gain.value < .1);
  committed.states = [];
  frame(listener, .61); assert.equal(engine.stops.length, 1);
});

test('flock takeoff plays the previous 2.7 second recording once in full, independently of the single beat', async t => {
  const fake = setup(t, { validHashes: true, fetch: validResponse });
  const audio = new BirdAudio(); audio.flockTakeoff(); assert.equal(fake.sources.length, 0);
  await audio.start(); assert.equal(fake.sources.length, 0);
  audio.flockTakeoff(); audio.flockTakeoff();
  const source = fake.originals().at(-1);
  assert.equal(source.buffer.clipId, 11); assert.equal(source.buffer.duration, 2.7);
  assert.deepEqual(source.starts, [[2, 0]]); assert.equal(source.playbackRate.value, 1); assert.equal(source.loop, false);
  assert.equal(audio.flockCount, 1);
  audio.flap(); assert.equal(audio.flapCount, 1); assert.equal(fake.originals().length, 2);
  audio.setMuted(true); assert.ok(source.disconnected); assert.equal(source.stops.length, 1);
  audio.flockTakeoff(); audio.setMuted(false); assert.equal(audio.flockCount, 1);
  audio.flockTakeoff(); audio.setActive(false); assert.equal(fake.originals().at(-1).stops.length, 1);
  audio.setActive(true); assert.equal(audio.flockCount, 2, 'no queued playback on resume');
});

test('missing or unverified full wing recording stays silent without fallback', async t => {
  const fake = setup(t); const audio = new BirdAudio(); await audio.start(); audio.flockTakeoff();
  assert.equal(fake.sources.length, 0); assert.equal(fake.oscillators.length, 0); assert.equal(audio.flockCount, 0);
});

test('four external recordings follow exact visible species with bounded cadence and original playback',async t=>{
 const fake=setup(t,{validHashes:true,fetch:validResponse}),audio=new BirdAudio();await audio.start();
 const p={x:0,y:0,z:0};const b=(species,visible=true,x=2)=>({...p,species,visible,x});
 audio.flockCall([b('sparrow',false),b('crow',true,80)],p,1);assert.equal(fake.sources.length,0);
 for(const [i,kind] of ['sparrow','crow','tawny-owl','eagle-owl'].entries()){
  audio.flockCall([b(kind)],p,2+i*20);assert.equal(audio.speciesCallCounts[kind],1);
  const source=fake.originals().at(-1);assert.equal(source.buffer.clipId,12+i);assert.equal(source.loop,false);assert.equal(source.playbackRate.value,1);
  assert.equal(audio.callSpecies(kind),false);source.finish();
 }
 audio.setMuted(true);assert.equal(audio.callSpecies('crow'),false);
 audio.setMuted(false);audio.setActive(false);assert.equal(audio.callSpecies('tawny-owl'),false);
 audio.setActive(true);audio.coo(true);assert.equal(audio.speciesCallCounts['eagle-owl'],2);
 assert.equal(fake.oscillators.length,0);assert.equal(audio.callSpecies('magpie'),false);
});

test('external sparrow segment is bounded and a missing species never borrows another bird',async t=>{
 const fake=setup(t,{validHashes:true,fetch:index=>index===12?{ok:false,status:404}:validResponse(index)}),audio=new BirdAudio();await audio.start();
 assert.equal(audio.callSpecies('crow'),false);assert.equal(audio.callSpecies('sparrow'),true);
 const source=fake.originals().at(-1);assert.equal(source.buffer.clipId,12);assert.deepEqual(source.starts[0],[fake.contexts[0].currentTime,.4,8]);
 source.finish();assert.equal(audio.callSpecies('sparrow',1),true);assert.deepEqual(fake.originals().at(-1).starts[0],[fake.contexts[0].currentTime,.4,8]);
});


test('duck recording is a verified local asset and only nearby hens produce flock quacks', async t => {
  const clip = ORIGINAL_AUDIO_CLIPS.find(c => c.kind === 'duck');
  assert.ok(clip);
  const bytes = readFileSync(new URL('../public/' + clip.path, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
  const fake = setup(t, { validHashes: true, fetch: async index => validResponse(index) });
  const audio = new BirdAudio(); await audio.start();
  const listener = { x:0,y:0,z:0 }, duck = { species:'duck',visible:true,x:2,y:0,z:0,plumage:'drake' };
  audio.flockCall([duck], listener, 1);assert.equal(fake.sources.length,0);
  audio.flockCall([{ ...duck, breed:'call-duck', plumage:'hen' }], listener, 1);assert.equal(fake.sources.length,0, 'pending call-duck recording has no substitute');
  for (const breed of ['mallard','call-duck']) { audio.flockCall([{ ...duck, breed, plumage:'duckling' }], listener, 1);assert.equal(fake.sources.length,0, 'pending duckling recording has no substitute'); }
  audio.flockCall([{ ...duck,plumage:'hen',x:50 }], listener, 1);assert.equal(fake.sources.length,0);
  audio.flockCall([{ ...duck,plumage:'hen' }], listener, 1);assert.equal(fake.sources.length,1);
  const source = fake.sources[0];assert.equal(source.playbackRate.value,1);assert.equal(source.loop,false);source.finish();
  audio.flockCall([{ ...duck,plumage:'hen' }], listener, 2);assert.equal(fake.sources.length,1);
  audio.setMuted(true);audio.flockCall([{ ...duck,plumage:'hen' }],listener,20);assert.equal(fake.sources.length,1);
});


test('native human reaction audio loads once, plays on the master output, and stops on pause or mute', async t => {
  const fake=setup(t,{validHashes:true,fetch:validResponse,human:true}),audio=new BirdAudio();
  await audio.start();await audio.start();
  assert.equal(audio.humanReactionAudioStatus,'ready');
  assert.equal(fake.requests.filter(r=>r.url.endsWith(HUMAN_SCREAM_CLIP.path)).length,1);
  const at={x:0,y:1,z:0};
  assert.equal(audio.humanScream('scream-1','woman',at,at),true);
  assert.equal(audio.humanScream('scream-1','woman',at,at),false);
  const first=fake.originals().at(-1);assert.equal(first.buffer.clipId,17);assert.equal(first.playbackRate.value,1);
  audio.setActive(false);assert.equal(first.stops.length,1);
  assert.equal(audio.humanScream('scream-2','woman',at,at),false);
  audio.setActive(true);fake.contexts[0].currentTime=20;
  assert.equal(audio.humanScream('scream-3','woman',at,at),true);
  const second=fake.originals().at(-1);audio.setMuted(true);assert.equal(second.stops.length,1);
  assert.equal(audio.humanScream('scream-4','woman',at,at),false);assert.equal(fake.oscillators.length,0);
});


test('Capacitor sound loaders decode originals, including coo, single flap, and human sounds', async t => {
  const localResponse = index => ({ ...validResponse(index), ok: false, status: 0, type: 'basic' });
  const fake = setup(t, { pageHref: 'capacitor://localhost/', validHashes: true, fetch: localResponse, human: true, humanResponse: () => localResponse(16) });
  const audio = new BirdAudio(); await audio.start();
  assert.equal(audio.originalAudioStatus.state, 'ready');
  assert.equal(audio.humanReactionAudioStatus, 'ready');
  assert.ok(fake.requests.every(x => x.url.startsWith('capacitor://localhost/species-audio/assets/') && x.init.redirect === 'error' && x.init.credentials === 'omit'));
  audio.coo(); audio.flap();
  assert.equal(audio.cooCount, 1); assert.equal(audio.flapCount, 1);
  audio.setMuted(true); audio.coo(); audio.flap();
  assert.equal(audio.cooCount, 1); assert.equal(audio.flapCount, 1);
});

test('custom-scheme asset resolution rejects off-device hosts, ports, credentials and paths', () => {
  const page = 'capacitor://localhost/';
  for (const candidate of ['https://localhost/species-audio/assets/a.wav', 'capacitor://elsewhere/species-audio/assets/a.wav', 'capacitor://localhost:9/species-audio/assets/a.wav', 'capacitor://x@localhost/species-audio/assets/a.wav', './outside.wav', './species-audio/assets/../../secret.wav', './species-audio/assets/a.wav#fragment']) {
    assert.throws(() => resolveAudioAsset(candidate, page));
  }
  assert.throws(() => resolveAudioAsset('./species-audio/assets/a.wav', 'file:///'));
  assert.throws(() => resolveAudioAsset('https://outside.test/sound.wav', 'https://example.test/'));
  assert.equal(resolveAudioAsset('species-audio/assets/a.wav', 'https://example.test/gugu-seoul/').url.pathname, '/gugu-seoul/species-audio/assets/a.wav');
});

test('bundled SHA-256 fallback matches Node for empty, exact-block, and multi-block inputs', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  for (const n of [0, 3, 55, 56, 64, 1025, 190431]) {
    const bytes = Uint8Array.from({length: n}, (_, i) => i % 239);
    assert.equal(await audioSha256(bytes.buffer, true), createHash('sha256').update(bytes).digest('hex'));
  }
  await assert.rejects(() => audioSha256(new ArrayBuffer(0), false), { message: 'integrity-unavailable' });
});

test('a fresh gesture can re-unlock an interrupted iOS AudioContext without changing mute', async t => {
  const fake = setup(t), audio = new BirdAudio(); await audio.start();
  assert.equal(audio.needsUnlock, false);
  fake.contexts[0].state = 'interrupted'; audio.setMuted(true);
  assert.equal(audio.needsUnlock, true);
  await audio.start();
  assert.equal(fake.contexts[0].resumeCalls, 2); assert.equal(audio.muted, true);
});


test('zero-status native responses must be basic; web and opaque remain rejected', () => {
  for (const type of ['opaque', 'opaqueredirect', 'error']) {
    assert.equal(usableAudioResponse({ ok: false, status: 0, type }, true), false);
  }
  assert.equal(usableAudioResponse({ ok: false, status: 0, type: 'basic' }, false), false);
  assert.equal(usableAudioResponse({ ok: false, status: 0, type: 'basic' }, true), true);
  assert.equal(usableAudioResponse({ ok: false, status: 404, type: 'basic' }, true), false);
});

test('coo head timing follows one existing scheduled voice, maintains overlap and clears on cancel/mute/pause', async t => {
  const fake=setup(t,{validHashes:true,fetch:validResponse});
  const audio=new BirdAudio();await audio.start();
  const ctx=fake.contexts[0];ctx.currentTime=12;
  audio.coo();const first=fake.originals().at(-1);
  assert.deepEqual(first.starts,[[12,0]]);assert.equal(audio.pigeonCooMotion.forward,0);
  ctx.currentTime=12.25;assert.ok(Math.abs(audio.pigeonCooMotion.forward-.036)<1e-10);
  audio.coo();assert.equal(fake.originals().length,1);
  ctx.currentTime=12.765;assert.ok(Math.abs(audio.pigeonCooMotion.forward-.029)<1e-10);
  ctx.currentTime=13.11;assert.equal(audio.pigeonCooMotion.forward,0);
  first.finish();assert.equal(audio.pigeonCooMotion,null);
  ctx.currentTime=30; audio.coo();ctx.currentTime=30.17;assert.ok(Math.abs(audio.pigeonCooMotion.forward-.036)<1e-10);
  audio.cancelPigeonCoo();assert.equal(audio.pigeonCooMotion,null);
  audio.coo();audio.muted=true;assert.equal(audio.pigeonCooMotion,null);
  audio.muted=false;audio.coo();audio.setActive(false);assert.equal(audio.pigeonCooMotion,null);
  audio.setActive(true);assert.equal(audio.pigeonCooMotion,null);
});
