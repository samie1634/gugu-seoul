import { CHEONGGYE_LEVELS as levels } from '../src/native/ported/map/real-map/cheonggye-channel.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWaterSplash } from '../src/native/water-splash.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { nativeNear } from '../src/native/body-profile.ts';
import { createMapCandidate } from '../src/native/ported/map/candidate.ts';
import { sampleGround } from '../src/native/ported/map/layout.ts';

const neutral={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};
function prepare(scene, input=neutral, mode='third') {
  const lens={near:nativeNear(scene.state.body,59,390/844),verticalFovDegrees:59,aspect:390/844};
  return scene.prepare(input,1/60,lens,mode,100+scene.state.time,false);
}
function step(scene,input=neutral,mode='third') {
  const p=prepare(scene,input,mode);assert.equal(p.kind,'ready',p.reason);p.commit();scene.world.update(scene.state.time,1/60);
}

test('splash particles are bounded, short-lived, finite and disposable without altering water geometry',()=>{
  const parent=new THREE.Group(),splash=createWaterSplash(parent),points=parent.children[0];
  assert.ok(points.isPoints);assert.equal(parent.children.length,1);assert.equal(points.visible,false);
  const position=points.geometry.attributes.position.array,alpha=points.geometry.attributes.alpha.array;
  for(let i=0;i<20;i++)assert.equal(splash.add({x:1,y:.02,z:2},i*.01),true);
  assert.equal(splash.snapshot().spawned,20);assert.ok(splash.snapshot().activeParticles<=64);
  splash.update(.3);assert.ok(splash.snapshot().activeParticles>0);
  assert.ok([...position].every(Number.isFinite));assert.ok([...alpha].every(v=>v>=0&&v<=1));
  assert.equal(points.geometry.attributes.position.array,position);assert.equal(points.geometry.attributes.alpha.array,alpha);
  splash.update(2);assert.equal(points.visible,false);assert.equal(splash.snapshot().activeParticles,0);
  splash.add({x:0,y:0,z:0},3);splash.update(1);assert.equal(points.visible,false);
  assert.equal(splash.add({x:NaN,y:0,z:0},1),false);
  const disposed=[];points.geometry.addEventListener('dispose',()=>disposed.push('geometry'));points.material.addEventListener('dispose',()=>disposed.push('material'));
  splash.dispose();splash.dispose();assert.equal(parent.children.length,0);assert.deepEqual(disposed,['geometry','material']);
  assert.equal(splash.add({x:0,y:0,z:0},4),false);
});

test('OSM entry metadata waits for actual water contact and does not repeat while resting',()=>{
  const map=createMapCandidate({data:'osm',quality:'mobile'});
  try{
    const at={id:'test',x:-170,y:levels.water+.1+.1125,z:420,centreToSole:.1125,radius:.1,grounded:false};
    assert.deepEqual(map.observeActor(at,1),[]);
    const entered=map.observeActor({...at,y:levels.water-.06+.1125},2);
    assert.equal(entered.filter(e=>e.type==='water-enter').length,1);
    for(let i=3;i<20;i++)assert.equal(map.observeActor({...at,y:levels.water-.06+.1125},i).filter(e=>e.type==='water-enter').length,0);
    assert.equal(map.observeActor({...at,y:1},20).filter(e=>e.type==='water-exit').length,1);
  }finally{map.dispose();}
});

for(const mode of ['third','first'])test(`actual OSM ${mode}-person entry commits one splash, floats and takes off without a blocked frame`,()=>{
  const parent=new THREE.Scene(),scene=createNativeScene(parent,'pigeon',{mapData:'osm',quality:'mobile',spawnForTest:()=>({feet:{x:-170,y:2,z:420},heading:0})});
  try{
    for(let i=0;i<120;i++)step(scene,neutral,mode);
    let s=scene.snapshot();assert.equal(s.waterSplash.spawned,1);assert.equal(s.state.mode,'rest');assert.equal(s.lastFailure,null);
    assert.ok(Math.abs(s.sole.y-(levels.water-.06))<1e-8);const x=s.sole.x,z=s.sole.z;
    for(let i=0;i<60;i++)step(scene,{...neutral,forward:1,turn:.4,accelerate:true},mode);
    s=scene.snapshot();assert.equal(s.sole.x,x);assert.equal(s.sole.z,z);assert.equal(s.waterSplash.spawned,1);
    assert.equal(s.waterSplash.visible,false);assert.equal(s.state.mode,'rest');
    step(scene,{...neutral,flapPressed:true,flapHeld:true},mode);assert.ok(scene.state.vy>0);
    // A pigeon now moves forward on takeoff. Face along the water and actively
    // descend after the impulse to test a second water contact, not hovering.
    for(let i=0;i<180;i++)step(scene,{...neutral,descend:true},mode);
    assert.equal(scene.snapshot().waterSplash.spawned,2);assert.equal(scene.snapshot().lastFailure,null);
  }finally{scene.dispose();}
  assert.equal(parent.getObjectByName('player-water-splash'),undefined);
});

test('a preview that reaches water never emits particles until the frame commits',()=>{
  const scene=createNativeScene(new THREE.Scene(),'pigeon',{mapData:'osm',quality:'mobile',spawnForTest:()=>({feet:{x:-170,y:levels.water+.001,z:420},heading:0})});
  try{
    const p=prepare(scene);assert.equal(p.kind,'ready');assert.equal(scene.snapshot().waterSplash.spawned,0);
    const winner=prepare(scene);assert.equal(winner.kind,'ready');winner.commit();assert.equal(scene.snapshot().waterSplash.spawned,1);
    assert.throws(()=>p.commit(),/Stale/);assert.equal(scene.snapshot().waterSplash.spawned,1);
    assert.equal(scene.home(),true);assert.equal(scene.snapshot().waterSplash.visible,false);
  }finally{scene.dispose();}
});

test('walking on an actual OSM bridge emits no water splash',()=>{
  const scene=createNativeScene(new THREE.Scene(),'pigeon',{mapData:'osm',quality:'mobile',spawnForTest:()=>({feet:{x:-106.77666666666666,y:0,z:428.91873333333336},heading:0})});
  try{
    assert.equal(sampleGround(scene.map.layout,scene.state.x,scene.state.z).zone,'bridge');
    assert.equal(scene.snapshot().water,null);
    for(let i=0;i<20;i++)step(scene);
    assert.equal(scene.snapshot().waterSplash.spawned,0);
  }finally{scene.dispose();}
});
