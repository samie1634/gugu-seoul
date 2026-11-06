import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createSpeciesActor,defaultBuildRig} from '../../src/species-core/index.ts';
const reports=[];
function fixture(){
 let actor, onPendingDispose=()=>{},fired=false;
 const world={
  supportAt(p){return Math.abs(p.at.y)<1e-6?{id:'floor',layerId:'floor',height:0,normal:{x:0,y:1,z:0},surface:'stone',walkable:true,landable:true}:null;},
  sweepBody(){return null;},sphereClear(p,r){return p.y>=r;},
  sweepSphere(a,b,r){return a.y>=r&&b.y>=r?null:undefined;},
 };
 const buildRig=options=>{
  const rig=defaultBuildRig(options);
  if(options.species==='sparrow'){
   let geometry;rig.root.traverse(o=>{if(!geometry&&o instanceof THREE.Mesh)geometry=o.geometry;});
   assert.ok(geometry);geometry.addEventListener('dispose',()=>{if(!fired){fired=true;onPendingDispose();}});
  }
  return rig;
 };
 actor=createSpeciesActor(new THREE.Group(),{world,dependencies:{buildRig},sessionId:'director-commit-reentry'});
 return{actor,setHook(f){onPendingDispose=f;}};
}
function ready(p){assert.equal(p.kind,'ready');return p;}
test('swap cleanup must not overwrite the winner committed by a synchronous geometry dispose listener',()=>{
 const f=fixture(),a=f.actor;
 try{
  ready(a.prepareAppearance({speciesId:'sparrow',skinId:'default'}));
  const outer=ready(a.prepareAppearance({speciesId:'crow',skinId:'default'}));
  let inner;
  f.setHook(()=>{ready(a.prepareAppearance({speciesId:'kestrel',skinId:'default'})).commit();inner=a.snapshot();});
  outer.commit();const final=a.snapshot();
  reports.push({case:'appearance-cleanup-reentry',inner:inner.appearance,innerVersion:inner.version,final:final.appearance,finalVersion:final.version});
  assert.equal(final.appearance.speciesId,'kestrel','outer ticket must be stale after the dispose listener committed a newer winner');
 }finally{a.dispose();fs.writeFileSync('evidence/commit-reentrancy.json',JSON.stringify(reports,null,2)+'\n');}
});
test('frame cleanup must not leave the visible species and logical body from different committed proposals',()=>{
 const f=fixture(),a=f.actor;
 try{
  ready(a.prepareAppearance({speciesId:'sparrow',skinId:'default'}));
  const frame=ready(a.prepareFrame({contractVersion:1,frame:1,simTime:1/60,rawSeconds:1/60,acceptedSeconds:1/60,playing:true,quality:'desktop',reducedMotion:false},{forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false}));
  f.setHook(()=>ready(a.prepareAppearance({speciesId:'kestrel',skinId:'default'})).commit());
  frame.commit();const final=a.snapshot();
  reports.push({case:'frame-cleanup-reentry',appearance:final.appearance,logicalBody:final.body.heightM,visibleBody:final.measurement.body.heightM,sourceTime:final.state.time,version:final.version});
  assert.equal(final.body.heightM,final.measurement.body.heightM,'logical body must match the visible committed species');
 }finally{a.dispose();fs.writeFileSync('evidence/commit-reentrancy.json',JSON.stringify(reports,null,2)+'\n');}
});
