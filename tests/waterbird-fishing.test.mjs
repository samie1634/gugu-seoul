import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMapLayout, sampleGround, sampleWater } from '../src/native/ported/map/layout.ts';
import { createHeronFishing } from '../src/native/heron-fishing.ts';
import { createDuckPond } from '../src/native/duck-pond.ts';

for (const options of [{data:'osm'}, {terrain:'sunken-channel'}]) test(`waterbirds contact, carry and eat one shared stock: ${JSON.stringify(options)}`, () => {
  const scene = new THREE.Scene(), layout = makeMapLayout(options), herons = createHeronFishing(scene, layout), school = herons.schools;
  const ducks = createDuckPond(scene, layout, undefined, school);
  const carried = new Set();
  try {
    for (let frame = 0; frame < 2400; frame++) {
      herons.update(.05); ducks.update(.05);
      for (const fish of school.fish) if (fish.caught && !fish.eaten && fish.reservedBy) {
        carried.add(fish.reservedBy);
        const bird = scene.getObjectByName(fish.reservedBy);
        const bill = bird.getObjectByName('upper-beak') ?? bird.getObjectByName('duck-bill-tip') ?? bird.getObjectByName('call-duck-bill-nail');
        const tip = bill.name === 'upper-beak' ? bill.localToWorld(new THREE.Vector3(0,.235/2,0)) : bill.getWorldPosition(new THREE.Vector3());
        assert.ok(fish.mesh.position.distanceTo(tip) < 1e-7, 'the original fish mesh is attached to the actual bill');
      }
      if (frame % 20 === 0) for (const bird of ducks.snapshot().birds) {
        const ground = sampleGround(layout, bird.x, bird.z);
        assert.ok(sampleWater(layout, bird.x, ground.y, bird.z), 'duck stays over real water');
        if (bird.plumage === 'duckling') assert.equal(bird.fishing, undefined);
      }
    }
    assert.equal(school.fish.length, 41);
    assert.equal(herons.snapshot().catches, 5, 'primary heron retains its five prey');
    const events = school.snapshot().events, eaten = events.filter(e => e.type === 'fish-eaten');
    assert.ok(eaten.some(e => e.birdId.startsWith('street-bird:heron:stream:')));
    assert.ok(eaten.some(e => e.birdId.startsWith('street-bird:duck:')));
    assert.ok([...carried].some(id => id.includes('heron:stream:')));
    assert.ok([...carried].some(id => id.includes('duck:')));
    assert.equal(new Set(eaten.map(e => `${e.targetId}:${e.generation}`)).size, eaten.length, 'no duplicate consumption');
    for (const caught of events.filter(e => e.type === 'fish-caught')) assert.ok(caught.distance <= (caught.birdId.includes('heron:') ? .11 : .075));
    assert.ok(school.snapshot().remaining >= 12);
    for (const species of new Set(school.fish.map(f => f.species))) assert.ok(school.fish.filter(f => f.species === species && !f.eaten).length >= 2);
    for (const id of new Set(eaten.map(e => e.birdId))) {
      const times = eaten.filter(e => e.birdId === id).map(e => e.time);
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i-1] > 20);
    }
  } finally { ducks.dispose(); herons.dispose(); assert.equal(scene.children.length, 0); }
});

test('predator interruption releases adult duck reservations and preserves escape/family behavior', () => {
  const scene = new THREE.Scene(), layout = makeMapLayout({data:'osm'}), herons = createHeronFishing(scene,layout), ducks = createDuckPond(scene,layout,undefined,herons.schools);
  try {
    let target;
    for(let i=0;i<1400&&!target;i++) {
      herons.update(.05);ducks.update(.05);
      target=herons.schools.fish.find(f=>f.caught&&!f.eaten&&f.reservedBy?.includes('duck:'));
    }
    assert.ok(target);
    const id=target.reservedBy, bird=ducks.snapshot().birds.find(d=>d.id===id);
    ducks.update(.05,{...bird,species:'kestrel'});
    assert.equal(target.reservedBy,undefined);assert.equal(target.caught,false);assert.equal(target.held,false);
    assert.equal(ducks.snapshot().birds.find(d=>d.id===id).action,'escape');
    assert.equal(ducks.snapshot().birds.filter(d=>d.plumage==='duckling').length,6);
  } finally { ducks.dispose();herons.dispose(); }
});

test('shared stock rejects remote contact, duplicate owners, and unbounded depletion', () => {
  const scene=new THREE.Scene(),herons=createHeronFishing(scene,makeMapLayout({data:'osm'})),school=herons.schools;
  try {
    const fish=school.fish.find(f=>!f.prey&&f.species!=='common-carp');
    const claimed=school.claim('bird-a',fish,.01);assert.equal(claimed,fish);
    assert.equal(school.claim('bird-b',fish,.01),undefined);
    assert.equal(school.contact('bird-a',fish,new THREE.Vector3(999,999,999),.075),false);
    assert.equal(school.contact('bird-b',fish,new THREE.Vector3(fish.x,fish.y,fish.z),.075),false);
    school.release('bird-a',fish);assert.equal(fish.reservedBy,undefined);
    for(const f of school.fish){const target=school.claim('bird-a',f,.01);if(!target)continue;assert.ok(school.contact('bird-a',target,new THREE.Vector3(target.x,target.y,target.z),.075));assert.ok(school.eat('bird-a',target));assert.equal(school.eat('bird-a',target),false);school.release('bird-a',target);}
    assert.ok(school.fish.filter(f=>!f.prey&&!f.eaten).length>=12);
    assert.ok(school.fish.filter(f=>f.prey).every(f=>!f.eaten));
  } finally {herons.dispose();}
});


