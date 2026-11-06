import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createSpeciesActor,defaultBuildRig} from '../../src/species-core/index.ts';
import {Controls,applyControlsGate} from '../../src/input.ts';
import {createFrameClock} from '../../src/frame-clock.ts';
import {transactNativeFrame} from '../../src/native/frame-transaction.ts';

const idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false},reports=[];
const appearance=speciesId=>({speciesId,skinId:speciesId==='pigeon'?'gray':'default'});
const ready=p=>{assert.equal(p.kind,'ready',p.reason);return p;};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const context=(actor,dt=1/60)=>{const s=actor.snapshot();return{contractVersion:1,frame:s.lastFrame+1,simTime:s.state.time+dt,rawSeconds:dt,acceptedSeconds:dt,playing:true,quality:'desktop',reducedMotion:false};};
function fixture(mode='third'){
  const parent=new THREE.Group(),rows=[],floor={id:'floor',layerId:'floor',height:0,normal:{x:0,y:1,z:0},surface:'stone',walkable:true,landable:true};
  let actor;
  const world={supportAt(p){return Math.min(p.at.y,p.previousFeetY)-p.maxDropM<=0&&p.previousFeetY+p.maxRiseM>=0?floor:null;},sweepBody(){return null;},sphereClear(p,r){return p.y>=r-1e-8;},sweepSphere(a,b,r){return a.y>=r-1e-8&&b.y>=r-1e-8?null:undefined;}};
  actor=createSpeciesActor(parent,{world,sessionId:'lifecycle',view:{mode,verticalFovDegrees:59,aspect:844/390},dependencies:{buildRig(options){
    const rig=defaultBuildRig(options),row={rig,options,resources:[],disposeCalls:0,onDispose:undefined,fired:false};rows.push(row);
    const dispose=rig.dispose.bind(rig);rig.dispose=()=>{row.disposeCalls++;dispose();};
    for(const resource of new Set([...rig.model.resources.geometries,...rig.model.resources.materials])){
      const entry={resource,attempts:0},original=resource.dispose;row.resources.push(entry);resource.dispose=function(){entry.attempts++;return original.call(this);};
    }
    row.resources[0].resource.addEventListener('dispose',()=>{if(!row.fired){row.fired=true;row.onDispose?.();}});
    return rig;
  }}});
  return{actor,parent,rows,row(species){return rows.findLast(r=>r.options.species===species);}};
}
function coherent(f){
  const a=f.actor,s=a.snapshot(),row=f.rows.find(r=>r.rig.root===a.root);assert.ok(row);assert.equal(row.options.species,s.appearance.speciesId);
  assert.equal(a.root.parent,f.parent);assert.deepEqual(f.parent.children,[a.root]);assert.deepEqual(s.body,s.state.body);
  near(s.body.heightM,s.measurement.body.heightM);const eye=row.rig.getEyeWorldPosition(new THREE.Vector3());
  near(eye.x,s.eye.x);near(eye.y,s.eye.y);near(eye.z,s.eye.z);near(s.rootPosition[1],s.state.y-s.body.centreToSoleM);
  if(s.view.mode==='first'){s.camera.position.forEach((v,i)=>near(v,[eye.x,eye.y,eye.z][i]));}
  return s;
}
function allReleasedOnce(f){for(const row of f.rows){assert.equal(row.disposeCalls,1,row.options.species);for(const r of row.resources)assert.equal(r.attempts,1,row.options.species);}}
after(()=>fs.writeFileSync('evidence/lifecycle-cases.json',JSON.stringify({atUTC:new Date().toISOString(),scope:'CPU synchronous Three events/dispose reentrancy, not browser or GPU acceptance.',reports},null,2)+'\n'));

