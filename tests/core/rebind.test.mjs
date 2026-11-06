import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import * as previous from '../fixtures/legacy-species-core.js';
import {APPEARANCES,appearanceForLegacy,buildNativeAppearance,createSpeciesActor,defaultBuildRig,resolveFirstPersonPoseRebind} from '../../src/species-core/index.ts';
import {createNativeMotionState,nativeFeet} from '../../src/native/ported/motion/locomotion/b2/native-motion.ts';
import {nativeNear} from '../../src/native/body-profile.ts';
import {cameraNearRadius} from '../../src/native/ported/motion/controls/camera-resolver.ts';
import {resolveNativeCamera} from '../../src/native/ported/motion/controls/b2/native-camera.ts';
import {makeMapLayout} from '../../src/native/ported/map/layout.ts';
import {createMapQueries} from '../../src/native/ported/motion/locomotion/b2/map-queries.ts';

const pigeon=appearanceForLegacy('pigeon'),owl=appearanceForLegacy('owl'),idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};
const view={mode:'first',verticalFovDegrees:59,aspect:16/9};
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const equalPoint=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<1e-7;
const point=([x,y,z])=>({x,y,z});
const reports=[];
after(()=>fs.writeFileSync('evidence/rebind-cases.json',JSON.stringify({recordedAtUTC:new Date().toISOString(),scope:'Explicit CPU pose-rebind, synthetic failure fixtures and fixed map; no continuous rendering.',reports},null,2)+'\n'));
function world(){return{supportAt(p){const y=0,low=Math.min(p.previousFeetY,p.at.y)-p.maxDropM;return low<=y+1e-8&&p.previousFeetY+p.maxRiseM>=y-1e-8?{id:'floor',layerId:'floor',height:y,normal:{x:0,y:1,z:0},surface:'stone',walkable:true,landable:true}:null;},sweepBody(){return null;},sphereClear(p,r){return p.y>=r-1e-8;},sweepSphere(){return null;}};}
function context(actor,dt=1/60,extra={}){const s=actor.snapshot();return{contractVersion:1,frame:s.lastFrame+1,simTime:s.state.time+dt,rawSeconds:dt,acceptedSeconds:dt,playing:true,quality:'desktop',reducedMotion:false,...extra};}
function step(actor,dt=1/60,input=idle){const f=actor.prepareFrame(context(actor,dt),input);assert.equal(f.kind,'ready',f.reason);f.commit();return actor.snapshot();}
function invariants(after,before){
  for(const field of ['x','z','heading','vx','vy','vz','grounded','mode','heldSeconds','flapAge','flaps','steps','time','sourceId','nextEventSequence'])assert.equal(after.state[field],before.state[field],field);
  const a=nativeFeet(after.state),b=nativeFeet(before.state);near(a.x,b.x);near(a.y,b.y);near(a.z,b.z);
  for(const field of ['lastFrame','sequence','batch','landedAt','calledAt'])assert.equal(after[field],before[field],field);
  assert.deepEqual(after.events,before.events);assert.equal(after.pose.time,before.pose.time);assert.equal(after.pose.callAge,before.pose.callAge);assert.equal(after.pose.landing,before.pose.landing);
}
function target(actor,appearance=owl){
  const asset=buildNativeAppearance(appearance),s=actor.snapshot(),feet=nativeFeet(s.state);
  asset.rig.root.position.set(feet.x,feet.y,feet.z);asset.rig.root.rotation.y=-s.state.heading;asset.rig.pose(s.pose);asset.rig.root.updateMatrixWorld(true);
  const eye=asset.rig.getEyeWorldPosition(new THREE.Vector3()),body=asset.body;
  const request={reason:'appearance-rebind',bird:{...s.state,body,y:feet.y+body.centreToSoleM},metrics:{body,chaseTargetOffset:[0,body.eyeFromSoleM.y-body.centreToSoleM,0],chaseGroundOffset:[0,body.heightM*3.2-body.centreToSoleM,body.heightM*10],chaseAirOffset:[0,body.heightM*5.2-body.centreToSoleM,body.heightM*14.5]},world:null,projection:{near:nativeNear(body,s.projection.verticalFovDegrees,s.projection.aspect),verticalFovDegrees:s.projection.verticalFovDegrees,aspect:s.projection.aspect},previousPosition:s.camera.position,posedEyeWorld:{x:eye.x,y:eye.y,z:eye.z}};
  asset.dispose();return request;
}