test('consumed school slots renew over long sessions without duplication or primary prey renewal', () => {
  const scene = new THREE.Scene(), herons = createHeronFishing(scene, makeMapLayout({data:'osm'})), school = herons.schools;
  const meshes = new Set(school.fish.map(f => f.mesh));
  try {
    const fish = school.fish.find(f => !f.prey && f.species !== 'common-carp');
    const consume = () => {
      assert.equal(school.claim('test-bird', fish, .01), fish);
      assert.ok(school.contact('test-bird', fish, new THREE.Vector3(fish.x, fish.y, fish.z), .075));
      assert.ok(school.eat('test-bird', fish)); school.release('test-bird', fish);
    };
    const primary = school.fish.find(f => f.prey); primary.eaten = true; primary.eatenAt = 0;
    for (let cycle = 0; cycle < 4; cycle++) {
      consume();
      for (let i = 0; i < 899; i++) school.update(.1);
      assert.equal(fish.eaten, true, 'no early renewal');
      for (let i = 0; i < 620; i++) school.update(.1);
      assert.equal(fish.eaten, false); assert.equal(fish.generation, cycle + 1);
      assert.equal(fish.reservedBy, undefined); assert.equal(fish.caught, false); assert.equal(fish.held, false);
      assert.equal(school.fish.length, 41); assert.ok(school.fish.every(f => meshes.has(f.mesh)));
      assert.equal(primary.eaten, true); assert.equal(primary.generation, 0);
    }
    assert.equal(school.snapshot().renewals, 4);
    assert.equal(school.snapshot().events.filter(e => e.type === 'fish-returned').length, 4);
  } finally { herons.dispose(); }
});

test('renewal waits for observer to leave, reservation release, and full home-envelope clearance', () => {
  const scene = new THREE.Scene(), herons = createHeronFishing(scene, makeMapLayout({data:'osm'})), school = herons.schools;
  try {
    const fish = school.fish.find(f => !f.prey && f.species !== 'common-carp');
    assert.equal(school.claim('test-bird', fish, .01), fish);
    school.contact('test-bird', fish, new THREE.Vector3(fish.x, fish.y, fish.z), .075); school.eat('test-bird', fish);
    const observer = {x:fish.homeX,y:fish.y,z:fish.homeZ,species:'pigeon'};
    for (let i = 0; i < 1600; i++) school.update(.1, undefined, observer);
    assert.equal(fish.eaten, true); assert.equal(fish.mesh.visible, false);
    school.update(.1, undefined, {...observer,x:observer.x+100});
    assert.equal(fish.eaten, true, 'reserved slots cannot renew even off screen');
    school.release('test-bird', fish);
    for (let i = 0; i < 100; i++) school.update(.1, undefined, observer);
    assert.equal(fish.eaten, true, 'no on-screen resurrection after cooldown');
    const homeX = fish.homeX; fish.homeX = 1e9;
    school.update(.1); assert.equal(fish.eaten, true, 'unverified home cannot renew');
    fish.homeX = homeX;
    school.update(.1, undefined, {...observer,x:observer.x+71});
    assert.equal(fish.eaten, false); assert.equal(fish.generation, 1); assert.equal(fish.mesh.visible, false);
    school.update(.1, undefined, observer); assert.equal(fish.mesh.visible, true);
  } finally {herons.dispose();}
});


test('autonomous waterbirds keep fishing after the initial catchable school has been used', () => {
  const scene = new THREE.Scene(), layout = makeMapLayout({data:'osm'}), herons = createHeronFishing(scene,layout), school = herons.schools, ducks = createDuckPond(scene,layout,undefined,school);
  try {
    const catches = () => herons.snapshot().birds.reduce((n,b) => n+(b.fishing?.catches??0),0) + ducks.snapshot().birds.reduce((n,b) => n+(b.fishing?.catches??0),0);
    for(let i=0;i<3000;i++){herons.update(.05);ducks.update(.05);}
    const first = catches(); assert.ok(first > 5);
    for(let i=0;i<4000;i++){herons.update(.05);ducks.update(.05);}
    assert.ok(catches() > first + 3); assert.ok(school.snapshot().renewals > 0);
    assert.equal(school.fish.length,41); assert.equal(herons.snapshot().catches,5);
    assert.ok(school.snapshot().remaining >= 12);
  } finally {ducks.dispose();herons.dispose();}
});

test('each species keeps two non-primary fish even when primary heron fishing is delayed', () => {
  const scene = new THREE.Scene(), herons = createHeronFishing(scene, makeMapLayout({ data: 'osm' })), school = herons.schools;
  try {
    // Auxiliary birds get first access without modifying primary fish or the heron's state.
    for (const fish of school.fish) {
      const target = school.claim('reserve-probe', fish, .01); if (!target) continue;
      assert.ok(school.contact('reserve-probe', target, new THREE.Vector3(target.x, target.y, target.z), .075));
      assert.ok(school.eat('reserve-probe', target)); school.release('reserve-probe', target);
    }
    for (const species of new Set(school.fish.map(f => f.species))) {
      assert.ok(school.fish.filter(f => f.species === species && !f.prey && !f.eaten).length >= 2, species);
    }
    const observer = { ...herons.snapshot().birds[0], species: 'pigeon' };
    for (let i = 0; i < 1600; i++) herons.update(.05, observer);
    assert.equal(herons.snapshot().catches, 5); assert.equal(school.snapshot().renewals, 0);
    for (const species of new Set(school.fish.map(f => f.species))) {
      assert.ok(school.fish.filter(f => f.species === species && !f.eaten).length >= 2, species);
    }
  } finally { herons.dispose(); }
});
