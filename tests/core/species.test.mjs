import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {APPEARANCES,SPECIES,normalizeAppearance,appearanceForLegacy,buildNativeAppearance,measureOriginRig,localGeometryBounds,defaultBuildRig,createSpeciesActor} from '../../src/species-core/index.ts';
import {nativeNear,measureNativeBody} from '../../src/native/body-profile.ts';
import {cameraNearRadius} from '../../src/native/ported/motion/controls/camera-resolver.ts';
import {resolveNativeCamera} from '../../src/native/ported/motion/controls/b2/native-camera.ts';
import {createNativeMotionState,nativeFeet} from '../../src/native/ported/motion/locomotion/b2/native-motion.ts';
import {createMapQueries} from '../../src/native/ported/motion/locomotion/b2/map-queries.ts';
import {makeMapLayout,queryRoofSupport} from '../../src/native/ported/map/layout.ts';
// These two historical RED probes intentionally target the preserved ffbe app.
import {createNativeScene} from '../fixtures/legacy-native-scene.ts';
import {Controls,applyControlsGate} from '../../src/input.ts';
import {createFrameClock} from '../../src/frame-clock.ts';
import {transactNativeFrame} from '../../src/native/frame-transaction.ts';

const idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};
const pigeon=normalizeAppearance({speciesId:'pigeon',skinId:'gray'}),owl=appearanceForLegacy('owl');
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const json=o=>JSON.stringify(o);
const identity=()=>new THREE.Scene();
const vectors=(a,b,e=1e-7)=>a.forEach((x,i)=>near(x,b[i],e));
function tree(root){const rows=[];root.updateMatrixWorld(true);root.traverse(o=>rows.push({name:o.name,position:o.position.toArray(),q:o.quaternion.toArray(),scale:o.scale.toArray(),matrix:o.matrix.toArray()}));return rows;}
function context(actor,dt=1/60,changes={}){const s=actor.snapshot();return{contractVersion:1,frame:s.lastFrame+1,simTime:s.state.time+dt,rawSeconds:dt,acceptedSeconds:dt,playing:true,quality:'desktop',reducedMotion:false,...changes};}
function step(actor,dt=1/60,input=idle,view){const proposal=actor.prepareFrame(context(actor,dt),input,view);assert.equal(proposal.kind,'ready',proposal.reason);proposal.commit();return actor.snapshot();}
function commitSwap(actor,appearance,lod){const result=actor.prepareAppearance(appearance,lod);assert.equal(result.kind,'ready',result.reason);result.commit();return actor.snapshot();}
function plane({width=Infinity,centerX=0}={}){
  const level=0;
  return{
    supportAt(p){if(Math.abs(p.at.x-centerX)+p.footRadiusM>width/2)return null;const low=Math.min(p.previousFeetY,p.at.y)-p.maxDropM,high=p.previousFeetY+p.maxRiseM;return low<=level+1e-8&&high>=level-1e-8?{id:'floor',layerId:'floor',height:level,normal:{x:0,y:1,z:0},surface:'stone',walkable:true,landable:true}:null;},
    sweepBody(){return null;},
    sphereClear(p,r){return p.y>=r-1e-8;},
    sweepSphere(a,b,r){if(a.y<r-1e-8)return{fraction:0,point:{...a},normal:{x:0,y:1,z:0},colliderId:'floor'};if(b.y>=r-1e-8)return null;const t=(a.y-r)/(a.y-b.y);return{fraction:t,point:{x:a.x+(b.x-a.x)*t,y:r,z:a.z+(b.z-a.z)*t},normal:{x:0,y:1,z:0},colliderId:'floor'};},
  };
}
function tracked(){
  const rows=[];
  return{rows,dependencies:{buildRig(options){
    const rig=defaultBuildRig(options),original=rig.dispose.bind(rig),row={rig,options:{...options},disposeCalls:0,geometryDisposes:0,materialDisposes:0};
    for(const geometry of new Set(rig.model.resources.geometries))geometry.addEventListener('dispose',()=>row.geometryDisposes++);
    for(const material of new Set(rig.model.resources.materials))material.addEventListener('dispose',()=>row.materialDisposes++);
    row.geometryCount=new Set(rig.model.resources.geometries).size;row.materialCount=new Set(rig.model.resources.materials).size;
    rig.dispose=()=>{row.disposeCalls++;original();};rows.push(row);return rig;
  }}};
}
const measurements=[],reproductions=[];
after(()=>{fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync('evidence/measurements.json',JSON.stringify({recordedAtUTC:new Date().toISOString(),scope:'CPU model geometry, not bird biology or rendered play.',measurements},null,2)+'\n');fs.writeFileSync('evidence/legacy-reproductions.json',JSON.stringify({recordedAtUTC:new Date().toISOString(),reproductions},null,2)+'\n');});

