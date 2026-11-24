import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBirdBehavior, makeFlockBird, OPPONENT_PECK_DISTANCE } from '../src/native/bird-behavior.ts';
const make = (id, species, x = 0, z = 0, y = 0) => makeFlockBird(id, species, { x, y, z });
const world = (extra = {}) => ({ groundAt: () => 0, canMove: () => true, perches: [], crumbs: [], ...extra });
const advance = (sim, seconds, observer, rats) => { for (let i = 0; i < Math.round(seconds / .025); i++) sim.update(.025, observer, rats); };

test('pigeons and sparrows stay calm and still next to each other and either player species', () => {
  const birds = [make('p', 'pigeon'), make('s', 'sparrow', .1)];
  const sim = createBirdBehavior(birds, world());
  advance(sim, 3, { x: 0, y: 0, z: 0, species: 'pigeon' });
  advance(sim, 3, { x: 0, y: 0, z: 0, species: 'sparrow' });
  assert.deepEqual(birds.map(b => [b.action, b.x, b.z]), [['idle', 0, 0], ['idle', .1, 0]]);
  assert.equal(sim.snapshot().events.length, 0);
});

test('crow pecks only at contact, pigeon walks away after each hit and flies on fifth hit', () => {
  const crow = make('c', 'crow'), pigeon = make('p', 'pigeon', .27);
  const sim = createBirdBehavior([crow, pigeon], world());
  let lastHits = 0, previousX = pigeon.x;
  for (let i = 0; i < 1600 && pigeon.peckHits < 5; i++) {
    sim.update(.025);
    if (pigeon.peckHits > lastHits) {
      assert.equal(pigeon.action, pigeon.peckHits === 5 ? 'flee' : 'retreat');
      if (pigeon.peckHits > 1) assert.ok(pigeon.x > previousX);
      lastHits = pigeon.peckHits; previousX = pigeon.x;
    }
  }
  assert.equal(pigeon.peckHits, 5); assert.equal(pigeon.whiteFeathers, true);
  assert.equal(pigeon.airborne, true);
  const hits = sim.snapshot().events.filter(e => e.type === 'peck');
  assert.equal(hits.length, 5); assert.ok(hits.every(e => e.distance <= OPPONENT_PECK_DISTANCE));
});

test('target escaping between attack start and contact receives no remote peck', () => {
  const crow = make('c', 'crow'), pigeon = make('p', 'pigeon', .27); crow.cooldown = 0;
  const sim = createBirdBehavior([crow, pigeon], world()); sim.update(.025);
  assert.equal(crow.action, 'attack'); pigeon.x = 4;
  advance(sim, .3); assert.equal(pigeon.peckHits, 0); assert.equal(sim.snapshot().events.length, 0);
});

test('crows and magpies fight at contact, not pigeons with sparrows', () => {
  const c = make('c', 'crow'), m = make('m', 'magpie', .27); c.cooldown = m.cooldown = 0;
  const sim = createBirdBehavior([c, m], world()); advance(sim, 8);
  const hits = sim.snapshot().events.filter(e => e.type === 'peck');
  assert.ok(hits.some(e => e.actorId === 'c')); assert.ok(hits.some(e => e.actorId === 'm'));
});

test('each feeding species consumes a visible crumb with a ground peck', () => {
  for (const species of ['pigeon', 'sparrow', 'crow', 'magpie']) {
    const bird = make(species, species); bird.cooldown = 0;
    const crumb = { id: 'crumb', x: 0, y: 0, z: -.12, eaten: false };
    const sim = createBirdBehavior([bird], world({ crumbs: [crumb] }));
    sim.update(.025); assert.equal(bird.action, 'feed'); assert.equal(bird.peckKind, 'ground');
    advance(sim, .3); assert.equal(crumb.eaten, true); assert.equal(bird.eaten, 1);
  }
});

test('nearby kestrel including player makes every other species take flight', () => {
  for (const species of ['pigeon', 'sparrow', 'crow', 'magpie', 'tawny-owl', 'eagle-owl']) {
    const bird = make('b', species), sim = createBirdBehavior([bird], world());
    sim.update(.025, { x: 1, y: 2, z: 1, species: 'kestrel' });
    assert.equal(bird.action, 'flee', species); assert.equal(bird.airborne, true); assert.ok(bird.y > 0);
  }
});

test('owl species pursue sparrows and contact-catch rats through verified bridge', () => {
  for (const species of ['tawny-owl', 'eagle-owl']) {
    const bird = make('o', species, 0, 0, .1), sparrow = make('s', 'sparrow', 4);
    const sim = createBirdBehavior([bird, sparrow], world()); sim.update(.025);
    assert.equal(bird.action, 'hunt'); assert.equal(bird.targetId, 's');
    let captured = null;
    const hunter = make('hunter', species, 0, 0, .1), rat = { id: 'rat', kind: 'rat', x: .05, y: 0, z: 0 };
    const hunt = createBirdBehavior([hunter], world({ captureRat: (id) => { captured = id; return true; } }));
    hunt.update(.025, undefined, [rat]); assert.equal(captured, 'rat'); assert.equal(hunter.caught, 1);
    assert.equal(hunt.snapshot().events[0].type, 'catch');
  }
});

test('corvids regroup and settle on both wire and roof slots', () => {
  for (const kind of ['wire', 'roof']) {
    const birds = [make('c1', 'crow'), make('c2', 'crow', 5), make('c3', 'crow', 6)];
    const perches = birds.map((_, i) => ({ id: `perch:${i}`, kind, x: i * .7, y: 3, z: -1 }));
    const sim = createBirdBehavior(birds, world({ perches })); advance(sim, 6);
    assert.ok(Math.abs(birds[0].x - birds[2].x) < 4, 'group converges');
    advance(sim, 13);
    assert.ok(birds.every(b => b.action === 'perch'));
    assert.ok(birds.every(b => Math.abs(b.y - 3) < .04));
  }
});

test('blocked movement never advances position and invalid clock never advances behavior', () => {
  const crow = make('c', 'crow'), pigeon = make('p', 'pigeon', 1); crow.cooldown = 0;
  const sim = createBirdBehavior([crow, pigeon], world({ canMove: () => false }));
  advance(sim, 3); assert.equal(crow.x, 0); assert.equal(pigeon.peckHits, 0);
  const time = sim.time; for (const dt of [-1, 0, Infinity, NaN, .2]) sim.update(dt);
  assert.equal(sim.time, time);
});
