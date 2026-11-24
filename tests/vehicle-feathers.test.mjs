import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVehicleFeathers } from '../src/native/vehicle-feathers.ts';

const hit = (id = 'hit:1', time = 1, overrides = {}) => ({ id, time, position: { x: 12, y: .2, z: -18 }, velocity: { x: 14, y: 6, z: 2 }, groundY: 0, ...overrides });
function setup(t, quality = 'mobile', reducedMotion = false) {
  const parent = new THREE.Scene(), effect = createVehicleFeathers(parent, { quality, reducedMotion });
  t.after(() => effect.dispose());
  return { parent, effect, mesh: effect.root };
}
const arrays = mesh => ({ matrix: [...mesh.instanceMatrix.array], alpha: [...mesh.geometry.attributes.featherAlpha.array] });

test('feathers are one bounded instanced gray/white mesh with finite notched vanes and quills', t => {
  for (const quality of ['mobile', 'desktop']) {
    const { parent, effect, mesh } = setup(t, quality);
    assert.equal(parent.children.length, 1); assert.equal(mesh.isInstancedMesh, true); assert.equal(mesh.visible, false);
    assert.equal(effect.snapshot().maxParticles, quality === 'mobile' ? 96 : 160);
    assert.equal(mesh.count, effect.snapshot().maxParticles);
    assert.equal(mesh.material.side, THREE.DoubleSide); assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.map, undefined); assert.ok(mesh.geometry.attributes.position.count < 120);
    for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok([...attribute.array].every(Number.isFinite));
    assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
    const position = mesh.geometry.attributes.position;
    const vertices = Array.from({ length: position.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(position, index));
    assert.ok(Math.min(...vertices.map(p => p.y)) < -.5, 'the pale quill extends below the vane');
    assert.ok(new Set(vertices.map(p => p.x)).size >= 12, 'the outline has feather notches, not a quad or point');
    for (let i = 0; i < vertices.length; i += 3) {
      const a = vertices[i + 1].clone().sub(vertices[i]), b = vertices[i + 2].clone().sub(vertices[i]);
      assert.ok(a.cross(b).length() > 1e-9, `non-degenerate triangle ${i / 3}`);
    }
    const color = new THREE.Color();
    for (let i = 0; i < mesh.count; i++) { mesh.getColorAt(i, color); assert.ok(Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) < .15); }
  }
});

test('a committed hit starts exactly at contact, inherits velocity, floats, settles and remains on the floor', t => {
  const { effect } = setup(t);
  assert.equal(effect.burst(hit()), true);
  let state = effect.snapshot(); assert.equal(state.spawned, 1); assert.equal(state.activeParticles, 24);
  for (const p of state.particles) assert.deepEqual([p.x, p.y, p.z, p.age], [12, .2, -18, 0]);
  effect.update(1.2); state = effect.snapshot();
  for (const p of state.particles) { assert.ok(p.x > 12.3); assert.ok(p.y > .2); assert.equal(p.settled, false); }
  effect.update(3.8); const landed = effect.snapshot();
  assert.ok(landed.particles.every(p => p.settled && Math.abs(p.y - .012) < 1e-6));
  assert.ok(landed.particles.every(p => p.alpha === 1));
  effect.update(3.9);
  const later = effect.snapshot();
  for (let i = 0; i < later.particles.length; i++) assert.deepEqual([later.particles[i].x, later.particles[i].y, later.particles[i].z], [landed.particles[i].x, landed.particles[i].y, landed.particles[i].z]);
  effect.update(3600); assert.equal(effect.snapshot().activeParticles, 24); assert.equal(effect.snapshot().visible, true);
});

test('active-time pause and invalid updates leave every visible particle and GPU buffer unchanged', t => {
  const { effect, mesh } = setup(t);
  effect.burst(hit()); effect.update(1.4);
  const state = effect.snapshot(), buffers = arrays(mesh), version = mesh.instanceMatrix.version;
  for (let i = 0; i < 1000; i++) effect.update(1.4);
  for (const time of [NaN, Infinity, -Infinity, -1]) effect.update(time);
  assert.deepEqual(effect.snapshot(), state); assert.deepEqual(arrays(mesh), buffers); assert.equal(mesh.instanceMatrix.version, version);
  effect.update(1.5); assert.notDeepEqual(effect.snapshot(), state);
});