test('strict seven-species identity, pigeon skins and eagle-owl legacy alias never silently fall back',()=>{
  assert.equal(SPECIES.length,7);assert.equal(APPEARANCES.length,8);assert.equal(new Set(APPEARANCES.map(a=>a.speciesId)).size,7);
  assert.deepEqual(appearanceForLegacy('white'),{speciesId:'pigeon',skinId:'white'});assert.deepEqual(appearanceForLegacy('owl'),owl);assert.equal(owl.speciesId,'eagle-owl');
  assert.deepEqual(normalizeAppearance({speciesId:'pigeon',skinId:'default'}),pigeon);
  for(const value of [null,{},'crow',{speciesId:'owl',skinId:'default'},{speciesId:'crow',skinId:'white'},{speciesId:'sparrow',skinId:'gray'},{speciesId:'pigeon',skinId:'unknown'}])assert.throws(()=>normalizeAppearance(value));
  assert.throws(()=>appearanceForLegacy('sparrow'));assert.throws(()=>buildNativeAppearance(pigeon,3));
});

for(const appearance of APPEARANCES)for(const lod of [0,1,2])test(`origin metre bounds/soles/eye and placement invariance: ${appearance.speciesId}/${appearance.skinId}/LOD${lod}`,()=>{
  const asset=buildNativeAppearance(appearance,lod);
  try{
    assert.equal(asset.rig.model.species,appearance.speciesId);assert.equal(asset.rig.model.lod,lod);assert.equal(asset.rig.model.morph,appearance.skinId==='gray'?'gray':appearance.skinId);
    const m=asset.measurement,before=localGeometryBounds(asset.rig),eye=[...m.eye],foot=localGeometryBounds(asset.rig,asset.rig.model.pivots.leftFoot);
    assert.deepEqual(m.rootScale,[1,1,1]);near(m.feet.min[1],0,1e-6);assert.ok(m.body.heightM>0&&m.body.footSupportRadiusM>0&&m.body.horizontalRadiusM>0);assert.ok(eye[1]>0&&eye[1]<=m.bounds.max[1]+.001);
    asset.rig.root.position.set(101,-3.12,-432);asset.rig.root.rotation.y=.917;asset.rig.root.updateMatrixWorld(true);
    const placed=localGeometryBounds(asset.rig),localEye=asset.rig.root.worldToLocal(asset.rig.getEyeWorldPosition(new THREE.Vector3()));
    vectors(before.min,placed.min);vectors(before.max,placed.max);vectors(eye,localEye.toArray());vectors(foot.min,localGeometryBounds(asset.rig,asset.rig.model.pivots.leftFoot).min);
    const poseBefore=tree(asset.rig.root);assert.throws(()=>measureOriginRig(asset.rig),/Origin/);assert.deepEqual(tree(asset.rig.root),poseBefore);
    measurements.push({appearance,lod,measurement:m,canonicalBody:asset.body,placedLocalBounds:placed,placedLocalEye:localEye.toArray()});
  }finally{asset.dispose();asset.dispose();}
});

test('LOD0 physics stays pinned while all visual LOD measurements remain explicit and white is pigeon geometry',()=>{
  for(const appearance of APPEARANCES){const assets=[0,1,2].map(lod=>buildNativeAppearance(appearance,lod));try{for(const a of assets)assert.deepEqual(a.body,assets[0].body);}finally{assets.forEach(a=>a.dispose());}}
  const gray=buildNativeAppearance(pigeon),white=buildNativeAppearance(appearanceForLegacy('white'));
  try{assert.deepEqual(gray.measurement,white.measurement);assert.deepEqual(gray.body,white.body);}finally{gray.dispose();white.dispose();}
});

