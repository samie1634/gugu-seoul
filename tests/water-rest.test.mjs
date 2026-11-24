import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeMotionState, advanceNativeMotion } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';

test('bird may stay still on water and can take off again', () => {
  let state = createNativeMotionState({ feet: { x: 0, y: -0.03, z: 0 } });
  state.grounded = false; state.mode = 'fall'; state.vy = -1;
  const world = { supportAt: () => null, sweepBody: () => null,
    waterAt: p => p.y <= 0.02 ? { id: 'river', y: 0, depth: Math.max(0,-p.y), current: { x: 0.65, z: 0 } } : null };
  const input = { forward: 0, turn: 0, flapPressed: false, flapHeld: false, descend: false };
  for(let i=0;i<20;i++) {
    const out=advanceNativeMotion(state,input,0.05,world); assert.equal(out.status,'advanced'); state=out.state;
  }
  assert.equal(state.mode,'rest'); assert.equal(state.vx,0); assert.equal(state.vz,0);
  assert.ok(Math.abs(state.y-state.body.centreToSoleM+0.06)<1e-8);
  const takeoff=advanceNativeMotion(state,{...input,flapPressed:true,flapHeld:true},0.05,world);
  assert.equal(takeoff.status,'advanced'); assert.ok(takeoff.state.vy>0);
});

test('nearby water must not pull feet down before contact', () => {
  const state = createNativeMotionState({ feet: { x: 0, y: 0.12, z: 0 } });
  state.grounded = false; state.mode = 'fall';
  const world = { supportAt: () => null, sweepBody: () => null,
    waterAt: p => p.y <= 0.14 ? { id: 'river', y: .02, depth: Math.max(0,.02-p.y), current: { x: 0, z: 0 } } : null };
  const out=advanceNativeMotion(state,{forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false},1/60,world);
  assert.equal(out.status,'advanced');
  assert.ok(out.state.y-out.state.body.centreToSoleM > .10, 'Proximity is not a water-surface contact');
});

test('water rest ignores forward thrust, turn-only thrust, acceleration and descend until takeoff', () => {
  const world = { supportAt: () => null, sweepBody: () => null,
    waterAt: p => p.y <= .14 ? { id: 'river', y: .02, depth: Math.max(0,.02-p.y), current: { x: 3, z: 2 } } : null };
  for(const controls of [{forward:1,turn:0},{forward:0,turn:1},{forward:1,turn:1,accelerate:true},{forward:1,turn:0,descend:true}]){
    let state=createNativeMotionState({feet:{x:0,y:-.04,z:0}});state.grounded=false;state.mode='rest';
    const input={flapPressed:false,flapHeld:false,descend:false,...controls};
    for(let i=0;i<120;i++){const out=advanceNativeMotion(state,input,1/60,world);assert.equal(out.status,'advanced');state=out.state;}
    assert.equal(state.x,0);assert.equal(state.z,0);assert.equal(state.vx,0);assert.equal(state.vz,0);
    assert.equal(state.mode,'rest');assert.equal(state.boostSeconds,0);
    assert.ok(Math.abs(state.y-state.body.centreToSoleM+.04)<1e-8);
    const out=advanceNativeMotion(state,{...input,descend:false,flapPressed:true,flapHeld:true},1/60,world);
    assert.equal(out.status,'advanced');assert.ok(out.state.vy>0);
    if(controls.forward)assert.ok(Math.hypot(out.state.vx,out.state.vz)>0);
  }
});

test('unavailable or malformed water queries roll back the proposed motion without effects', () => {
  const state=createNativeMotionState({feet:{x:0,y:-.03,z:0}});state.grounded=false;state.mode='fall';
  const input={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};
  for(const [waterAt,reason] of [[()=>undefined,'world-unavailable'],[()=>{throw Error('offline');},'world-unavailable'],[()=>({id:'water',y:NaN,depth:0,current:{x:0,z:0}}),'malformed-query']]){
    const out=advanceNativeMotion(state,input,1/60,{supportAt:()=>null,sweepBody:()=>null,waterAt});
    assert.equal(out.status,'blocked');assert.equal(out.reason,reason);assert.deepEqual(out.state,state);assert.deepEqual(out.events,[]);
  }
});
