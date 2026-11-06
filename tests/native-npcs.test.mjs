import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNativeScene} from '../src/native/scene.ts';
import {createNativeNpcBridge} from '../src/native/npc-bridge.ts';
import {transactNativeFrame} from '../src/native/frame-transaction.ts';
import {createFrameClock} from '../src/frame-clock.ts';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {createMapQueries} from '../src/native/ported/motion/locomotion/b2/map-queries.ts';
import {PROFILES} from '../src/native/ported/npcs/src/profiles.ts';
import {worldAnchors} from '../src/native/ported/npcs/models/index.ts';
import {paintPose} from '../src/native/ported/npcs/models/pose.ts';
import {nativeNear} from '../src/native/body-profile.ts';

const layout=()=>makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'});
const idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function setup(t,options={}){
  const parent=new THREE.Scene(),scene=createNativeScene(parent,'pigeon',{quality:'mobile',sessionId:'native-npc-test',...options});
  const projection={near:nativeNear(scene.state.body,59,16/9),verticalFovDegrees:59,aspect:16/9};
  t.after(()=>scene.dispose());
  function step(dt=.1,input=idle){const ticket=scene.prepare(input,dt,projection,'third',10+scene.state.time+dt,false);assert.equal(ticket.kind,'ready');ticket.commit();return scene.snapshot();}
  return{scene,parent,projection,step};
}
const player={x:-37,y:.1125,z:8,vx:0,vy:0,vz:0,body:{horizontalRadiusM:.173,heightM:.225},flap:false,coo:false};

test('actual scene replaces the static reference with native-scale humans/dogs/cats/rats on reviewed routes',t=>{
  const h=setup(t);let s;
  for(let i=0;i<100;i++)s=h.step();
  assert.deepEqual(Object.keys(s.npcs.stats.counts).filter(k=>s.npcs.stats.counts[k]>0).sort(),['cat','dog','human','rat']);
  assert.equal(h.parent.children.filter(o=>o.name==='npc-models').length,1);
  assert.equal(s.npcs.routes.length,39);assert.equal(s.npcs.spawnZones.length,5);assert.equal(s.npcs.excludedEdges.filter(e=>e.reason==='traffic').length,4);
  assert.equal(s.npcs.modelStats.capacity,48);assert.deepEqual(s.npcs.rootScale,[1,1,1]);
  near(s.npcs.stats.time,s.state.time);assert.equal(s.npcs.acceptedCommits,100);assert.equal(s.npcs.drains,100);assert.equal(s.npcs.syncs,100);
  for(const a of s.npcs.states){
    assert.equal(a.bodyScale,1);assert.notEqual(a.id,'b2:reference-human');assert.notEqual(a.surface,'asphalt');assert.notEqual(a.surface,'water');
    const sample=h.scene.map.layout;
    assert.ok(sample.navEdges.some(e=>a.routeId===`map-edge:${e.a}->${e.b}`&&!e.requiresTrafficCheck&&e.kind!=='crossing'));
    const anchors=worldAnchors(a);assert.deepEqual(anchors.sole,{x:a.x,y:a.y,z:a.z});assert.ok(anchors.eye.y>a.y);
  }
});

test('bridge accepts one shared commit, performs both fixed steps once, and rejects paused/replayed/backdated time without RNG changes',t=>{
  const parent=new THREE.Scene(),map=layout(),a=createNativeNpcBridge(parent,map,100),b=createNativeNpcBridge(new THREE.Scene(),map,100);
  t.after(()=>{a.dispose();b.dispose();});
  const first={frame:1,simTime:100.1,acceptedSeconds:.1,playing:true};
  assert.deepEqual(a.commit(first,player,player),b.commit(first,player,player));
  near(a.snapshot().stats.time,.1);assert.equal(a.snapshot().drains,1);assert.equal(a.snapshot().syncs,1);
  const before=a.snapshot();
  for(const clock of [first,{...first,frame:0},{...first,frame:2,simTime:99},{...first,frame:2,simTime:100.2,playing:false},{...first,frame:2,acceptedSeconds:0},{...first,frame:2,simTime:100.15}])assert.deepEqual(a.commit(clock,player,{...player,flap:true}),[]);
  assert.deepEqual(a.snapshot(),before);
  for(let i=2;i<=100;i++){
    const clock={frame:i,simTime:100+i/10,acceptedSeconds:.1,playing:true};
    assert.deepEqual(a.commit(clock,player,player),b.commit(clock,player,player));
  }
  assert.deepEqual(a.snapshot(),b.snapshot());near(a.snapshot().stats.time,10);
});