test('legacy world-space measurement contamination is reproduced and guarded; active/borrowed roots are untouched',()=>{
  const asset=buildNativeAppearance(normalizeAppearance({speciesId:'crow',skinId:'default'}));
  try{asset.rig.root.position.set(90,-3,80);const bad=measureNativeBody(asset.rig);assert.ok(bad.horizontalRadiusM>50);assert.ok(bad.eyeFromSoleM.y<0);assert.throws(()=>measureOriginRig(asset.rig));
    reproductions.push({problem:'old helper called after world placement',nativeBody:asset.body,contaminatedBody:bad,guard:'candidate rejects measurement; does not move a live rig'});
  }finally{asset.dispose();}
  const owner=identity(),other=defaultBuildRig({species:'pigeon',morph:'gray',lod:0});owner.add(other.root);let disposes=0;const release=other.dispose.bind(other);other.dispose=()=>{disposes++;release();};
  assert.throws(()=>buildNativeAppearance(pigeon,0,{buildRig:()=>other}),/borrowed/);assert.equal(disposes,0);assert.equal(other.root.parent,owner);other.dispose();
});

test('legacy grounded swap can accept known missing support; candidate requires the complete new foot disk',()=>{
  const world=plane({width:.16}),base=createNativeScene(identity(),'pigeon',{world:plane({width:.16,centerX:-37}),quality:'mobile',sessionId:'legacy-support-reproduction'});
  try{const before=base.snapshot();assert.equal(before.state.grounded,true);assert.equal(base.selectLook('owl'),true);const after=base.snapshot();assert.equal(after.state.grounded,false);assert.equal(after.state.mode,'fall');
    reproductions.push({problem:'legacy selectLook succeeds then falls on known null support',before:{look:before.look,grounded:before.state.grounded,mode:before.state.mode},after:{look:after.look,grounded:after.state.grounded,mode:after.state.mode}});
  }finally{base.dispose();}
  const actor=createSpeciesActor(identity(),{world,appearance:pigeon}),before=actor.snapshot(),root=tree(actor.root);
  try{const next=actor.prepareAppearance(owl);assert.equal(next.kind,'blocked');assert.match(next.reason,/grounded-support/);assert.deepEqual(actor.snapshot(),before);assert.deepEqual(tree(actor.root),root);}finally{actor.dispose();}
});

test('legacy air replacement changes glide to fall; the new staged swap retains all flight bookkeeping and source sequence',()=>{
  const world=plane(),base=createNativeScene(identity(),'pigeon',{world,quality:'mobile',sessionId:'legacy-air-reproduction'});
  try{const projection={near:.0225,verticalFovDegrees:59,aspect:16/9};for(let i=0;i<25;i++){const f=base.prepare({...idle,flapHeld:true,flapPressed:i===0},1/60,projection,'third',10+(i+1)/60,false);assert.equal(f.kind,'ready');f.commit();}
    assert.equal(base.state.mode,'glide');assert.equal(base.selectLook('owl'),true);assert.equal(base.state.mode,'fall');reproductions.push({problem:'legacy air mode reset',beforeMode:'glide',afterMode:base.state.mode});
  }finally{base.dispose();}
  for(const mode of ['flap','glide','fall']){
    const a=buildNativeAppearance(pigeon),initial=createNativeMotionState({body:a.body,feet:{x:4,y:5,z:2},sourceId:'same-source',time:12,nextEventSequence:51});a.dispose();
    Object.assign(initial,{vx:1.2,vy:mode==='flap'?3:-.5,vz:-7,grounded:false,mode,heldSeconds:.33,flapAge:.12,flaps:4,steps:2.7});
    const actor=createSpeciesActor(identity(),{world,appearance:pigeon,initialState:initial});
    try{const before=actor.snapshot(),draft=actor.prepareAppearance(owl);assert.equal(draft.kind,'ready',draft.reason);assert.deepEqual(actor.snapshot(),before);draft.commit();const after=actor.snapshot();
      for(const key of ['x','z','heading','vx','vy','vz','grounded','mode','heldSeconds','flapAge','flaps','steps','time','sourceId','nextEventSequence'])assert.equal(after.state[key],before.state[key],key);
      assert.deepEqual(nativeFeet(after.state),nativeFeet(before.state));assert.equal(after.batch,before.batch);assert.equal(after.sequence,before.sequence);assert.deepEqual(after.events,before.events);
    }finally{actor.dispose();}
  }
});

