import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { isOwlNight, owlFlightTuning } from '../src/native/owl-night.ts';
import { nearestGroundRat, createOwlHunt } from '../src/native/owl-hunt.ts';
import { createNativeMotionState, advanceNativeMotion, nativeFeet } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { createInputState, reduceInput, sampleInput } from '../src/input-reducer.ts';
import { createSpeciesActor } from '../src/species-core/actor.ts';
import { createNativeScene } from '../src/native/scene.ts';
const neutral = { forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false };
const tuning = { walkSpeed:.9,flightSpeed:12,glideSpeed:15 };
const air = { supportAt:()=>null,sweepBody:()=>null,sweepSphere:()=>null,sphereClear:()=>true };
const rat=(id,x,y=0,z=0)=>({id,kind:'rat',x,y,z,heading:0,action:'idle',speed:0,gaitDistance:0,age:1,variant:0,surface:'stone',routeId:'test',bodyScale:1});
function bird(y=8) { const s=createNativeMotionState({feet:{x:0,y,z:0}});s.grounded=false;s.mode='flap';return s; }

test('night availability uses the existing 09:00 start and exact dusk/dawn edges',()=>{
  assert.equal(isOwlNight(0),false);assert.equal(isOwlNight(539.99),false);assert.equal(isOwlNight(540),true);
  assert.equal(isOwlNight(1259.99),true);assert.equal(isOwlNight(1260),false);assert.equal(isOwlNight(1980),true);
  const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  assert.match(source,/id === 'owl'.*!isOwlNight/);assert.match(source,/button.disabled = !available/);
});

test('owl day tuning composes food and leaves every other species/night tuning unchanged',()=>{
  assert.equal(owlFlightTuning(tuning,'pigeon',0),tuning);assert.equal(owlFlightTuning(tuning,'eagle-owl',540),tuning);
  assert.deepEqual(owlFlightTuning({walkSpeed:1.8,flightSpeed:70/3.6,glideSpeed:60/3.6},'eagle-owl',0),
    {walkSpeed:.9,flightSpeed:35/3.6,glideSpeed:30/3.6,movementScale:.5});
});

for(const mode of ['walk','flap','glide','fall','descend','accelerate','hunt'])test(`day owl ${mode} displacement and velocity are exactly half`,()=>{
  const ground={id:'ground',layerId:'ground',height:0,normal:{x:0,y:1,z:0},walkable:true,landable:true,surface:'stone'};
  const world=mode==='walk'?{...air,supportAt:()=>ground}:air;
  let night=bird(mode==='walk'?0:90),day=bird(mode==='walk'?0:90);
  night.tuning=tuning;day.tuning=owlFlightTuning(tuning,'eagle-owl',0);
  if(mode==='walk'){night.grounded=day.grounded=true;night.support=day.support=ground;}
  const start=night.y;
  for(let i=0;i<20;i++){
    const input={...neutral,forward:1,flapHeld:mode==='glide',flapPressed:mode==='flap'&&i===0,descend:mode==='descend',accelerate:mode==='accelerate'};
    if(mode==='hunt')input.owlHuntMotion={target:{x:0,y:0,z:-100},speed:38,phase:'dive'};
    night=advanceNativeMotion(night,input,.025,world).state;day=advanceNativeMotion(day,input,.025,world).state;
    if(mode!=='hunt')for(const key of ['vx','vy','vz'])assert.ok(Math.abs(day[key]-night[key]/2)<1e-8,`${mode} ${key}`);
  }
  if(mode==='hunt')assert.ok(Math.abs(Math.hypot(day.vx,day.vy,day.vz)-19)<1e-8);
  else {assert.ok(Math.abs((day.y-start)-(night.y-start)/2)<1e-8);assert.ok(Math.abs(day.z-night.z/2)<1e-8);}
});