test('uncommitted, stale, late-camera-rejected and inactive app frames never advance NPC state/events/RNG/model buffers',t=>{
  const map=createMapQueries(layout());let unavailable=false;
  const h=setup(t,{world:{...map,sphereClear:(...args)=>unavailable?undefined:map.sphereClear(...args)}});
  const control=setup(t);
  h.step();control.step();const before=h.scene.snapshot().npcs;
  const pending=h.scene.prepare(idle,.1,h.projection,'third',10.2,false);
  assert.equal(pending.kind,'ready');assert.deepEqual(h.scene.snapshot().npcs,before);
  const winner=h.scene.prepare(idle,.1,h.projection,'third',10.2,false);winner.commit();control.step();
  const committed=h.scene.snapshot().npcs;assert.throws(()=>pending.commit(),/Stale/);assert.deepEqual(h.scene.snapshot().npcs,committed);
  unavailable=true;assert.equal(h.scene.prepare({...idle,flapPressed:true},.1,h.projection,'third',10.3,false).kind,'blocked');
  assert.deepEqual(h.scene.snapshot().npcs,committed);
  let clock=createFrameClock({enabled:true,focused:true,hidden:false,paused:false,dialogOpen:false});
  const controls={preview:()=>({input:idle,isCurrent:()=>false,commit:()=>{throw Error('stale input consumed');}})};
  clock=transactNativeFrame(clock,0,controls,()=>{throw Error('zero dt prepared');}).clock;
  unavailable=false;const tick=transactNativeFrame(clock,100,controls,(input,dt)=>h.scene.prepare(input,dt,h.projection,'third',10.3,false));
  assert.equal(tick.status,'blocked');assert.equal(tick.reason,'stale-proposal');assert.deepEqual(h.scene.snapshot().npcs,committed);
  for(let i=0;i<30;i++){h.step();control.step();}
  assert.deepEqual(h.scene.snapshot().npcs,control.scene.snapshot().npcs);
});

test('a short committed flap survives a sub-step but no duplicate drain or stale signal reaches later fixed steps',t=>{
  const a=createNativeNpcBridge(new THREE.Scene(),layout());t.after(()=>a.dispose());
  a.commit({frame:1,simTime:.016,acceptedSeconds:.016,playing:true},player,{...player,flap:true});
  assert.equal(a.snapshot().pendingSignal,'flap');near(a.snapshot().stats.time,0);
  a.commit({frame:2,simTime:.032,acceptedSeconds:.016,playing:true},player,player);assert.equal(a.snapshot().pendingSignal,'flap');
  a.commit({frame:3,simTime:.05,acceptedSeconds:.018,playing:true},player,player);
  assert.equal(a.snapshot().pendingSignal,null);near(a.snapshot().stats.time,.05);assert.equal(a.snapshot().drains,3);
  const before=a.snapshot();a.commit({frame:3,simTime:.05,acceptedSeconds:.018,playing:true},player,{...player,flap:true});assert.deepEqual(a.snapshot(),before);
});