for(const appearance of APPEARANCES)test(`same accepted input supports tap/hold/release/land and actual first-person eye: ${appearance.speciesId}/${appearance.skinId}`,()=>{
  const actor=createSpeciesActor(identity(),{world:plane(),appearance,sessionId:'species-motion'});let flap=0,land=0;
  const record=()=>{for(const e of actor.events){assert.equal(e.speciesId,appearance.speciesId);assert.equal(e.sourceTime,e.raw.time);if(e.raw.type==='flap'){flap++;assert.equal(e.canonical.speciesId,appearance.speciesId);assert.equal(e.anchor,'body');}if(e.raw.type==='land'){land++;assert.equal(e.anchor,'sole');near(e.raw.position.y,0);assert.equal('speciesId' in e.canonical,false);}}};
  try{
    step(actor,1/120,{...idle,flapPressed:true,flapHeld:true},{mode:'first',verticalFovDegrees:59,aspect:390/844});record();
    for(let i=0;i<60;i++){step(actor,1/120,{...idle,flapHeld:true});record();}
    assert.equal(actor.state.flaps,1);assert.equal(actor.state.mode,'glide');step(actor,1/120,idle);record();assert.equal(actor.state.mode,'fall');
    for(let i=0;i<600&&!actor.state.grounded;i++){step(actor,1/120,{...idle,descend:true});record();}
    assert.equal(actor.state.grounded,true);assert.equal(flap,1);assert.equal(land,1);assert.ok(actor.snapshot().landedAt!==undefined);
    const s=actor.snapshot();vectors(s.camera.position,[s.eye.x,s.eye.y,s.eye.z]);assert.equal(s.projection.near,nativeNear(s.body,59,390/844));assert.deepEqual(s.rootScale,[1,1,1]);
  }finally{actor.dispose();}
});

test('known air null is valid while undefined body/support/query results reject replacement atomically',()=>{
  const asset=buildNativeAppearance(pigeon),initial=createNativeMotionState({body:asset.body,feet:{x:0,y:4,z:0}});asset.dispose();Object.assign(initial,{grounded:false,mode:'glide',heldSeconds:.5});
  const world=plane();let unavailable=false;const wrapped={...world,supportAt:p=>unavailable?undefined:world.supportAt(p)};
  const actor=createSpeciesActor(identity(),{world:wrapped,initialState:initial});
  try{assert.equal(actor.prepareAppearance(owl).kind,'ready');const before=actor.snapshot();unavailable=true;assert.equal(actor.prepareAppearance(owl).kind,'blocked');assert.deepEqual(actor.snapshot(),before);}finally{actor.dispose();}
});

test('every grounded and airborne species/skin replacement preserves sole, velocity, source time and sequence',()=>{
  for(const air of [false,true]){
    const a=buildNativeAppearance(pigeon),initial=createNativeMotionState({body:a.body,feet:{x:0,y:air?4:0,z:0},sourceId:'cross-species-source',time:7,nextEventSequence:41});a.dispose();
    Object.assign(initial,air?{grounded:false,mode:'glide',vx:1,vy:-.2,vz:-5,heldSeconds:.55,flapAge:.8,flaps:2,steps:1.3}:{mode:'walk',vz:-.9,steps:1.3});
    const actor=createSpeciesActor(identity(),{world:plane(),initialState:initial});
    try{for(const appearance of [...APPEARANCES.slice(1),pigeon]){const before=actor.snapshot();commitSwap(actor,appearance);const after=actor.snapshot();
      for(const key of ['vx','vy','vz','heading','grounded','mode','time','sourceId','nextEventSequence','steps','flaps','heldSeconds','flapAge'])assert.equal(after.state[key],before.state[key],key);
      vectors(Object.values(nativeFeet(after.state)),Object.values(nativeFeet(before.state)));assert.deepEqual(after.events,before.events);assert.equal(after.sequence,before.sequence);assert.equal(after.batch,before.batch);
    }}finally{actor.dispose();}
  }
});

test('a larger body at the shared ceiling is rejected before creating an invalid next motion state',()=>{
  const a=buildNativeAppearance(pigeon),initial=createNativeMotionState({body:a.body,feet:{x:0,y:179.8,z:0}});a.dispose();Object.assign(initial,{grounded:false,mode:'glide',heldSeconds:.4});
  const actor=createSpeciesActor(identity(),{world:plane(),initialState:initial});
  try{const before=actor.snapshot(),draft=actor.prepareAppearance(owl);assert.equal(draft.kind,'blocked');assert.deepEqual(actor.snapshot(),before);}finally{actor.dispose();}
});