test('actor applies the dawn ratio once, without halving repeatedly',()=>{
  const initial=bird(50);initial.vx=8;initial.vy=6;initial.vz=-4;
  const actor=createSpeciesActor(new THREE.Group(),{world:air,appearance:{speciesId:'eagle-owl',skinId:'default'},initialState:initial});
  try{
    let frame=0;
    function tick(nextTuning){const p=actor.prepareFrame({contractVersion:1,frame:++frame,simTime:actor.state.time+.01,rawSeconds:.01,acceptedSeconds:.01,playing:true,quality:'mobile',reducedMotion:false},neutral,undefined,undefined,Infinity,Infinity,Infinity,nextTuning);assert.equal(p.kind,'ready');p.commit();}
    tick(owlFlightTuning(tuning,'eagle-owl',0));assert.ok(actor.state.vx>3.8&&actor.state.vx<4.1);
    tick(owlFlightTuning(tuning,'eagle-owl',0));assert.ok(actor.state.vx>3.5);
    tick(tuning);assert.ok(actor.state.vx>7);
  }finally{actor.dispose();}
});

test('R/mobile release is consumed once; pointer cancellation and lost focus never launch a hunt',()=>{
  const gate={enabled:true,focused:true,hidden:false,paused:false,dialogOpen:false};let s=createInputState(gate);
  s=reduceInput(s,{type:'key-down',code:'KeyR',repeat:false}).state;assert.equal(sampleInput(s).input.peckHeld,true);
  s=reduceInput(s,{type:'key-up',code:'KeyR'}).state;let sampled=sampleInput(s);assert.equal(sampled.input.peckReleased,true);assert.equal(sampleInput(sampled.state).input.peckReleased,false);
  s=reduceInput(sampled.state,{type:'pointer-down',control:'peck',id:2}).state;assert.equal(sampleInput(s).input.peckHeld,true);
  s=reduceInput(s,{type:'pointer-cancel',control:'peck',id:2}).state;assert.equal(sampleInput(s).input.peckReleased,false);
  s=reduceInput(s,{type:'pointer-down',control:'peck',id:3}).state;s=reduceInput(s,{type:'pointer-up',control:'peck',id:3}).state;assert.equal(sampleInput(s).input.peckReleased,true);
  s=reduceInput(s,{type:'gate',gate:{...gate,focused:false}}).state;assert.equal(sampleInput(s).input.peckReleased,false);assert.equal(sampleInput(s).input.peckHeld,false);
});

test('nearest rat selection excludes other animals and updates while holding R',()=>{
  const a=rat('far',3),b=rat('near',1);assert.equal(nearestGroundRat({x:0,y:5,z:0},[a,{...b,kind:'cat'},b]).id,'near');
  const hunt=createOwlHunt(new THREE.Scene(),()=>false),s=bird();
  try { const p=hunt.prepare({...neutral,peckHeld:true},s,'eagle-owl',[a,b],.05);assert.equal(hunt.snapshot().phase,'idle');p.commit(s);assert.equal(hunt.snapshot().targetId,'near');assert.equal(hunt.snapshot().markerVisible,true);
    hunt.prepare({...neutral,peckHeld:true},s,'eagle-owl',[a,{...b,x:30}],.05).commit(s);assert.equal(hunt.snapshot().targetId,'far');hunt.cancel();assert.equal(hunt.snapshot().markerVisible,false);
  } finally{hunt.dispose();}
});

for(const hz of [30,60,120])test(`hold/release dives, catches one rat and returns to flight at ${hz} Hz`,()=>{
  let s=bird(7),rats=[rat('prey',6)],captures=0;
  const hunt=createOwlHunt(new THREE.Scene(),(id,at)=>{const r=rats.find(r=>r.id===id);if(!r||Math.hypot(r.x-at.x,r.y-at.y,r.z-at.z)>.25)return false;rats=[];captures++;return true;});
  try{
    hunt.prepare({...neutral,peckHeld:true},s,'eagle-owl',rats,1/hz).commit(s);
    let rise=false;
    for(let i=0;i<12*hz;i++){
      const proposal=hunt.prepare({...neutral,peckReleased:i===0},s,'eagle-owl',rats,1/hz);
      const motion=advanceNativeMotion(s,proposal.input,1/hz,air);assert.equal(motion.status,'advanced');s=motion.state;proposal.commit(s);
      if(hunt.snapshot().phase==='rise')rise=true;
      if(rise&&hunt.snapshot().phase==='idle')break;
    }
    assert.equal(captures,1);assert.equal(rats.length,0);assert.ok(rise);assert.equal(hunt.snapshot().phase,'idle');assert.ok(nativeFeet(s).y>=6.8);assert.equal(s.grounded,false);assert.ok(s.vy>0);assert.equal(hunt.snapshot().carriedRatId,'prey');
  }finally{hunt.dispose();}
});

