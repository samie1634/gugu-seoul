import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputState, reduceInput, sampleInput } from '../src/input-reducer.ts';
import { createNativeMotionState, advanceNativeMotion } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
const gate={enabled:true,focused:true,hidden:false,paused:false,dialogOpen:false};
const down=(s,code)=>reduceInput(s,{type:'key-down',code,repeat:false});
test('C descends, Shift accelerates and F coos',()=>{
  const c=down(createInputState(gate),'KeyC');assert.equal(sampleInput(c.state).input.descend,true);assert.equal(c.command,null);
  const shift=down(createInputState(gate),'ShiftLeft');assert.equal(sampleInput(shift.state).input.accelerate,true);assert.equal(sampleInput(shift.state).input.descend,false);
  assert.equal(down(createInputState(gate),'KeyF').command,'coo');
});
test('holding Shift with a direction progressively increases airborne speed',()=>{
  let state=createNativeMotionState({feet:{x:0,y:100,z:0}});state.grounded=false;state.mode='fall';
  const world={supportAt:()=>null,sweepBody:()=>null};
  const input={forward:1,turn:0,flapPressed:false,flapHeld:false,descend:false,accelerate:true};
  for(let i=0;i<10;i++){const out=advanceNativeMotion(state,input,0.1,world);assert.equal(out.status,'advanced');state=out.state;}
  const first=Math.hypot(state.vx,state.vz);
  for(let i=0;i<10;i++){const out=advanceNativeMotion(state,input,0.1,world);assert.equal(out.status,'advanced');state=out.state;}
  assert.ok(Math.hypot(state.vx,state.vz)>first+1);
});
