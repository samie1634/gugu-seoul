import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNativeMotionState,advanceNativeMotion,nativeFeet} from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import {createInputState,reduceInput,sampleInput} from '../src/input-reducer.ts';
import {createSpeciesActor} from '../src/species-core/actor.ts';
import {NORMAL_FLIGHT_TUNING,FED_FLIGHT_TUNING} from '../src/native/flight-feeding.ts';
const support={id:'ground',layerId:'ground',height:0,normal:{x:0,y:1,z:0},surface:'stone',walkable:true,landable:true};
const world={supportAt:p=>p.at.y<=p.maxDropM+1e-8&&p.previousFeetY>=-1e-8?support:null,sweepBody:()=>null};
const neutral={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false,accelerate:false};
function trajectory(ratio,hold,step=1/60,tuning=NORMAL_FLIGHT_TUNING,extra={}){
 let s=createNativeMotionState({feet:{x:0,y:0,z:0},shortTapHeightRatio:ratio,tuning}),peak=0,flaps=0;const frames=[];
 for(let i=0;i<Math.ceil(2/step);i++){
  const input={...neutral,...extra,flapPressed:i===0,flapHeld:i*step<hold-1e-9};
  const result=advanceNativeMotion(s,input,step,world);assert.equal(result.status,'advanced');s=result.state;
  flaps+=result.events.filter(e=>e.type==='flap').length;peak=Math.max(peak,nativeFeet(s).y);frames.push(s);
 }
 return{peak,flaps,frames};
}
for(const step of [1/240,1/60,1/30,.05,.1])for(const hold of [0,.05,.1,.15])test(`tap ${hold}s at dt=${step} respects sampled duration and height`,()=>{
 const full=trajectory(1,hold,step),half=trajectory(.5,hold,step);
 // A 100 ms simulation frame can only observe a release at its next boundary.
 if(Math.ceil((hold-1e-9)/step)*step>.1500001){assert.equal(half.peak,full.peak);assert.equal(half.flaps,1);return;}
 assert.ok(Math.abs(half.peak/full.peak-.5)<.01,`${half.peak}/${full.peak}`);assert.equal(half.flaps,1);
});
for(const hold of [.2,.24,.5,1.2])test(`hold ${hold}s preserves every old position, velocity, mode and event count`,()=>{
 const full=trajectory(1,hold),half=trajectory(.5,hold);assert.equal(full.flaps,half.flaps);
 for(let i=0;i<full.frames.length;i++)for(const key of ['x','y','z','vx','vy','vz','mode','heldSeconds','flaps','flapAge','boostSeconds'])assert.equal(half.frames[i][key],full.frames[i][key],key);
});
test('food speeds and Shift acceleration are unchanged; quick flap remains half height',()=>{
 for(const tuning of [NORMAL_FLIGHT_TUNING,FED_FLIGHT_TUNING])for(const accelerate of [false,true]){
  const full=trajectory(1,.1,1/60,tuning,{accelerate}),half=trajectory(.5,.1,1/60,tuning,{accelerate});
  assert.ok(Math.abs(half.peak/full.peak-.5)<.005);
  for(let i=0;i<12;i++)for(const key of ['vx','vz','boostSeconds'])assert.equal(half.frames[i][key],full.frames[i][key]);
 }
});
test('C descent cancels the short release adjustment and keeps unpowered freefall identical',()=>{
 let a=createNativeMotionState({shortTapHeightRatio:1,feet:{x:0,y:10,z:0}}),b=createNativeMotionState({shortTapHeightRatio:.5,feet:{x:0,y:10,z:0}});
 for(let i=0;i<20;i++){
  const input={...neutral,flapPressed:i===0,flapHeld:i<3,descend:i>=3};
  a=advanceNativeMotion(a,input,1/60,world).state;b=advanceNativeMotion(b,input,1/60,world).state;
  for(const key of ['y','vy','vx','vz','mode'])assert.equal(b[key],a[key]);
 }
});
test('keyboard and touch completed taps, including taps between frames, use identical short-flight controls',()=>{
 const gate={enabled:true,focused:true,hidden:false,paused:false};
 for(const heldFrame of [false,true]){
  const inputs=[];
  for(const kind of ['key','touch']){
   let state=createInputState(gate);
   state=reduceInput(state,kind==='key'?{type:'key-down',code:'Space',repeat:false}:{type:'pointer-down',id:1,control:'flap'}).state;
   const sequence=[];if(heldFrame){const sample=sampleInput(state);state=sample.state;sequence.push(sample.input);}
   state=reduceInput(state,kind==='key'?{type:'key-up',code:'Space'}:{type:'pointer-up',id:1,control:'flap'}).state;
   sequence.push(sampleInput(state).input);inputs.push(sequence);
  }
  assert.deepEqual(inputs[0],inputs[1]);assert.equal(inputs[0][0].flapPressed,true);
 }
});
test('the actor enables half-height taps only for pigeon appearances',()=>{
 const worldWithCamera={...world,sphereClear:()=>true,sweepSphere:()=>null};
 for(const legacyLook of ['pigeon','white','owl']){
  const actor=createSpeciesActor(new THREE.Scene(),{world:worldWithCamera,legacyLook,feet:{x:0,y:0,z:0}});
  try{assert.equal(actor.snapshot().state.shortTapHeightRatio,legacyLook==='owl'?1:.5);}finally{actor.dispose();}
 }
});
test('repeated taps add one wingbeat each and keep finite, collision-checked motion',()=>{
 let s=createNativeMotionState({feet:{x:0,y:0,z:0},shortTapHeightRatio:.5}),flaps=0,sweeps=0;
 const checked={...world,sweepBody:()=>{sweeps++;return null;}};
 for(let i=0;i<300;i++){
  const phase=i%20,result=advanceNativeMotion(s,{...neutral,flapPressed:phase===0,flapHeld:phase<4},1/60,checked);
  assert.equal(result.status,'advanced');s=result.state;assert.ok([s.x,s.y,s.z,s.vx,s.vy,s.vz].every(Number.isFinite));
  flaps+=result.events.filter(e=>e.type==='flap').length;
 }
 assert.equal(flaps,15);assert.ok(sweeps>300);
});
test('failed world query rolls back the short-tap state along with the whole frame',()=>{
 const state=createNativeMotionState({feet:{x:0,y:0,z:0},shortTapHeightRatio:.5}),before=structuredClone(state);
 const result=advanceNativeMotion(state,{...neutral,flapPressed:true,flapHeld:false},.05,{...world,sweepBody:()=>undefined});
 assert.equal(result.status,'blocked');assert.deepEqual(state,before);assert.deepEqual(result.state,before);assert.deepEqual(result.events,[]);
});