for(const fault of ['build','measure','pose','near','camera','support','body'])test(`post-build ${fault} failure releases only staged resources and preserves the old rig`,()=>{
  const trackedRigs=tracked(),world=plane();let broken=false;
  const build=trackedRigs.dependencies.buildRig;
  const dependencies={buildRig(o){if(broken&&fault==='build')throw Error('injected-build');const rig=build(o),pose=rig.pose.bind(rig);rig.pose=p=>{pose(p);if(broken&&fault==='pose'&&p.reducedMotion!==true)throw Error('injected-pose');};return rig;},
    measure(rig){if(broken&&fault==='measure')throw Error('injected-measure');return measureOriginRig(rig);},
    near(...args){if(broken&&fault==='near')throw Error('injected-near');return nativeNear(...args);},
    camera(request){if(broken&&fault==='camera')throw Error('injected-camera');return resolveNativeCamera(request);}};
  const actor=createSpeciesActor(identity(),{world:{...world,supportAt:p=>broken&&fault==='support'?undefined:world.supportAt(p),sweepBody:(...args)=>broken&&fault==='body'?undefined:world.sweepBody(...args)},dependencies});
  try{const before=actor.snapshot(),root=tree(actor.root),old=actor.root;broken=true;const result=actor.prepareAppearance(owl);assert.equal(result.kind,'blocked');assert.deepEqual(actor.snapshot(),before);assert.equal(actor.root,old);assert.deepEqual(tree(actor.root),root);
    assert.equal(trackedRigs.rows[0].disposeCalls,0);for(const row of trackedRigs.rows.slice(1)){assert.equal(row.disposeCalls,1);assert.equal(row.geometryDisposes,row.geometryCount);assert.equal(row.materialDisposes,row.materialCount);}
  }finally{broken=false;actor.dispose();}
});

test('a failed canonical LOD0 measurement cleans both new LOD rigs, and pending/stale/cancelled swaps own no old resources',()=>{
  const r=tracked();let broken=false;const actor=createSpeciesActor(identity(),{world:plane(),dependencies:{...r.dependencies,measure(rig){if(broken&&rig.model.lod===0)throw Error('canonical-measure');return measureOriginRig(rig);}}});
  try{broken=true;const before=actor.snapshot();assert.equal(actor.prepareLod(1).kind,'blocked');assert.deepEqual(actor.snapshot(),before);assert.equal(r.rows[1].disposeCalls,1);assert.equal(r.rows[2].disposeCalls,1);assert.equal(r.rows[0].disposeCalls,0);
    broken=false;const first=actor.prepareAppearance(owl),second=actor.prepareAppearance(normalizeAppearance({speciesId:'sparrow',skinId:'default'}));assert.equal(first.kind,'ready');assert.equal(second.kind,'ready');second.commit();assert.equal(first.isCurrent(),false);assert.throws(()=>first.commit(),/stale/);
    const unchanged=actor.snapshot();const cancelled=actor.prepareAppearance(pigeon);cancelled.cancel();cancelled.cancel();assert.throws(()=>cancelled.commit());assert.deepEqual(actor.snapshot(),unchanged);
  }finally{actor.dispose();actor.dispose();}
  for(const row of r.rows)assert.equal(row.disposeCalls,1);
});

test('larger near volume validates previous camera before an explicit same-time first-person rebind',()=>{
  const world=plane();let reject=false,previous;
  const actor=createSpeciesActor(identity(),{world:{...world,sphereClear(p,r){if(reject&&Math.hypot(p.x-previous[0],p.y-previous[1],p.z-previous[2])<1e-8&&r>.06)return false;return world.sphereClear(p,r);}}});
  try{previous=actor.snapshot().camera.position;const before=actor.snapshot();reject=true;const large=actor.prepareAppearance(owl);assert.equal(large.kind,'blocked');assert.match(large.reason,/no-clear-previous/);assert.deepEqual(actor.snapshot(),before);reject=false;
    step(actor,1/60,idle,{mode:'first',verticalFovDegrees:59,aspect:16/9});const first=actor.snapshot();const swap=actor.prepareAppearance(owl);assert.equal(swap.kind,'ready',swap.reason);assert.equal(swap.cameraOperation,'appearance-rebind');assert.deepEqual(actor.snapshot(),first);swap.commit();
    assert.equal(actor.snapshot().cameraOperation,'appearance-rebind');assert.equal(actor.snapshot().camera.cut,true);assert.equal(actor.state.time,first.state.time);assert.equal(actor.snapshot().sequence,first.sequence);
    commitSwap(actor,appearanceForLegacy('white'));vectors(actor.snapshot().camera.position,Object.values(actor.snapshot().eye));
  }finally{actor.dispose();}
});

