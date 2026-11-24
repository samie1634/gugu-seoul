import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SPECIES} from '../src/species-core/appearance.ts';
import {defaultBuildRig,measureOriginRig} from '../src/species-core/assets.ts';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {createHeronFishing} from '../src/native/heron-fishing.ts';
import {createStreetFlock} from '../src/native/street-flock.ts';

for(const species of SPECIES)test(`${species} has flight, ground peck, opponent jab and ground locomotion`,()=>{
  const rig=defaultBuildRig({species,lod:1}),eye=new THREE.Vector3();
  const pose=extra=>{rig.pose({mode:'rest',time:0,steps:0,flapAge:10,...extra});return rig.getEyeWorldPosition(eye).clone();};
  const rest=pose({}),ground=pose({peckAge:.22}),jab=pose({opponentPeckAge:.18});
  assert.ok(rest.distanceTo(ground)>.015);assert.ok(rest.distanceTo(jab)>.015);assert.ok(ground.distanceTo(jab)>.015);
  pose({mode:'flap',flapAge:.03});const up=rig.model.pivots.leftWing.quaternion.clone();pose({mode:'flap',flapAge:.16});assert.ok(up.angleTo(rig.model.pivots.leftWing.quaternion)>.10);
  pose({mode:'walk',steps:.075});assert.ok([rig.model.pivots.leftFoot.position.y,rig.model.pivots.rightFoot.position.y,...eye].every(Number.isFinite));
  rig.dispose();
});

test('sparrow locomotion uses matching feet and only a low hop, never alternating walking feet',()=>{
  const rig=defaultBuildRig({species:'sparrow',lod:0}),stance=rig.model.root.parent;
  let maxLift=0;
  for(let i=0;i<150;i++){
    rig.pose({mode:'walk',time:i/50,steps:i*.005,flapAge:10});maxLift=Math.max(maxLift,stance.position.y);
    assert.ok(Math.abs(rig.model.pivots.leftFoot.position.y-rig.model.pivots.rightFoot.position.y)<1e-9);
    assert.ok(Math.abs(rig.model.pivots.leftFoot.position.z-rig.model.pivots.rightFoot.position.z)<1e-9);
  }
  assert.ok(maxLift>.001&&maxLift<.01);rig.dispose();
});

for(const lod of [0,1,2])test(`heron LOD${lod} has valid native anatomy and sole origin`,()=>{
  const rig=defaultBuildRig({species:'heron',lod});const measured=measureOriginRig(rig);
  assert.ok(Math.abs(measured.feet.min[1])<1e-6);assert.ok(measured.body.heightM>=1);assert.ok(rig.model.root.getObjectByName('heron-neck'));
  assert.ok(rig.model.root.getObjectByName('upper-beak'));assert.ok(rig.model.metrics.wingspanM>1.5);rig.dispose();
});

for(const data of [undefined,'osm'])test(`heron slowly stalks, physically contacts, carries and eats fish on ${data??'procedural'} water`,()=>{
  const scene=new THREE.Scene(),fishing=createHeronFishing(scene,makeMapLayout({data,terrain:'sunken-channel'}));
  assert.equal(fishing.count,6);let previous=fishing.snapshot().birds[0],sawCarry=false;
  for(let i=0;i<700;i++){
    fishing.update(.05);const current=fishing.snapshot(),at=current.birds[0];
    if(current.action==='walk')assert.ok(Math.hypot(at.x-previous.x,at.z-previous.z)<=.085*.05+1e-8);
    if(current.fish.some(f=>f.caught&&!f.eaten))sawCarry=true;
    previous=at;
  }
  const result=fishing.snapshot();assert.equal(result.catches,5);assert.equal(sawCarry,true);
  assert.ok(result.events.filter(e=>e.type==='fish-caught').every(e=>e.distance<=.11));
  assert.ok(result.fish.filter(f=>f.prey).every(f=>f.eaten));fishing.dispose();assert.equal(scene.children.length,0);
});

test('interrupted fish strike releases a carried fish, takes flight, and resumes after returning',()=>{
  const fishing=createHeronFishing(new THREE.Scene(),makeMapLayout({data:'osm'}));
  for(let i=0;i<200&&!fishing.snapshot().fish.some(f=>f.caught&&!f.eaten);i++)fishing.update(.05);
  const at=fishing.snapshot().birds[0];assert.ok(fishing.snapshot().fish.some(f=>f.caught&&!f.eaten));
  fishing.update(.05,{x:at.x+1,y:at.y+1,z:at.z,species:'kestrel'});
  assert.equal(fishing.snapshot().action,'flee');assert.equal(fishing.snapshot().fish.some(f=>f.caught&&!f.eaten),false);
  for(let i=0;i<800;i++)fishing.update(.05);
  assert.ok(fishing.snapshot().catches>0);fishing.dispose();
});

for(const species of SPECIES)test(`${species} player front peck respects contact and immediate kestrel escape`,()=>{
  const flock=createStreetFlock(new THREE.Scene(),makeMapLayout({data:'osm'}));
  const pigeon=flock.snapshot().birds.find(b=>b.species==='pigeon');
  // A walking target can move during the contact animation; start within reach.
  const player={x:pigeon.x,y:pigeon.y,z:pigeon.z+.20,heading:0,species,peckAge:.05};
  assert.equal(flock.playerPeckKind(player),'opponent');flock.update(.05,player);
  flock.update(.05,{...player,peckAge:.1});flock.update(.05,{...player,peckAge:.15});
  const expected=species==='kestrel'?0:1;
  assert.equal(flock.snapshot().playerInteractions.hits,expected);
  assert.equal(flock.snapshot().birds.find(b=>b.id===pigeon.id).whiteFeathers,expected===1);
  if(species==='kestrel')assert.equal(flock.snapshot().birds.find(b=>b.id===pigeon.id).action,'flee');
  flock.update(.05,{...player,peckAge:.2});assert.equal(flock.snapshot().playerInteractions.hits,expected);flock.dispose();
});

test('no target behind the bird or beyond contact reach causes an opponent jab',()=>{
  const flock=createStreetFlock(new THREE.Scene(),makeMapLayout({data:'osm'}));const at=flock.snapshot().birds[0];
  assert.equal(flock.playerPeckKind({...at,z:at.z+.6,heading:0,peckAge:.05}),'ground');
  assert.equal(flock.playerPeckKind({...at,z:at.z-.29,heading:0,peckAge:.05}),'ground');flock.dispose();
});

for(const species of SPECIES)test(`${species} can contact-peck a front animal without attacking from behind`,()=>{
  let hits=0;const flock=createStreetFlock(new THREE.Scene(),makeMapLayout({data:'osm'}),{onAnimalPeck:()=>{hits++;return true;}});
  const player={x:-330,y:0,z:100,species,heading:0,peckAge:.05},dog={id:'test-dog',kind:'dog',x:-330,y:0,z:99.75};
  assert.equal(flock.playerPeckKind(player,[dog]),'opponent');
  flock.update(.05,player,[dog]);flock.update(.05,{...player,peckAge:.15},[dog]);assert.equal(hits,1);flock.dispose();
});
