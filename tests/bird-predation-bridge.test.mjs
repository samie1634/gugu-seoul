import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNativeNpcBridge} from '../src/native/npc-bridge.ts';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {createBirdBehavior,makeFlockBird} from '../src/native/bird-behavior.ts';

test('owl contact captures an actual live rat while distant, invalid and non-rat captures are rejected',()=>{
  const bridge=createNativeNpcBridge(new THREE.Scene(),makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}));
  const player={x:-37,y:.1125,z:8,vx:0,vy:0,vz:0,body:{horizontalRadiusM:.173,heightM:.225},flap:false,coo:false};
  for(let frame=1;frame<=100;frame++)bridge.commit({frame,simTime:frame/10,acceptedSeconds:.1,playing:true},player,player);
  const states=bridge.snapshot().states,rat=states.find(n=>n.kind==='rat'),human=states.find(n=>n.kind==='human');
  assert.ok(rat);assert.ok(human);
  assert.equal(bridge.captureRat(human.id,human),false);
  assert.equal(bridge.captureRat(rat.id,{...rat,x:NaN}),false);
  assert.equal(bridge.captureRat(rat.id,{...rat,x:rat.x+1}),false);
  const owl=makeFlockBird('owl','eagle-owl',{x:rat.x,y:rat.y+.1,z:rat.z});
  const behavior=createBirdBehavior([owl],{groundAt:()=>0,canMove:()=>true,perches:[],crumbs:[],captureRat:(id,at)=>bridge.captureRat(id,at)});
  behavior.update(.025,undefined,[{...rat,kind:'rat'}]);
  assert.equal(owl.caught,1);assert.ok(!bridge.snapshot().states.some(n=>n.id===rat.id));
  const events=bridge.commit({frame:101,simTime:10.1,acceptedSeconds:.1,playing:true},player,player);
  assert.ok(events.some(e=>e.type==='despawn'&&e.npcId===rat.id));
  bridge.dispose();
});