test('landing timer/pose/source anchors are previewed and restored on rejection, then committed once and preserved across species/LOD',()=>{
  const a=buildNativeAppearance(pigeon),initial=createNativeMotionState({body:a.body,feet:{x:0,y:.04,z:0},sourceId:'landing-source',time:9,nextEventSequence:51});a.dispose();Object.assign(initial,{grounded:false,mode:'fall',vy:-2});
  const world=plane();let unavailable=false;const actor=createSpeciesActor(identity(),{world:{...world,sphereClear:(...args)=>unavailable?undefined:world.sphereClear(...args)},initialState:initial,sessionId:'landing-session'});
  try{
    const before=actor.snapshot(),poseBefore=tree(actor.root),clock=context(actor,.05);unavailable=true;
    assert.equal(actor.prepareFrame(clock,idle).kind,'blocked');assert.deepEqual(actor.snapshot(),before);assert.deepEqual(tree(actor.root),poseBefore);
    unavailable=false;const f=actor.prepareFrame(clock,idle);assert.equal(f.kind,'ready',f.reason);assert.ok(f.landedAt>=9&&f.landedAt<=9.05);assert.ok(f.pose.landing>0&&f.pose.landing<=1);assert.deepEqual(actor.snapshot(),before);assert.deepEqual(tree(actor.root),poseBefore);
    const raw=f.previewEmissions.find(e=>e.raw.type==='land');assert.ok(raw);assert.equal(raw.sourceTime,f.landedAt);near(raw.raw.position.y,0);assert.equal(raw.canonical.simTime,raw.raw.time);assert.equal(raw.speciesId,'pigeon');
    f.commit();assert.throws(()=>f.commit(),/stale/);const landed=actor.snapshot();assert.equal(landed.landedAt,raw.raw.time);assert.equal(landed.events.find(e=>e.raw.type==='land').canonical.id,raw.canonical.id);
    const event=json(raw);const sparrow=normalizeAppearance({speciesId:'sparrow',skinId:'default'});commitSwap(actor,sparrow);commitSwap(actor,sparrow,1);assert.equal(actor.snapshot().landedAt,landed.landedAt);assert.equal(json(raw),event);
    const pause=actor.snapshot();assert.equal(actor.prepareFrame(context(actor,.1,{playing:false}),idle).kind,'blocked');assert.deepEqual(actor.snapshot(),pause);
    for(let i=0;i<3;i++)step(actor,.1);assert.equal(actor.snapshot().pose.landing,0);
    step(actor,1/60,{...idle,flapPressed:true,flapHeld:true});const flap=actor.events.find(e=>e.raw.type==='flap');assert.equal(flap.canonical.speciesId,'sparrow');assert.equal(raw.speciesId,'pigeon');assert.ok(flap.canonical.seq>raw.canonical.seq);
    for(const e of actor.events)assert.equal(e.canonical?.simTime,e.raw.time);
  }finally{actor.dispose();}
});

test('a frame installs its already validated pose without invoking a possibly failing pose callback after input commit',()=>{
  let throwPose=false;const r=tracked();const actor=createSpeciesActor(identity(),{world:plane(),dependencies:{buildRig(o){const rig=r.dependencies.buildRig(o),pose=rig.pose.bind(rig);rig.pose=input=>{if(throwPose)throw Error('must-not-call-at-commit');pose(input);};return rig;}}});
  try{const draft=actor.prepareFrame(context(actor,.1),{...idle,flapPressed:true});assert.equal(draft.kind,'ready');throwPose=true;draft.commit();assert.equal(actor.state.flaps,1);const actual=r.rows[0].rig.getEyeWorldPosition(new THREE.Vector3()),s=actor.snapshot();vectors(actual.toArray(),Object.values(s.eye));}finally{throwPose=false;actor.dispose();}
});