test('canonical NPC cues keep one source-time state/feet/voice and stable session IDs through later motion and disposal',t=>{
  let fixtureFeet=null;
  const h=setup(t,{spawnForTest:(_preset,original)=>fixtureFeet?{feet:fixtureFeet,heading:0}:original});for(let i=0;i<25;i++)h.step();
  const target=h.scene.snapshot().npcs.states.find(a=>a.kind==='dog');assert.ok(target);
  fixtureFeet={x:target.x,y:target.y,z:target.z+.1};assert.equal(h.scene.home(),true);
  h.step(.1,{...idle,flapPressed:true});
  const cues=h.scene.events.filter(e=>e.producer==='npc');
  assert.ok(cues.some(e=>e.type==='npc-reaction'));const vocal=cues.find(e=>e.type==='npc-audio'&&e.cue==='dog-bark');assert.ok(vocal);
  assert.deepEqual(vocal.position,worldAnchors(vocal.npcState).voice);assert.ok(Object.isFrozen(vocal.npcState));
  assert.equal(vocal.actorId,vocal.npcState.id);assert.equal(vocal.sourceId,'npc-stream');near(vocal.simTime,vocal.npcLocalTime);
  const retained=JSON.stringify(vocal);const ids=new Set();let sequence=0;
  for(let i=0;i<80;i++){
    const s=h.step();for(const e of h.scene.events){assert.ok(!ids.has(e.id));ids.add(e.id);assert.ok(e.seq>sequence);sequence=e.seq;assert.equal(e.sessionId,'native-npc-test');}
    for(const e of s.events.filter(e=>e.type==='npc-audio'&&(e.cue==='footstep'||e.cue==='rustle'))){assert.deepEqual(e.position,{x:e.npcState.x,y:e.npcState.y,z:e.npcState.z});assert.ok(e.simTime<=s.state.time+1e-8);}
  }
  h.scene.dispose();assert.equal(JSON.stringify(vocal),retained);assert.deepEqual(worldAnchors(vocal.npcState).voice,vocal.position);
  const final=h.scene.snapshot().npcs;assert.equal(final.stats.disposed,true);assert.equal(final.stats.queuedEvents,0);assert.ok(final.recentEvents.some(e=>e.type==='despawn'&&e.reason==='dispose'));
  h.scene.dispose();assert.deepEqual(h.scene.snapshot().npcs,final);
});

test('50 shared seconds keep original human event contact phase on the actual map and retain the fixed-step clock remainder',t=>{
  const a=createNativeNpcBridge(new THREE.Scene(),layout(),0,{limits:{human:1,dog:0,cat:0,rat:0},seed:9911,lifetimeSeconds:[1000,1000]});t.after(()=>a.dispose());
  let cues=0;
  for(let i=1;i<=500;i++){
    const events=a.commit({frame:i,simTime:i/10,acceptedSeconds:.1,playing:true},player,player);
    for(const e of events.filter(e=>e.type==='audio'&&e.cue==='footstep')){
      cues++;const half=PROFILES.human.stride/2;const phase=e.state.gaitDistance-Math.floor((e.state.gaitDistance+1e-9)/half)*half;
      assert.ok(phase>=-1e-8&&phase<=PROFILES.human.walkSpeed*.05+1e-8);
      let region;const soles=[];paintPose(e.state,{region(v){region=v;},link(){},part(shape,x,y,z,w,h,d,color,pitch=0){if(region==='limbs'&&shape==='block')soles.push(y-Math.abs(Math.cos(pitch))*h/2-Math.abs(Math.sin(pitch))*d/2);}});
      assert.ok(soles.some(y=>Math.abs(y)<1e-8));
    }
  }
  assert.ok(cues>20);near(a.snapshot().stats.time,50);assert.equal(a.snapshot().acceptedCommits,500);assert.equal(a.snapshot().stats.droppedSeconds,0);
});

test('home/appearance changes keep the NPC owner and a disposed scene releases only its own instance resources',t=>{
  const h=setup(t);for(let i=0;i<25;i++)h.step();
  const root=h.parent.getObjectByName('npc-models'),before=h.scene.snapshot().npcs;
  assert.equal(h.scene.home('white'),true);assert.equal(h.scene.selectLook('owl'),true);assert.deepEqual(h.scene.snapshot().npcs,before);assert.equal(h.parent.getObjectByName('npc-models'),root);
  let geometryDisposes=0,materialDisposes=0,meshDisposes=0;const materials=new Set();
  root.traverse(o=>{if(o instanceof THREE.InstancedMesh){o.addEventListener('dispose',()=>meshDisposes++);o.geometry.addEventListener('dispose',()=>geometryDisposes++);materials.add(o.material);}});
  for(const material of materials)material.addEventListener('dispose',()=>materialDisposes++);
  h.scene.dispose();assert.equal(root.parent,null);assert.equal(geometryDisposes,4);assert.equal(materialDisposes,1);assert.equal(meshDisposes,4);
  h.scene.dispose();assert.equal(geometryDisposes,4);
  const replacement=createNativeScene(h.parent,'pigeon',{quality:'mobile',sessionId:'replacement'});t.after(()=>replacement.dispose());
  assert.equal(h.parent.children.filter(o=>o.name==='npc-models').length,1);assert.equal(replacement.snapshot().npcs.states.length,0);assert.equal(replacement.snapshot().npcs.stats.time,0);
});