test('missing prey, non-owl, grounded and cancelled aim cannot capture',()=>{
  let captures=0;const hunt=createOwlHunt(new THREE.Scene(),()=>{captures++;return true;}),s=bird();
  try{
    hunt.prepare({...neutral,peckReleased:true},s,'pigeon',[rat('r',0)],.05).commit(s);assert.equal(hunt.snapshot().phase,'idle');
    hunt.prepare({...neutral,peckHeld:true},{...s,grounded:true},'eagle-owl',[rat('r',0)],.05).commit(s);assert.equal(hunt.snapshot().phase,'idle');
    hunt.prepare({...neutral,peckReleased:true},s,'eagle-owl',[],.05).commit(s);assert.equal(hunt.snapshot().phase,'idle');
    hunt.prepare({...neutral,peckHeld:true},s,'eagle-owl',[rat('r',0)],.05).commit(s);hunt.cancel();
    hunt.prepare(neutral,s,'eagle-owl',[rat('r',0)],.05).commit(s);assert.equal(hunt.snapshot().phase,'idle');assert.equal(captures,0);
  }finally{hunt.dispose();}
});

test('owl native scene preview stays atomic and committed time applies day movement',()=>{
  const engine=createNativeScene(new THREE.Scene(),'owl',{quality:'mobile'});
  try{
    const before=engine.snapshot(),p=engine.prepare({...neutral,flapPressed:true},.05,{near:.01,verticalFovDegrees:59,aspect:16/9},'third',10,false);
    assert.equal(p.kind,'ready');assert.equal(engine.state.time,before.state.time);assert.equal(engine.snapshot().owlHunt.phase,'idle');p.commit();
    assert.equal(engine.state.tuning.movementScale,.5);assert.ok(engine.state.vy<4.7);engine.cancelHunt();assert.equal(engine.snapshot().owlHunt.phase,'idle');
  }finally{engine.dispose();}
});

test('blocked dive uses body sweeps, never captures through a wall, and abandons a stalled attack',()=>{
  let captures=0,s=bird(5);const hunt=createOwlHunt(new THREE.Scene(),()=>{captures++;return true;}),rats=[rat('behind',8)];
  const wall={...air,sweepBody(from,to){
    if(to.x>1&&from.x<=1&&to.x>from.x){const fraction=(1-from.x)/(to.x-from.x);return{fraction,point:{x:1,y:from.y+(to.y-from.y)*fraction,z:from.z+(to.z-from.z)*fraction},normal:{x:-1,y:0,z:0},colliderId:'wall'};}return null;
  }};
  try{
    let aborted=false;
    for(let i=0;i<200;i++){
      const p=hunt.prepare({...neutral,peckReleased:i===0},s,'eagle-owl',rats,.05);
      const m=advanceNativeMotion(s,p.input,.05,wall);assert.equal(m.status,'advanced');s=m.state;p.commit(s);assert.ok(s.x<=1+1e-8);
      if(hunt.snapshot().phase==='rise')aborted=true;
      if(aborted&&hunt.snapshot().phase==='idle')break;
    }
    assert.equal(captures,0);assert.ok(aborted);assert.equal(hunt.snapshot().phase,'idle');
  }finally{hunt.dispose();}
});

test('scene lifecycle cancellation invalidates a prepared hunt frame',()=>{
  const e=createNativeScene(new THREE.Scene(),'owl',{quality:'mobile'});
  try{const p=e.prepare(neutral,.05,{near:.01,verticalFovDegrees:59,aspect:16/9},'third',10,false);assert.equal(p.kind,'ready');e.cancelHunt();assert.equal(p.isCurrent(),false);assert.throws(()=>p.commit(),/Stale/);assert.equal(e.state.time,0);}finally{e.dispose();}
});