test('frame/appearance generation, invalid clocks and mutable request objects cannot produce stale pose or events',()=>{
  const actor=createSpeciesActor(identity(),{world:plane()});
  try{const before=actor.snapshot();for(const patch of [{playing:false},{acceptedSeconds:0},{acceptedSeconds:.2},{frame:-1},{contractVersion:2},{simTime:10},{rawSeconds:0},{quality:'other'}]){assert.equal(actor.prepareFrame(context(actor,.1,patch),idle).kind,'blocked');assert.deepEqual(actor.snapshot(),before);}
    const old=actor.prepareFrame(context(actor,.1),{...idle,flapPressed:true});const swap=actor.prepareAppearance(owl);assert.equal(swap.kind,'ready');swap.commit();const now=actor.snapshot();assert.throws(()=>old.commit(),/stale/);assert.deepEqual(actor.snapshot(),now);
    const view={mode:'third',verticalFovDegrees:59,aspect:16/9},clock=context(actor,.1),next=actor.prepareFrame(clock,idle,view);assert.equal(next.kind,'ready');view.aspect=0;clock.simTime=999;next.commit();assert.equal(actor.snapshot().view.aspect,16/9);
    const committed=actor.snapshot();assert.equal(actor.prepareFrame(context(actor,.1,{frame:committed.lastFrame}),idle).kind,'blocked');assert.deepEqual(actor.snapshot(),committed);
  }finally{actor.dispose();}
});

test('30/60/120Hz use the same game assumptions and keep species-specific events under accepted time',()=>{
  for(const appearance of APPEARANCES){const final=[];for(const hz of [30,60,120]){const actor=createSpeciesActor(identity(),{world:plane(),appearance});try{let flaps=0;for(let i=0;i<2*hz;i++){const time=i/hz;step(actor,1/hz,{...idle,flapPressed:i===0,flapHeld:time<.7,descend:time>=1.2});flaps+=actor.events.filter(e=>e.raw.type==='flap').length;}assert.equal(flaps,1);near(actor.state.time,2);final.push(actor.state);}finally{actor.dispose();}}
    for(const s of final){assert.equal(s.grounded,true);near(s.y-s.body.centreToSoleM,0);assert.equal(s.flaps,1);}near(final[0].z,final[1].z,.03);near(final[1].z,final[2].z,.03);
  }
});

test('all species and LOD cycles retain grounded feet, stable physical profile and source identity in reduced motion',()=>{
  for(const appearance of APPEARANCES){const actor=createSpeciesActor(identity(),{world:plane(),appearance});try{step(actor,.1,{...idle,forward:1});const body=actor.state.body,feet=nativeFeet(actor.state),seq=actor.state.nextEventSequence,time=actor.state.time;
    for(const lod of [1,2,0]){const draft=actor.prepareLod(lod);assert.equal(draft.kind,'ready',draft.reason);draft.commit();assert.deepEqual(actor.state.body,body);assert.deepEqual(nativeFeet(actor.state),feet);assert.equal(actor.state.nextEventSequence,seq);assert.equal(actor.state.time,time);}
    const f=actor.prepareFrame(context(actor,.1,{reducedMotion:true}),idle);assert.equal(f.kind,'ready');f.commit();assert.equal(actor.snapshot().pose.reducedMotion,true);assert.equal(actor.state.grounded,true);
  }finally{actor.dispose();}}
});

test('actual fixed map supports seven species on both bridge layers/negative promenade without changing eye height',()=>{
  const map=makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}),world=createMapQueries(map);
  for(const appearance of APPEARANCES)for(const y of [0,-3.12]){
    const actor=createSpeciesActor(identity(),{world,appearance,feet:{x:95,y,z:405},view:{mode:'first',verticalFovDegrees:59,aspect:844/390}});
    try{step(actor,.05);const s=actor.snapshot();near(s.rootPosition[1],y);near(s.state.y-s.body.centreToSoleM,y);vectors(s.camera.position,Object.values(s.eye));if(y<0)assert.ok(s.eye.y<0);assert.equal(world.sphereClear({x:s.camera.position[0],y:s.camera.position[1],z:s.camera.position[2]},cameraNearRadius(s.projection)+.001),true);}finally{actor.dispose();}
  }
});