test('preview-only time updates never create feathers and duplicate hit IDs never replay', t => {
  const { effect } = setup(t);
  for (let i = 0; i < 60; i++) effect.update(i / 60);
  assert.equal(effect.snapshot().spawned, 0); assert.equal(effect.snapshot().activeParticles, 0);
  const event = hit(); assert.equal(effect.burst(event), true);
  const state = effect.snapshot();
  assert.equal(effect.burst(event), false); assert.equal(effect.burst({ ...event, time: 2 }), false);
  assert.deepEqual(effect.snapshot(), state);
  effect.update(6); assert.equal(effect.burst(event), false); assert.equal(effect.snapshot().spawned, 1);
});

test('particle buffers and replay history remain bounded under repeated collisions', t => {
  for (const quality of ['mobile', 'desktop']) {
    const { effect, mesh } = setup(t, quality), geometry = mesh.geometry, material = mesh.material;
    const matrices = mesh.instanceMatrix.array, alpha = geometry.attributes.featherAlpha.array;
    for (let i = 0; i < 600; i++) {
      assert.equal(effect.burst(hit(`hit:${i}`, 1 + i * .01)), true);
      const state = effect.snapshot(); assert.ok(state.activeParticles <= state.maxParticles); assert.ok(state.rememberedIds <= 128);
    }
    assert.equal(effect.snapshot().spawned, 600); assert.equal(effect.snapshot().activeParticles, effect.snapshot().maxParticles);
    assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.equal(mesh.instanceMatrix.array, matrices); assert.equal(geometry.attributes.featherAlpha.array, alpha);
    assert.equal(effect.burst(hit('hit:0', 1)), false, 'an evicted old event is still rejected by the clock watermark');
    for (const time of [7.5, 8, 9, 12, 1000]) {
      effect.update(time); assert.ok([...matrices].every(Number.isFinite)); assert.ok([...alpha].every(a => a >= 0 && a <= 1));
      for (const p of effect.snapshot().particles) assert.ok([p.x, p.y, p.z, p.alpha, p.age].every(Number.isFinite));
    }
    assert.equal(effect.snapshot().activeParticles, effect.snapshot().maxParticles);
  }
});

test('malformed and unreasonable events do not mutate the effect or consume IDs', t => {
  const { effect, mesh } = setup(t), before = effect.snapshot(), buffers = arrays(mesh);
  for (const event of [null, {}, hit('', 1), hit('x'.repeat(257), 1), hit('bad', NaN), hit('bad', -1),
    hit('bad', 1, { position: null }), hit('bad', 1, { velocity: {} }), hit('bad', 1, { groundY: Infinity }),
    hit('bad', 1, { position: { x: NaN, y: .2, z: 0 } }), hit('bad', 1, { velocity: { x: Infinity, y: 0, z: 0 } }),
    hit('bad', 1, { position: { x: 1e20, y: .2, z: 0 } }), hit('bad', 1, { velocity: { x: 1e20, y: 0, z: 0 } }),
    hit('bad', 1, { groundY: 2 }), hit('bad', 1, { groundY: -1000 })]) assert.equal(effect.burst(event), false);
  assert.deepEqual(effect.snapshot(), before); assert.deepEqual(arrays(mesh), buffers);
  assert.equal(effect.burst(hit('bad')), true);
  const current = effect.snapshot(); assert.equal(effect.burst(hit('old', .5)), false); assert.deepEqual(effect.snapshot(), current);
});