test('release inside the existing0.42s flap interval returns to flap, then falls without another impulse for every species',()=>{
  for(const appearance of APPEARANCES){const actor=createSpeciesActor(new THREE.Scene(),{world:world(),appearance});try{
    step(actor,1/120,{...idle,flapPressed:true,flapHeld:true});for(let i=0;i<38;i++)step(actor,1/120,{...idle,flapHeld:true});assert.equal(actor.state.mode,'glide');
    step(actor,1/120,idle);assert.equal(actor.state.mode,'flap');assert.ok(actor.state.flapAge<.42);assert.equal(actor.state.heldSeconds,0);assert.equal(actor.state.flaps,1);
    while(actor.state.flapAge<.43)step(actor,1/120,idle);assert.equal(actor.state.mode,'fall');assert.equal(actor.state.flaps,1);
    reports.push({case:'release-before-and-after-flap-window',appearance,finalFlapAge:actor.state.flapAge,flaps:actor.state.flaps});
  }finally{actor.dispose();}}
});

test('the preserved third-person-only build rejects zero-time eye changes while the new helper has explicit operation metadata',()=>{
  const old=previous.createSpeciesActor(new THREE.Scene(),{world:world(),view});
  try{const before=old.snapshot(),r=old.prepareAppearance(owl);assert.equal(r.kind,'blocked');assert.equal(r.reason,'zero-time-first-person-swap-policy');assert.deepEqual(old.snapshot(),before);}finally{old.dispose();}
  const w=world(),actor=createSpeciesActor(new THREE.Scene(),{world:w,view});
  try{const request=target(actor);request.world=w;const before=actor.snapshot();
    const frozen=resolveNativeCamera({...request,mode:'first',acceptedSeconds:0});assert.equal(frozen.kind,'resolved');assert.deepEqual(frozen.position,request.previousPosition);assert.equal(frozen.cut,false);
    const rebind=resolveFirstPersonPoseRebind(request);assert.equal(rebind.kind,'ready',rebind.reason);assert.equal(rebind.operation,'appearance-rebind');assert.equal(rebind.camera.cut,true);assert.deepEqual(rebind.camera.position,Object.values(request.posedEyeWorld));assert.notDeepEqual(rebind.camera.position,frozen.position);assert.deepEqual(actor.snapshot(),before);
    for(const value of [{...request,reason:'tick'},{...request,previousPosition:undefined},{...request,previousPosition:[NaN,0,0]}])assert.equal(resolveFirstPersonPoseRebind(value).kind,'blocked');
  }finally{actor.dispose();}
});

test('all seven species plus white/LOD rebind at one grounded time with exact new eyes and no physics/input/event clock advancement',()=>{
  const actor=createSpeciesActor(new THREE.Scene(),{world:world(),view,calledAt:0});
  try{
    for(const appearance of [...APPEARANCES.slice(1),pigeon]){
      const before=actor.snapshot(),draft=actor.prepareAppearance(appearance);assert.equal(draft.kind,'ready',draft.reason);assert.equal(draft.cameraOperation,'appearance-rebind');assert.deepEqual(actor.snapshot(),before);draft.commit();const after=actor.snapshot();invariants(after,before);
      assert.equal(after.version,before.version+1);assert.equal(after.camera.cut,true);assert.equal(after.cameraOperation,'appearance-rebind');assert.deepEqual(after.camera.position,Object.values(after.eye));assert.ok(after.projection.near>0);
      reports.push({case:'grounded-rebind',appearance,previousEye:before.eye,nextEye:after.eye,near:after.projection.near,time:after.state.time});
    }
    for(const lod of [1,2,0]){const before=actor.snapshot(),draft=actor.prepareLod(lod);assert.equal(draft.kind,'ready',draft.reason);draft.commit();invariants(actor.snapshot(),before);assert.deepEqual(actor.snapshot().camera.position,Object.values(actor.snapshot().eye));}
    const paused=actor.snapshot();for(const extra of [{playing:false},{acceptedSeconds:0}]){assert.equal(actor.prepareFrame(context(actor,.1,extra),idle).kind,'blocked');assert.deepEqual(actor.snapshot(),paused);}
    step(actor,.1,{...idle,flapPressed:true,flapHeld:true});assert.equal(actor.state.flaps,1);assert.equal(actor.snapshot().cameraOperation,'frame-update');assert.equal(actor.snapshot().camera.cut,false);assert.deepEqual(actor.snapshot().camera.position,Object.values(actor.snapshot().eye));
  }finally{actor.dispose();}
});