test('pending cleanup sees a complete adoption; its newer winner remains complete in first person',()=>{
  const f=fixture('first'),a=f.actor;try{
    const pending=ready(a.prepareAppearance(appearance('sparrow'))),outer=ready(a.prepareAppearance(appearance('crow'))),before=a.snapshot();
    let inside;
    f.row('sparrow').onDispose=()=>{const adopted=coherent(f);assert.equal(adopted.appearance.speciesId,'crow');assert.equal(pending.isCurrent(),false);ready(a.prepareAppearance(appearance('kestrel'))).commit();inside=coherent(f);};
    outer.commit();const final=coherent(f);assert.equal(final.appearance.speciesId,'kestrel');assert.deepEqual(final,inside);assert.equal(final.state.time,before.state.time);assert.equal(final.version,before.version+2);assert.equal(final.cameraOperation,'appearance-rebind');
    assert.equal(f.row('kestrel').disposeCalls,0);reports.push({case:'FP-newer-winner',species:final.appearance.speciesId,version:final.version,time:final.state.time});
  }finally{a.dispose();allReleasedOnce(f);}
});

test('all old pending tickets invalidate before any listener; nested tickets are not swept by an old cleanup',()=>{
  const f=fixture(),a=f.actor;try{
    const pending=['sparrow','crow','magpie'].map(s=>ready(a.prepareAppearance(appearance(s)))),outer=ready(a.prepareAppearance(appearance('eagle-owl')));let newTicket;
    f.row('sparrow').onDispose=()=>{for(const p of pending)assert.equal(p.isCurrent(),false);assert.throws(()=>pending[1].commit(),/stale/);newTicket=ready(a.prepareAppearance(appearance('kestrel')));};
    outer.commit();assert.equal(newTicket.isCurrent(),true);assert.equal(a.appearance.speciesId,'eagle-owl');newTicket.commit();assert.equal(coherent(f).appearance.speciesId,'kestrel');
  }finally{a.dispose();allReleasedOnce(f);}
});

test('explicit cancellation preserves a newer cleanup winner and invalidates an older frame',()=>{
  const f=fixture(),a=f.actor;try{
    const frame=ready(a.prepareFrame(context(a),idle)),pending=ready(a.prepareAppearance(appearance('sparrow')));
    f.row('sparrow').onDispose=()=>ready(a.prepareAppearance(appearance('kestrel'))).commit();pending.cancel();const final=coherent(f);
    assert.equal(final.appearance.speciesId,'kestrel');assert.equal(final.state.time,0);assert.equal(final.batch,0);assert.throws(()=>frame.commit(),/stale/);pending.cancel();assert.deepEqual(a.snapshot(),final);
  }finally{a.dispose();allReleasedOnce(f);}
});

test('retired active-model cleanup may commit another same-time winner without resurrection',()=>{
  const f=fixture(),a=f.actor;try{
    f.row('pigeon').onDispose=()=>{assert.equal(coherent(f).appearance.speciesId,'crow');ready(a.prepareAppearance(appearance('magpie'))).commit();};
    ready(a.prepareAppearance(appearance('crow'))).commit();assert.equal(coherent(f).appearance.speciesId,'magpie');assert.equal(f.row('crow').disposeCalls,1);assert.equal(f.row('magpie').disposeCalls,0);
  }finally{a.dispose();allReleasedOnce(f);}
});

test('normal Three root notifications run after coherent links and retain a nested successful swap',()=>{
  const f=fixture(),a=f.actor,events=[];try{
    a.root.addEventListener('removed',()=>{assert.equal(coherent(f).appearance.speciesId,'crow');events.push('old-removed');});
    const outer=ready(a.prepareAppearance(appearance('crow'))),crow=f.row('crow');
    crow.rig.root.addEventListener('added',()=>{coherent(f);events.push('crow-added');ready(a.prepareAppearance(appearance('kestrel'))).commit();});
    f.parent.addEventListener('childadded',event=>{assert.ok(event.child);coherent(f);events.push('parent-childadded');});
    outer.commit();assert.equal(coherent(f).appearance.speciesId,'kestrel');assert.ok(events.includes('old-removed'));assert.ok(events.includes('crow-added'));assert.equal(events.filter(x=>x==='parent-childadded').length,2);
  }finally{a.dispose();allReleasedOnce(f);}
});

