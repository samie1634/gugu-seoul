import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';
import { createStreetFlock } from '../src/native/street-flock.ts';

test('street flock contains all eight existing species and both duck families and disposes cleanly',()=>{
  const scene=new THREE.Scene();
  const flock=createStreetFlock(scene,makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}));
  assert.equal(flock.count,49);
  flock.update(0.05,{x:-39,z:3});
  for(const species of ['pigeon','sparrow','crow','magpie','tawny-owl','eagle-owl','kestrel','heron','duck']) assert.ok((()=>{let found=false;scene.traverse(child=>{if(child.name.startsWith(`street-bird:${species}:`))found=true;});return found;})());
  flock.dispose(); assert.equal(scene.children.length,0);
});

test('real map flock reaches supported roof corners and wire slots, eats crumbs and reacts to kestrel visits',()=>{
  const scene=new THREE.Scene(),flock=createStreetFlock(scene,makeMapLayout({data:'osm'}));
  const seen=new Set(),actions=new Set(),landings=new Set();
  for(let i=0;i<2600;i++){
    flock.update(.05,{x:-336,y:0,z:108,species:'pigeon'});
    const snapshot=flock.snapshot();
    for(const bird of snapshot.birds){
      assert.ok([bird.x,bird.y,bird.z,bird.heading].every(Number.isFinite));
      actions.add(bird.action);
      const model=scene.getObjectByName(bird.id);assert.equal(model.visible,bird.visible);
      if(bird.whiteFeathers) assert.equal(model.getObjectByName('pecked-white-crown').visible,true);
    }
    for(const event of snapshot.events){seen.add(event.type);if(event.type==='perch')landings.add(event.targetId.split(':')[0]);}
  }
  assert.ok(['eat','peck','catch','escape','perch'].every(type=>seen.has(type)));
  assert.deepEqual([...landings].sort(),['roof','wire']);
  assert.ok(actions.has('fly-to-perch'));assert.ok(actions.has('flee'));
  const roofs=flock.snapshot().perches.filter(p=>p.kind==='roof');assert.ok(roofs.every(p=>p.y>=3));
  flock.dispose();assert.equal(scene.children.length,0);
});

test('a nearby simultaneous pigeon departure emits one flock cue, never a per-frame replay', () => {
  const layout = makeMapLayout({ data: 'osm' }), flock = createStreetFlock(new THREE.Scene(), layout);
  try {
    const origin = flock.snapshot().feedingGround;
    assert.equal(flock.pigeonFlockTakeoffSequence, 0);
    flock.update(.05, { ...origin, y: origin.y + 2, species: 'kestrel' });
    assert.equal(flock.pigeonFlockTakeoffSequence, 1);
    for (let i = 0; i < 30; i++) flock.update(.05, { ...origin, y: origin.y + 2, species: 'kestrel' });
    assert.equal(flock.pigeonFlockTakeoffSequence, 1);
    flock.update(0, { ...origin, species: 'kestrel' }); assert.equal(flock.pigeonFlockTakeoffSequence, 1);
  } finally { flock.dispose(); }
});

test('readiness change cannot consume a second crumb for the same accepted floor tap', () => {
  const layout=makeMapLayout({data:'osm'}), flock=createStreetFlock(new THREE.Scene(),layout);
  try {
    const [first,second]=flock.snapshot().crumbs.slice(0,2);
    const frame=(crumb,peckAge,floorContactAge)=>flock.update(.05,
      { x:crumb.x, y:crumb.y, z:crumb.z, species:'pigeon', heading:0, peckAge, floorContactAge });
    frame(first,.01,undefined);
    frame(first,.22,undefined);
    assert.equal(flock.playerEaten,1);
    frame(second,.35,.455);
    frame(second,.46,.455);
    assert.equal(flock.playerEaten,1,'late model readiness does not move the active hit threshold');
    frame(second,.01,.455);
    frame(second,.22,.455);
    assert.equal(flock.playerEaten,1,'new ready input waits for the first authored contact');
    frame(second,.46,.455);
    assert.equal(flock.playerEaten,2);
  } finally { flock.dispose(); }
});
