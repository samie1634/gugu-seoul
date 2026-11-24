import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBirdBehavior, makeFlockBird } from '../src/native/bird-behavior.ts';
import { makePigeonCrown, updatePigeonCrown, pigeonCrownStage } from '../src/native/pigeon-crown.ts';

const world = { groundAt: () => 0, canMove: () => true, perches: [], crumbs: [] };
const advance = sim => { for (let i = 0; i < 28; i++) sim.update(.025); };
test('every pigeon hit retreats by foot including fifth and later, with independent crow counter', () => {
  const victim = makeFlockBird('victim', 'pigeon', { x: .2, y: 0, z: 0 });
  const sim = createBirdBehavior([victim], world);
  for (let hits = 1; hits <= 7; hits++) {
    const source = { x: victim.x - .2, y: 0, z: victim.z, species: 'pigeon' };
    const previousX = victim.x;
    assert.equal(sim.receivePeck(victim.id, source), true);
    assert.equal(victim.peckHits, hits); assert.equal(victim.crowPeckHits, 0);
    assert.equal(pigeonCrownStage(victim.peckHits), Math.min(hits, 5));
    assert.equal(victim.action, 'retreat'); assert.equal(victim.airborne, false);
    advance(sim); assert.ok(victim.x > previousX + .5); assert.equal(victim.y, 0);
  }
  for (let crowHits = 1; crowHits <= 5; crowHits++) {
    assert.equal(sim.receivePeck(victim.id, { x: victim.x - .2, y: 0, z: victim.z, species: 'crow' }), true);
    assert.equal(victim.crowPeckHits, crowHits);
    assert.equal(victim.action, crowHits === 5 ? 'flee' : 'retreat');
    if (crowHits < 5) advance(sim);
  }
});
test('overlapping attackers still produce a finite walking-away direction', () => {
  const v = makeFlockBird('p', 'pigeon', { x: 0, y: 0, z: 0 });
  const sim = createBirdBehavior([v], world);
  sim.receivePeck('p', { x: 0, y: 0, z: 0, heading: 0, species: 'pigeon' }); advance(sim);
  assert.ok(Math.hypot(v.x, v.z) > .5); assert.ok([v.x, v.y, v.z].every(Number.isFinite));
});
test('NPC pigeons use opponent jab at contact and target walks away, never a remote hit', () => {
  const a = makeFlockBird('a', 'pigeon', { x: 0, y: 0, z: 0 }); a.cooldown = 0;
  const b = makeFlockBird('b', 'pigeon', { x: .25, y: 0, z: 0 });
  const sim = createBirdBehavior([a, b], world); sim.update(.025);
  assert.equal(a.peckKind, 'opponent'); assert.equal(a.action, 'attack');
  for (let i = 0; i < 8; i++) sim.update(.025);
  assert.equal(b.peckHits, 1); assert.equal(b.action, 'retreat'); assert.equal(b.airborne, false);
  assert.equal(sim.receivePeck('b', { x: 99, y: 0, z: 0, species: 'pigeon' }), false);
});
test('crown grows in five distinct stages and then saturates without whitening the body', () => {
  const geometry = new THREE.SphereGeometry(1, 6, 4), material = new THREE.MeshStandardMaterial({ color: '#f4f2e9' });
  const crown = makePigeonCrown(geometry, material), counts = [];
  for (let hit = 0; hit <= 6; hit++) {
    updatePigeonCrown(crown, hit); counts.push(crown.children.filter(c => c.visible).length);
    assert.equal(crown.visible, hit > 0);
  }
  assert.deepEqual(counts, [0, 2, 5, 8, 11, 15, 15]);
  assert.ok(crown.children.every(c => c.position.y > .05 && c.scale.x < .003));
  for (const bad of [-1, NaN, Infinity]) assert.equal(pigeonCrownStage(bad), 0);
  geometry.dispose(); material.dispose();
});
