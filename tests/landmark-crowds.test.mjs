import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNativeNpcBridge } from '../src/native/npc-bridge.ts';
import { createMapNpcAdapter } from '../src/native/ported/npcs/runtime/map-adapter.ts';
import { makeRealMapLayout } from '../src/native/ported/map/real-map/layout.ts';
import { isSpawnClear, sampleGround } from '../src/native/ported/map/layout.ts';
import { PROFILES } from '../src/native/ported/npcs/src/profiles.ts';
import { createNpcModelLayer } from '../src/native/ported/npcs/models/index.ts';
import { paintPose } from '../src/native/ported/npcs/models/pose.ts';

const player = at => ({ ...at, vx: 0, vy: 0, vz: 0, body: { horizontalRadiusM: .173, heightM: .225 }, flap: false, coo: false });
function fixture(quality = 'mobile') {
  const layout = makeRealMapLayout({ quality }), bridge = createNativeNpcBridge(new THREE.Scene(), layout);
  let frame = 0; const events = [];
  return { layout, bridge, events, run(at, seconds = 5) {
    for (let i = 0; i < seconds * 20; i++) { frame++; events.push(...bridge.commit({ frame, simTime: frame / 20, acceptedSeconds: .05, playing: true }, at, player(at))); }
    return bridge.snapshot();
  } };
}

test('gathering routes are inside the actual map, avoid traffic/buildings and reserve hanbok for palace courts', () => {
  const layout = makeRealMapLayout(), adapter = createMapNpcAdapter(layout, { landmarkCrowds: true });
  const routes = adapter.navigation.routes.filter(r => r.id.startsWith('landmark-crowd:'));
  // One former approach route now intersects the imported Woldae and is correctly rejected.
  assert.equal(routes.filter(r => r.id.includes(':plaza:')).length, 14);
  assert.equal(routes.filter(r => r.id.includes(':palace:')).length, 15);
  for (const route of routes) {
    assert.deepEqual(route.kinds, ['human']);
    assert.equal(route.humanOutfit, route.id.includes(':palace:') ? 'hanbok' : undefined);
    const [a, b] = route.points;
    assert.ok(adapter.navigation.canTraverse(a, b, PROFILES.human, { referenceY: 0 }));
    for (let step = 0; step <= 20; step++) {
      const p = { x: a.x + (b.x - a.x) * step / 20, y: 0, z: a.z + (b.z - a.z) * step / 20 };
      assert.ok(isSpawnClear(layout, p, PROFILES.human.radius, PROFILES.human.height));
      assert.equal(sampleGround(layout, p.x, p.z).surface, 'stone');
      if (route.humanOutfit) assert.ok(p.z < -331 && p.z > -519);
    }
  }
});

for (const quality of ['mobile', 'desktop']) test(`${quality} crowds fill the plaza while preserving all animal slots and both feeding elders`, () => {
  const h = fixture(quality);
  try {
    const at = { x: -336, y: 0, z: 108 }, s = h.run(at, 8), humans = s.states.filter(a => a.kind === 'human');
    assert.equal(s.stats.counts.human, quality === 'mobile' ? 24 : 32);
    assert.deepEqual({ dog: s.stats.counts.dog, cat: s.stats.counts.cat, rat: s.stats.counts.rat }, { dog: 4, cat: 5, rat: 7 });
    assert.ok(s.stats.count <= (quality === 'mobile' ? 40 : 48));
    assert.ok(humans.filter(a => Math.hypot(a.x - at.x, a.z - at.z) < 30).length >= 6);
    assert.ok(humans.some(a => a.humanRole === 'grandmother') && humans.some(a => a.humanRole === 'grandfather'));
    assert.ok(humans.every(a => !a.humanOutfit));
    assert.equal(s.modelStats.drawCalls, 4);
  } finally { h.bridge.dispose(); }
});

test('palace visitors carry hanbok into frozen snapshots, renderer and source-time events without changing role/gender', () => {
  const h = fixture();
  try {
    const s = h.run({ x: -331, y: 0, z: -482 }), humans = s.states.filter(a => a.kind === 'human');
    assert.equal(humans.length, 24);
    assert.ok(humans.every(a => a.humanOutfit === 'hanbok' && a.routeId.includes(':palace:')));
    assert.ok(humans.some(a => a.humanGender === 'female') && humans.some(a => a.humanGender === 'male'));
    assert.ok(humans.every(a => a.foodSequence !== undefined));
    assert.ok(h.events.filter(e => e.type === 'spawn').every(e => e.state.humanOutfit === 'hanbok' && Object.isFrozen(e.state)));
    const layer = createNpcModelLayer(new THREE.Scene(), 48);
    try {
      for (const gender of ['female', 'male']) {
        layer.sync(Array.from({ length: 48 }, (_, i) => ({ ...humans[0], id: `hanbok-${i}`, humanGender: gender, humanRole: 'walker', variant: i % 8 })));
        for (const mesh of layer.root.children) assert.ok(mesh.count <= mesh.instanceMatrix.count, mesh.name);
      }
    } finally { layer.dispose(); }
  } finally { h.bridge.dispose(); }
});

test('hanbok female silhouette has a full skirt and collar/tie while ordinary street clothes stay unchanged', () => {
  const base = { kind: 'human', humanGender: 'female', humanRole: 'walker', action: 'idle', variant: 0, age: 0, gaitDistance: 0, speed: 0, bodyScale: 1 };
  function parts(state) { const parts = []; paintPose(state, { part: (...v) => parts.push(v), link() {} }); return parts; }
  const normal = parts(base), hanbok = parts({ ...base, humanOutfit: 'hanbok' });
  assert.ok(hanbok.some(p => p[0] === 'taper' && p[4] >= .5 && p[5] >= 1));
  assert.ok(!normal.some(p => p[0] === 'taper' && p[4] >= .5 && p[5] >= 1));
  assert.equal(hanbok.filter(p => p[7] === 0xfff5df).length, 2);
});

test('walking from the starting plaza into the palace eventually replaces distant crowds with hanbok visitors', () => {
  const h = fixture();
  try {
    h.run({ x: -336, y: 0, z: 108 }, 5);
    for (let z = 100; z >= -480; z -= 20) h.run({ x: -330, y: 0, z }, 1);
    const s = h.run({ x: -331, y: 0, z: -482 }, 5);
    assert.ok(s.states.filter(a => a.humanOutfit === 'hanbok').length >= 12);
    assert.ok(s.states.every(a => isSpawnClear(h.layout, a, PROFILES[a.kind].radius, PROFILES[a.kind].height)));
  } finally { h.bridge.dispose(); }
});