test('actual roof edge and full pose bounds distinguish sole/body clearance from wing/tail overhang',()=>{
  const map=makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}),world=createMapQueries(map),a=buildNativeAppearance(pigeon);
  const roof=map.roofs.find(r=>r.id==='gate:upper-roof'),x=roof.x+roof.width*.29-a.body.footSupportRadiusM-.03,ground=queryRoofSupport(map,x,roof.z,a.body.footSupportRadiusM);a.dispose();assert.ok(ground);
  const actor=createSpeciesActor(identity(),{world,appearance:pigeon,feet:{x,y:ground.y,z:roof.z}});
  try{const before=actor.snapshot(),result=actor.prepareAppearance(owl);assert.equal(result.kind,'blocked');assert.deepEqual(actor.snapshot(),before);}finally{actor.dispose();}
  const magpie=buildNativeAppearance(normalizeAppearance({speciesId:'magpie',skinId:'default'}));
  try{assert.ok(magpie.measurement.bounds.max[2]>magpie.body.horizontalRadiusM+.1);magpie.rig.pose({mode:'glide',time:1,flapAge:1,steps:0});const wings=localGeometryBounds(magpie.rig);assert.ok(wings.max[0]-wings.min[0]>magpie.body.horizontalRadiusM*2);measurements.push({appearance:magpie.appearance,lod:0,glideBounds:wings,bodyRadius:magpie.body.horizontalRadiusM,scope:'Visual overhang is not certified full-mesh swept clearance.'});}finally{magpie.dispose();}
});

test('actual Controls and frame transaction retain a rejected tap, discard paused time and never double-consume species events',()=>{
  class ElementStub extends EventTarget{style={removeProperty(){},transform:''};captured=new Set();querySelector(){return new ElementStub();}closest(){return null;}getBoundingClientRect(){return{left:0,top:0,width:122,height:122};}setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}}
  const saved={window:globalThis.window,document:globalThis.document,Element:globalThis.Element};globalThis.window=new EventTarget();globalThis.document=new EventTarget();globalThis.Element=ElementStub;document.hidden=false;document.hasFocus=()=>true;
  const controls=new Controls(new ElementStub(),new ElementStub(),new ElementStub());let gate={enabled:true,focused:true,hidden:false,paused:false,dialogOpen:false},clock=createFrameClock(gate),counter=0,unavailable=false;
  controls.setGate(gate);const world=plane(),actor=createSpeciesActor(identity(),{world:{...world,sphereClear:(...a)=>unavailable?undefined:world.sphereClear(...a)},appearance:normalizeAppearance({speciesId:'kestrel',skinId:'default'})});
  const key=(type,repeat=false)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{code:'Space',repeat});window.dispatchEvent(event);};
  function frame(timestamp){const before=clock,tick=transactNativeFrame(clock,timestamp,controls,(input,dt)=>actor.prepareFrame({contractVersion:1,frame:++counter,simTime:clock.activeSeconds+dt,rawSeconds:dt,acceptedSeconds:dt,playing:true,quality:'desktop',reducedMotion:false},input),()=>clock===before);clock=tick.clock;return tick;}
  try{frame(0);key('keydown');key('keyup');unavailable=true;const before=actor.snapshot();assert.equal(frame(17).status,'blocked');assert.deepEqual(actor.snapshot(),before);assert.equal(controls.preview().input.flapPressed,true);unavailable=false;assert.equal(frame(1017).acceptedSeconds,0);assert.equal(frame(1034).status,'committed');assert.equal(actor.state.flaps,1);assert.equal(actor.events.find(e=>e.raw.type==='flap').canonical.speciesId,'kestrel');near(clock.activeSeconds,actor.state.time);
    gate={...gate,paused:true};clock=applyControlsGate(controls,clock,gate);const paused=actor.snapshot();assert.equal(frame(5034).acceptedSeconds,0);assert.deepEqual(actor.snapshot(),paused);gate={...gate,paused:false};clock=applyControlsGate(controls,clock,gate);assert.equal(frame(9034).acceptedSeconds,0);assert.equal(frame(9051).status,'committed');near(clock.activeSeconds,actor.state.time);assert.equal(actor.state.flaps,1);
  }finally{actor.dispose();for(const [k,v]of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