test('large valid velocities stay spatially bounded and never push a feather below its ground', t => {
  const { effect, mesh } = setup(t, 'desktop');
  const event = hit('fast', 0, { velocity: { x: 9999, y: 9999, z: -9999 } });
  effect.burst(event);
  for (let i = 0; i <= 250; i++) {
    effect.update(i / 60);
    for (const p of effect.snapshot().particles) {
      assert.ok(Math.hypot(p.x - event.position.x, p.z - event.position.z) < 4);
      assert.ok(p.y >= .012 && p.y < 3);
    }
    assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
  }
});

test('reduced motion uses fewer feathers, shorter travel and fixed flat orientations', t => {
  const { effect, mesh } = setup(t, 'desktop', true);
  assert.equal(effect.snapshot().reducedMotion, true); assert.equal(effect.snapshot().maxParticles, 24);
  effect.burst(hit()); assert.equal(effect.snapshot().activeParticles, 6);
  effect.update(2.5);
  for (const p of effect.snapshot().particles) { assert.ok(p.settled); assert.ok(Math.abs(p.x - 12) < .6); }
  const matrix = new THREE.Matrix4(), normal = new THREE.Vector3();
  for (let i = 0; i < 4; i++) { mesh.getMatrixAt(i, matrix); normal.set(0, 0, 1).transformDirection(matrix); assert.ok(Math.abs(normal.y) > .999); }
});

test('clear and clock reset remove old feathers and permit a fresh session; disposal is idempotent', t => {
  const { parent, effect, mesh } = setup(t);
  effect.burst(hit()); effect.clear(); assert.equal(effect.snapshot().activeParticles, 0); assert.equal(effect.snapshot().rememberedIds, 0); assert.equal(mesh.visible, false);
  assert.equal(effect.burst(hit()), true);
  effect.update(.1); assert.equal(effect.snapshot().activeParticles, 0); assert.equal(effect.snapshot().rememberedIds, 0);
  assert.equal(effect.burst(hit('hit:1', .2)), true);
  const disposed = [];
  for (const [resource, name] of [[mesh, 'instance'], [mesh.geometry, 'geometry'], [mesh.material, 'material']]) resource.addEventListener('dispose', () => disposed.push(name));
  effect.dispose(); effect.dispose(); effect.clear(); effect.update(20);
  assert.deepEqual(disposed, ['instance', 'geometry', 'material']); assert.equal(parent.children.length, 0);
  assert.equal(effect.burst(hit('later', 20)), false); assert.equal(effect.snapshot().activeParticles, 0); assert.equal(effect.snapshot().visible, false);
});

test('floor feathers remain through long play without re-uploading settled GPU matrices', t => {
  const {effect,mesh}=setup(t);effect.burst(hit());effect.update(20);
  const before=effect.snapshot(),buffers=arrays(mesh),matrixVersion=mesh.instanceMatrix.version,alphaVersion=mesh.geometry.attributes.featherAlpha.version;
  for(let i=0;i<1000;i++)effect.update(20+i*60);
  const after=effect.snapshot();assert.equal(after.activeParticles,24);assert.ok(after.particles.every(p=>p.settled&&p.alpha===1));
  assert.deepEqual(after.particles.map(p=>[p.x,p.y,p.z]),before.particles.map(p=>[p.x,p.y,p.z]));
  assert.deepEqual(arrays(mesh),buffers);assert.equal(mesh.instanceMatrix.version,matrixVersion);assert.equal(mesh.geometry.attributes.featherAlpha.version,alphaVersion);
});
test('only the oldest of four bursts is recycled and a high-altitude hit reaches the floor', t => {
  const {effect}=setup(t);
  for(let i=0;i<5;i++){effect.burst(hit(`retained:${i}`,i*10));effect.update(i*10+8);}
  let state=effect.snapshot();assert.equal(state.activeParticles,96);
  assert.deepEqual([...new Set(state.particles.map(p=>p.id))].sort(),['retained:1','retained:2','retained:3','retained:4']);
  assert.equal(effect.burst(hit('high',60,{position:{x:0,y:99,z:0},groundY:0})),true);effect.update(180);
  state=effect.snapshot();assert.ok(state.particles.every(p=>p.settled&&p.y===.012));
});