test('throwing root, geometry and material callbacks are recorded and every owned resource is attempted once',()=>{
  const f=fixture(),a=f.actor;try{
    const old=f.row('pigeon');a.root.addEventListener('removed',()=>{throw new Error('root-listener-error');});
    old.resources[0].resource.addEventListener('dispose',()=>{throw new Error('geometry-listener-error');});
    old.resources.find(r=>r.resource instanceof THREE.Material).resource.addEventListener('dispose',()=>{throw new Error('material-listener-error');});
    const outer=ready(a.prepareAppearance(appearance('crow')));assert.doesNotThrow(()=>outer.commit());const final=coherent(f);
    for(const message of ['root-listener-error','geometry-listener-error','material-listener-error'])assert.ok(final.cleanupErrors.includes(message));
    for(const r of old.resources)assert.equal(r.attempts,1);assert.equal(f.row('crow').disposeCalls,0);reports.push({case:'cleanup-errors-visible',errors:final.cleanupErrors});
  }finally{a.dispose();allReleasedOnce(f);}
});

test('a throwing pending listener cannot stop another pending release or erase its successful nested swap',()=>{
  const f=fixture(),a=f.actor;try{
    ready(a.prepareAppearance(appearance('sparrow')));ready(a.prepareAppearance(appearance('magpie')));const outer=ready(a.prepareAppearance(appearance('crow')));
    f.row('sparrow').onDispose=()=>{ready(a.prepareAppearance(appearance('kestrel'))).commit();throw new Error('nested-after-success');};
    assert.doesNotThrow(()=>outer.commit());const final=coherent(f);assert.equal(final.appearance.speciesId,'kestrel');assert.ok(final.cleanupErrors.includes('nested-after-success'));assert.equal(f.row('magpie').disposeCalls,1);
    assert.throws(()=>outer.commit(),/stale/);assert.equal(coherent(f).appearance.speciesId,'kestrel');
  }finally{a.dispose();allReleasedOnce(f);}
});

test('a producer scene-graph callback throwing before its resource loop still releases every owned resource',()=>{
  const f=fixture(),a=f.actor;try{
    const old=f.row('pigeon');old.rig.root.children[0].addEventListener('removed',()=>{throw new Error('producer-mount-error');});
    assert.doesNotThrow(()=>ready(a.prepareAppearance(appearance('crow'))).commit());assert.equal(coherent(f).appearance.speciesId,'crow');assert.ok(a.snapshot().cleanupErrors.includes('producer-mount-error'));
    assert.ok(old.resources.every(r=>r.attempts===1));
  }finally{a.dispose();allReleasedOnce(f);}
});

test('a resource callback disposing another owned resource does not double-release it in the producer loop',()=>{
  const f=fixture(),a=f.actor;try{
    const old=f.row('pigeon');old.resources[0].resource.addEventListener('dispose',()=>old.resources[1].resource.dispose());
    ready(a.prepareAppearance(appearance('crow'))).commit();assert.equal(coherent(f).appearance.speciesId,'crow');assert.ok(old.resources.every(r=>r.attempts===1));
  }finally{a.dispose();allReleasedOnce(f);}
});

test('dispose from frame cleanup is terminal and cannot resurrect the adopted model',()=>{
  const f=fixture(),a=f.actor;ready(a.prepareAppearance(appearance('sparrow')));const frame=ready(a.prepareFrame(context(a),idle));
  f.row('sparrow').onDispose=()=>{coherent(f);a.dispose();assert.equal(a.prepareAppearance(appearance('kestrel')).reason,'disposed');};
  assert.doesNotThrow(()=>frame.commit());assert.equal(a.snapshot().disposed,true);near(a.state.time,1/60);assert.equal(a.root.parent,null);assert.deepEqual(f.parent.children,[]);a.dispose();allReleasedOnce(f);
});