test('air flap/glide/fall and source-time landing/call bookkeeping survive small-to-large and large-to-small FP rebind',()=>{
  for(const mode of ['flap','glide','fall']){
    const asset=buildNativeAppearance(pigeon),state=createNativeMotionState({body:asset.body,feet:{x:3,y:4,z:7},time:12,sourceId:'air-rebind-source',nextEventSequence:71});asset.dispose();Object.assign(state,{mode,grounded:false,vx:2,vy:-.5,vz:-4,heldSeconds:.6,flapAge:.2,steps:2,flaps:3,heading:.7});
    const actor=createSpeciesActor(new THREE.Scene(),{world:world(),view,initialState:state,lastLandedAt:11.8,calledAt:11.9});
    try{for(const appearance of [owl,{speciesId:'sparrow',skinId:'default'},pigeon]){const before=actor.snapshot(),draft=actor.prepareAppearance(appearance);assert.equal(draft.kind,'ready',draft.reason);draft.commit();const after=actor.snapshot();invariants(after,before);assert.deepEqual(after.camera.position,Object.values(after.eye));assert.equal(after.state.mode,mode);assert.equal(after.pose.landing,0);}}
    finally{actor.dispose();}
  }
});

test('fixed map FP rebind preserves bridge deck/lower layer and negative eye rather than inventingY0 support',()=>{
  const map=makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}),w=createMapQueries(map);
  for(const y of [0,-3.12]){const actor=createSpeciesActor(new THREE.Scene(),{world:w,view,feet:{x:95,y,z:405}});try{for(const appearance of [owl,{speciesId:'sparrow',skinId:'default'},pigeon]){const before=actor.snapshot(),draft=actor.prepareAppearance(appearance);assert.equal(draft.kind,'ready',draft.reason);draft.commit();const s=actor.snapshot();invariants(s,before);near(nativeFeet(s.state).y,y);assert.deepEqual(s.camera.position,Object.values(s.eye));if(y<0)assert.ok(s.eye.y<0);assert.equal(w.sphereClear(s.eye,cameraNearRadius(s.projection)+.001),true);}}finally{actor.dispose();}}
});

for(const fault of ['start-overlap','end-overlap','path-hit','start-undefined','end-undefined','path-undefined','path-malformed','path-throw','start-malformed'])test(`FP rebind ${fault} rejects complete swap and frees the new model once`,()=>{
  const w=world(),rows=[],calls=[];let armed=false,from,to,newRadius;
  const wrapped={...w,sphereClear(p,r){calls.push({type:'sphere',point:{...p},radius:r});if(armed&&equalPoint(p,from)&&r>newRadius-.00001){if(fault==='start-overlap')return false;if(fault==='start-undefined')return undefined;if(fault==='start-malformed')return 'clear';}if(armed&&equalPoint(p,to)&&r>newRadius-.00001){if(fault==='end-overlap')return false;if(fault==='end-undefined')return undefined;}return w.sphereClear(p,r);},
    sweepSphere(a,b,r){calls.push({type:'path',from:{...a},to:{...b},radius:r});if(armed&&equalPoint(a,from)&&equalPoint(b,to)&&r>newRadius-.00001){if(fault==='path-hit')return{fraction:.5,point:{x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2},normal:{x:0,y:1,z:0},colliderId:'synthetic-camera-only-blocker'};if(fault==='path-undefined')return undefined;if(fault==='path-malformed')return{};if(fault==='path-throw')throw Error('injected-chord-query');}return null;}};
  const actor=createSpeciesActor(new THREE.Scene(),{world:wrapped,view,dependencies:{buildRig(o){const rig=defaultBuildRig(o),dispose=rig.dispose.bind(rig),row={calls:0,rig};rig.dispose=()=>{row.calls++;dispose();};rows.push(row);return rig;}}});
  try{const req=target(actor);from=point(req.previousPosition);to=req.posedEyeWorld;newRadius=cameraNearRadius(req.projection)+.001;assert.ok(newRadius>cameraNearRadius(actor.snapshot().projection)+.001);const before=actor.snapshot();armed=true;const result=actor.prepareAppearance(owl);assert.equal(result.kind,'blocked');assert.deepEqual(actor.snapshot(),before);assert.equal(rows[0].calls,0);assert.equal(rows[1].calls,1);assert.ok(calls.some(c=>Math.abs(c.radius-newRadius)<1e-8));
    if(fault.startsWith('path'))assert.ok(calls.some(c=>c.type==='path'&&equalPoint(c.from,from)&&equalPoint(c.to,to)&&Math.abs(c.radius-newRadius)<1e-8));
    reports.push({case:fault,result,previous:from,newEye:to,newRadius,oldDisposed:rows[0].calls,candidateDisposed:rows[1].calls});
  }finally{armed=false;actor.dispose();}
});

