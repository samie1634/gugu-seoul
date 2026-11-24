import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NpcSystem} from '../src/native/ported/npcs/runtime/simulation.ts';
const route={id:'walk',kinds:['human'],points:[{x:0,z:0},{x:12,z:0}],loop:false};
function setup(block=false){return new NpcSystem({routes:[route],spawnZones:[{id:'plaza',routeId:'walk',kinds:['human'],center:{x:6,z:0},radius:20,capacity:6}],groundAt:()=>({height:0,walkable:true,surface:'stone'}),canTraverse:(a,b)=>!block||Math.hypot(a.x-b.x,a.z-b.z)<.3},{seed:12,limits:{human:6,dog:0,cat:0,rat:0},spawnMinDistance:0,spawnMaxDistance:50,despawnDistance:100});}
test('humans mutually converse, stop feet, face partner, resume and interrupt safely',()=>{
 const n=setup();let pair;
 for(let i=0;i<400&&!pair;i++){n.update(.05,{observer:{x:6,y:0,z:4}});pair=n.snapshot().find(s=>s.action==='talk');}
 assert.ok(pair,'actual simulation must produce conversation');
 let states=n.snapshot();const mate=states.find(s=>s.id===pair.talkPartnerId);assert.equal(mate.talkPartnerId,pair.id);assert.equal(mate.action,'talk');
 const before=states.find(s=>s.id===pair.id);
 for(let i=0;i<15;i++)n.update(.05,{observer:{x:6,y:0,z:4}});
 const after=n.snapshot().find(s=>s.id===pair.id);assert.equal(after.gaitDistance,before.gaitDistance);assert.equal(after.x,before.x);assert.equal(after.z,before.z);assert.equal(after.speed,0);
 n.update(.1,{observer:{x:6,y:0,z:4},stimuli:[{id:'peck',type:'sudden-motion',position:{x:after.x,y:.8,z:after.z},radius:.1,halfHeight:.2,speed:10}]});
 states=n.snapshot();assert.notEqual(states.find(s=>s.id===pair.id).action,'talk');
 for(let i=0;i<220;i++)n.update(.05,{observer:{x:6,y:0,z:4}});
 assert.ok(n.snapshot().every(s=>Number.isFinite(s.x)&&Number.isFinite(s.heading)));
 n.dispose();assert.equal(n.snapshot().length,0);
});
test('obstructed humans never talk through a wall',()=>{
 const n=setup(true);for(let i=0;i<300;i++){n.update(.05,{observer:{x:6,y:0,z:4}});assert.ok(n.snapshot().every(s=>s.action!=='talk'));}n.dispose();
});

test('talk pose retains both sole contacts and finite geometry while head/hands move',async()=>{
 const {paintPose}=await import('../src/native/ported/npcs/models/pose.ts');let previous;
 for(const age of [0,.5,1,2]){
  let region;const soles=[],geometry=[];
  paintPose({kind:'human',variant:0,action:'talk',speed:0,gaitDistance:0,age,bodyScale:1},{region(v){region=v;},link(...values){assert.ok(values.every(Number.isFinite));geometry.push(values);},part(shape,x,y,z,w,h,d,color,pitch=0){assert.ok([x,y,z,w,h,d,color,pitch].every(Number.isFinite));if(region==='limbs'&&shape==='block')soles.push(y-Math.abs(Math.cos(pitch))*h/2-Math.abs(Math.sin(pitch))*d/2);}});
  assert.equal(soles.length,2);assert.ok(soles.every(y=>Math.abs(y)<1e-8));
  if(previous)assert.notDeepEqual(previous,geometry);previous=geometry;
 }
});