test('a cleanup LOD winner retains the full new species body, eye and source cursor',()=>{
  const f=fixture('first'),a=f.actor;try{
    ready(a.prepareAppearance(appearance('sparrow')));const outer=ready(a.prepareAppearance(appearance('crow')));
    f.row('sparrow').onDispose=()=>ready(a.prepareLod(2)).commit();outer.commit();const s=a.snapshot();assert.equal(s.appearance.speciesId,'crow');assert.equal(s.lod,2);assert.equal(a.root.parent,f.parent);assert.equal(s.state.time,0);assert.equal(s.batch,0);assert.equal(s.sequence,0);assert.equal(s.cameraOperation,'appearance-rebind');
    const row=f.rows.find(r=>r.rig.root===a.root),eye=row.rig.getEyeWorldPosition(new THREE.Vector3());near(s.eye.y,eye.y);s.camera.position.forEach((x,i)=>near(x,eye.toArray()[i]));assert.equal(f.row('crow').disposeCalls,1); // temporary canonicalLOD0
  }finally{a.dispose();allReleasedOnce(f);}
});

test('real input/clock commits once despite cleanup swap/throw and rejects recursive frame advancement',()=>{
  class ElementStub extends EventTarget{style={removeProperty(){},transform:''};querySelector(){return new ElementStub();}closest(){return null;}getBoundingClientRect(){return{left:0,top:0,width:122,height:122};}setPointerCapture(){}hasPointerCapture(){return false;}releasePointerCapture(){}}
  const saved={window:globalThis.window,document:globalThis.document,Element:globalThis.Element};globalThis.window=new EventTarget();globalThis.document=new EventTarget();globalThis.Element=ElementStub;document.hidden=false;document.hasFocus=()=>true;
  const f=fixture('first'),a=f.actor,controls=new Controls(new ElementStub(),new ElementStub(),new ElementStub());let gate={enabled:true,focused:true,hidden:false,paused:false,dialogOpen:false},clock=createFrameClock(gate),counter=0;
  controls.setGate(gate);const frame=timestamp=>{const before=clock,tick=transactNativeFrame(clock,timestamp,controls,(input,dt)=>a.prepareFrame({...context(a,dt),frame:++counter,simTime:clock.activeSeconds+dt},input),()=>clock===before);clock=tick.clock;return tick;};
  try{
    frame(0);ready(a.prepareAppearance(appearance('sparrow')));let nested;
    f.row('sparrow').onDispose=()=>{assert.equal(a.prepareFrame(context(a),idle).reason,'commit-finalization-in-progress');ready(a.prepareAppearance(appearance('kestrel'))).commit();nested=coherent(f);throw new Error('clock-cleanup-error');};
    for(const type of ['keydown','keyup']){const event=new Event(type,{cancelable:true});Object.assign(event,{code:'Space',repeat:false});window.dispatchEvent(event);}
    assert.equal(frame(17).status,'committed');const s=coherent(f);assert.equal(s.appearance.speciesId,'kestrel');assert.equal(s.state.flaps,1);assert.equal(s.batch,1);assert.equal(s.sequence,1);near(s.state.time,clock.activeSeconds);assert.equal(s.state.time,nested.state.time);assert.equal(s.events[0].canonical.speciesId,'pigeon');assert.equal(controls.preview().input.flapPressed,false);assert.ok(s.cleanupErrors.includes('clock-cleanup-error'));
    gate={...gate,paused:true};clock=applyControlsGate(controls,clock,gate);const paused=a.snapshot();assert.equal(frame(3017).acceptedSeconds,0);assert.deepEqual(a.snapshot(),paused);gate={...gate,paused:false};clock=applyControlsGate(controls,clock,gate);assert.equal(frame(6017).acceptedSeconds,0);assert.equal(frame(6034).status,'committed');assert.equal(a.state.flaps,1);near(a.state.time,clock.activeSeconds);
    reports.push({case:'input-clock-reentry',activeSeconds:clock.activeSeconds,flaps:a.state.flaps,species:a.appearance.speciesId,sequence:a.snapshot().sequence});
  }finally{a.dispose();allReleasedOnce(f);for(const [k,v]of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