test('a successful full-radius chord is required even with both endpoints clear; no hidden dt is supplied',()=>{
  const w=world(),paths=[],actor=createSpeciesActor(new THREE.Scene(),{world:{...w,sweepSphere(a,b,r){paths.push({a:{...a},b:{...b},r});return null;}},view});
  try{const before=actor.snapshot(),request=target(actor);const result=actor.prepareAppearance(owl);assert.equal(result.kind,'ready',result.reason);assert.ok(paths.some(p=>equalPoint(p.a,point(before.camera.position))&&equalPoint(p.b,request.posedEyeWorld)&&Math.abs(p.r-(cameraNearRadius(request.projection)+.001))<1e-8));result.commit();invariants(actor.snapshot(),before);reports.push({case:'full-radius-positive-path',previous:before.eye,newEye:actor.snapshot().eye,radius:cameraNearRadius(request.projection)+.001});}finally{actor.dispose();}
});

test('an existing stream cursor and raw sequence survive rebind and reject replay across candidate attachment',()=>{
  const asset=buildNativeAppearance(pigeon),initial=createNativeMotionState({body:asset.body,feet:{x:0,y:0,z:0},time:12,sourceId:'retained-source',nextEventSequence:71});asset.dispose();
  const actor=createSpeciesActor(new THREE.Scene(),{world:world(),view,initialState:initial,sessionId:'retained-session',initialCursor:{lastFrame:37,batchSequence:41,seq:112}});
  try{const before=actor.snapshot(),draft=actor.prepareAppearance(owl);assert.equal(draft.kind,'ready',draft.reason);draft.commit();invariants(actor.snapshot(),before);
    const rebound=actor.snapshot();assert.equal(actor.prepareFrame(context(actor,.1,{frame:37}),idle).kind,'blocked');assert.deepEqual(actor.snapshot(),rebound);
    step(actor,.1,{...idle,flapPressed:true,flapHeld:true});const flap=actor.events.find(e=>e.raw.type==='flap');assert.ok(flap.raw.id.includes('retained-source'));assert.equal(flap.canonical.id,'retained-session:42:0');assert.equal(flap.canonical.seq,113);assert.equal(flap.canonical.speciesId,'eagle-owl');assert.equal(actor.state.nextEventSequence,72);
  }finally{actor.dispose();}
  assert.throws(()=>createSpeciesActor(new THREE.Scene(),{world:world(),initialCursor:{lastFrame:0,batchSequence:-1,seq:0}}),/cursor/);
});

test('same-time reentrant winner, stale frame, cancellation and disposal cannot publish or leak an FP swap',()=>{
  const w=world(),rows=[];let armed=false,winner,from,to;
  const actor=createSpeciesActor(new THREE.Scene(),{world:{...w,sweepSphere(a,b){if(armed&&equalPoint(a,from)&&equalPoint(b,to)){armed=false;winner.commit();}return null;}},view,dependencies:{buildRig(o){const rig=defaultBuildRig(o),release=rig.dispose.bind(rig),r={calls:0};rig.dispose=()=>{r.calls++;release();};rows.push(r);return rig;}}});
  try{winner=actor.prepareAppearance(appearanceForLegacy('white'));assert.equal(winner.kind,'ready');const req=target(actor);from=point(req.previousPosition);to=req.posedEyeWorld;armed=true;const loser=actor.prepareAppearance(owl);assert.equal(loser.kind,'blocked');assert.equal(loser.reason,'stale-appearance-during-preview');assert.deepEqual(actor.appearance,appearanceForLegacy('white'));assert.equal(rows[0].calls,1);assert.equal(rows[1].calls,0);assert.equal(rows[2].calls,1);
    const draft=actor.prepareAppearance(owl);assert.equal(draft.kind,'ready');step(actor,.1);const after=actor.snapshot();assert.equal(draft.isCurrent(),false);assert.throws(()=>draft.commit(),/stale/);assert.deepEqual(actor.snapshot(),after);
    const pending=actor.prepareAppearance(owl);assert.equal(pending.kind,'ready');pending.cancel();pending.cancel();assert.throws(()=>pending.commit());
    const disposed=actor.prepareAppearance(owl);assert.equal(disposed.kind,'ready');actor.dispose();assert.equal(disposed.isCurrent(),false);assert.throws(()=>disposed.commit());
  }finally{armed=false;actor.dispose();}
  for(const row of rows)assert.equal(row.calls,1);
});
