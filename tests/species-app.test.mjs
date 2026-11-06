import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createNativeScene} from '../src/native/scene.ts';
import {nativeNear} from '../src/native/body-profile.ts';
import {createMapQueries} from '../src/native/ported/motion/locomotion/b2/map-queries.ts';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {transactNativeFrame} from '../src/native/frame-transaction.ts';
import {createFrameClock} from '../src/frame-clock.ts';
import {selectNativeLegacyLook} from '../src/native/legacy-selection.ts';
import {freshProgress,loadProgress,saveProgress,addPlayTime,LOOKS,STORAGE_KEY} from '../src/progress.ts';
import {APPEARANCES,defaultBuildRig} from '../src/species-core/index.ts';
const idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false},reports=[];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`),app=s=>({speciesId:s,skinId:s==='pigeon'?'gray':'default'});
const ready=p=>{assert.equal(p.kind,'ready',p.reason);return p;};
function lens(s,aspect=16/9){return{near:nativeNear(s.state.body,59,aspect),verticalFovDegrees:59,aspect};}
function step(s,dt=.1,input=idle,mode='third',callAge=10+s.state.time+dt,aspect=16/9){const p=ready(s.prepare(input,dt,lens(s,aspect),mode,callAge,false));p.commit();s.world.update(s.state.time,dt);return s.snapshot();}
function coherent(s){const v=s.snapshot();assert.equal(s.root.position.y,v.state.y-v.body.centreToSoleM);assert.deepEqual(s.root.scale.toArray(),[1,1,1]);assert.deepEqual(v.appearance,s.appearance);assert.equal(v.pose.time,v.state.time);if(v.cameraMode==='first'){v.camera.position.forEach((x,i)=>near(x,Object.values(v.posedEye)[i]));assert.equal(s.root.visible,false);}return v;}
function tracked(){const rows=[];return{rows,buildRig(options){const rig=defaultBuildRig(options),row={rig,options,disposes:0,resources:[],hook:null,fired:false},dispose=rig.dispose.bind(rig);rows.push(row);rig.dispose=()=>{row.disposes++;dispose();};for(const r of new Set([...rig.model.resources.geometries,...rig.model.resources.materials])){const entry={calls:0},original=r.dispose;row.resources.push(entry);r.dispose=function(){entry.calls++;return original.call(this);};}rig.model.resources.geometries[0].addEventListener('dispose',()=>{if(!row.fired){row.fired=true;row.hook?.();}});return rig;},last(species){return rows.findLast(r=>r.options.species===species);},released(){for(const r of rows){assert.equal(r.disposes,1);assert.ok(r.resources.every(x=>x.calls===1));}}};}
after(()=>fs.writeFileSync('evidence/app-integration-cases.json',JSON.stringify({atUTC:new Date().toISOString(),scope:'Actual local scene + ported core CPU integration. No browser/UI rendering or real device acceptance.',reports},null,2)+'\n'));

test('actual scene uses all seven internal species IDs and one combined canonical owner while NPC time follows accepted frames',()=>{
  const s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',sessionId:'app-species'});try{
    const ids=[];for(const a of APPEARANCES){assert.equal(s.selectAppearance(a),true);const before=s.snapshot(),v=step(s,.1,{...idle,flapPressed:true,flapHeld:true});const flap=v.events.find(e=>e.type==='flap');assert.equal(flap.speciesId,a.speciesId);ids.push(flap.id);assert.equal(flap.batchSequence,v.batchSequence);assert.equal(v.core.sequence,0);assert.equal(v.core.batch,0);assert.equal(v.npcs.acceptedCommits,before.npcs.acceptedCommits+1);near(v.npcs.lastClock.simTime,v.state.time);if(!['pigeon','eagle-owl'].includes(a.speciesId))assert.equal(s.look,null);coherent(s);}
    assert.equal(new Set(ids).size,8);assert.equal(s.snapshot().batchSequence,8);reports.push({case:'seven-species-canonical-app',flaps:ids.length,npcCommits:s.snapshot().npcs.acceptedCommits,time:s.state.time});
  }finally{s.dispose();}
});

test('actual main selection seam preserves legacy three-look unlock/save/reload/reset and does not store internal species',()=>{
  const s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile'}),p=freshProgress(),store={value:null,getItem(key){assert.equal(key,STORAGE_KEY);return this.value;},setItem(key,value){assert.equal(key,STORAGE_KEY);this.value=value;}};try{
    assert.deepEqual(LOOKS.map(x=>[x.id,x.seconds]),[['pigeon',0],['white',180],['owl',480]]);
    assert.equal(selectNativeLegacyLook(s,p,'white',lens(s)),false);p.activeSeconds=180;assert.equal(selectNativeLegacyLook(s,p,'white',lens(s)),true);assert.deepEqual(s.appearance,{speciesId:'pigeon',skinId:'white'});assert.equal(saveProgress(store,p),true);assert.equal(loadProgress(store).look,'white');
    p.activeSeconds=479.999;assert.equal(selectNativeLegacyLook(s,p,'owl',lens(s)),false);p.activeSeconds=480;assert.equal(selectNativeLegacyLook(s,p,'owl',lens(s)),true);assert.equal(s.appearance.speciesId,'eagle-owl');saveProgress(store,p);assert.deepEqual(loadProgress(store),p);
    assert.equal(s.selectAppearance(app('crow')),true);assert.equal(s.look,null);const before=p.look;assert.equal(selectNativeLegacyLook(s,p,'not-a-look',lens(s)),false);assert.equal(p.look,before);
    assert.equal(s.home('pigeon'),true);Object.assign(p,freshProgress());saveProgress(store,p);assert.equal(loadProgress(store).look,'pigeon');assert.equal(selectNativeLegacyLook(s,p,'owl',lens(s)),false);
  }finally{s.dispose();}
});

test('same-time FP rebind adopts actual eye/new near/aspect while ordinary zero time leaves pose/NPC/events unchanged',()=>{
  const s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',preset:'under-bridge'});try{
    step(s,.02,idle,'first');const before=s.snapshot();assert.equal(s.selectLook('owl',{verticalFovDegrees:59,aspect:844/390}),true);const after=coherent(s);assert.equal(after.core.cameraOperation,'appearance-rebind');assert.equal(after.camera.cut,true);near(after.state.time,before.state.time);assert.deepEqual(after.npcs,before.npcs);assert.equal(after.sequence,before.sequence);assert.equal(after.projection.aspect,844/390);near(after.sole.y,-3.12);assert.ok(after.posedEye.y<0);
    assert.equal(s.prepare(idle,0,lens(s),'first',0,false).kind,'blocked');const zero=s.snapshot();assert.deepEqual(zero.state,after.state);assert.deepEqual(zero.pose,after.pose);assert.deepEqual(zero.camera,after.camera);assert.deepEqual(zero.npcs,after.npcs);assert.equal(zero.sequence,after.sequence);
  }finally{s.dispose();}
});

test('app placement/new-near failures preserve actor, canonical/NPC clocks and only release the failed new model',()=>{
  const base=createMapQueries(makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'})),t=tracked();let failure='none';
  const world={...base,sweepBody:(a,b,body)=>failure==='body'&&body.heightM>.3?undefined:base.sweepBody(a,b,body),sphereClear:(p,r)=>failure==='near'&&r>.08?undefined:base.sphereClear(p,r)};
  const s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',world,actorDependencies:{buildRig:t.buildRig}});try{
    step(s);for(const kind of ['body','near']){failure=kind;const before=s.snapshot();assert.equal(s.selectLook('owl'),false);assert.deepEqual(s.snapshot(),before);assert.equal(t.last('eagle-owl').disposes,1);assert.equal(t.last('pigeon').disposes,0);}failure='none';assert.equal(s.selectLook('owl'),true);coherent(s);
  }finally{s.dispose();t.released();}
});

test('actual accepted frame cleanup can select a newer internal species without mixed body/events or duplicate NPC/input/clock',()=>{
  const t=tracked(),s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',actorDependencies:{buildRig:t.buildRig}}),p=freshProgress();let clock=createFrameClock({enabled:true,focused:true,hidden:false,paused:false,dialogOpen:false}),edge=true,commits=0;
  const controls={preview(){return{input:{...idle,flapPressed:edge},isCurrent:()=>true,commit(){edge=false;commits++;return true;}};}};
  const tick=at=>{const v=transactNativeFrame(clock,at,controls,(input,dt)=>s.prepare(input,dt,lens(s),'third',10+s.state.time+dt,false));clock=v.clock;if(v.status==='committed')addPlayTime(p,v.acceptedSeconds,true);return v;};
  try{tick(0);ready(s.prepareAppearance(app('sparrow')));t.last('sparrow').hook=()=>{assert.equal(s.prepare(idle,.1,lens(s),'third',10,false).reason,'commit-finalization-in-progress');assert.equal(s.selectAppearance(app('kestrel')),true);throw new Error('app-cleanup-error');};assert.equal(tick(100).status,'committed');const v=coherent(s);assert.equal(v.appearance.speciesId,'kestrel');assert.equal(v.body.heightM,.24);assert.equal(v.events.find(e=>e.type==='flap').speciesId,'pigeon');assert.equal(v.npcs.acceptedCommits,1);assert.equal(v.npcs.drains,1);assert.equal(commits,1);near(clock.activeSeconds,v.state.time);near(p.activeSeconds,v.state.time);assert.ok(v.core.cleanupErrors.includes('app-cleanup-error'));assert.equal(v.core.sequence,0);reports.push({case:'actual-frame-cleanup-winner',species:v.appearance.speciesId,bodyHeight:v.body.heightM,npcCommits:v.npcs.acceptedCommits,progress:p.activeSeconds});}
  finally{s.dispose();t.released();}
});

test('actual UI selection seam stores the latest permitted legacy cleanup winner and leaves NPC/clock untouched',()=>{
  const t=tracked(),s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',actorDependencies:{buildRig:t.buildRig}}),p={...freshProgress(),activeSeconds:480};try{
    ready(s.prepareAppearance(app('sparrow')));t.last('sparrow').hook=()=>assert.equal(s.selectLook('white'),true);const before=s.snapshot();assert.equal(selectNativeLegacyLook(s,p,'owl',lens(s)),true);const v=coherent(s);assert.equal(v.look,'white');assert.equal(p.look,'white');assert.deepEqual(v.npcs,before.npcs);assert.equal(v.state.time,before.state.time);assert.equal(v.sequence,before.sequence);
  }finally{s.dispose();t.released();}
});

test('landing preview/rejection/commit and species swap share the source-time blend with exactly one NPC tick',()=>{
  const base=createMapQueries(makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}));let fail=false;const s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',preset:'roof-drop',world:{...base,sphereClear:(...args)=>fail?undefined:base.sphereClear(...args)}});try{
    for(let i=0;i<100;i++){const v=s.snapshot(),ground=s.queries.supportAt({at:v.sole,previousFeetY:v.sole.y,footRadiusM:v.body.footSupportRadiusM,heightM:v.body.heightM,maxRiseM:.000002,maxDropM:1});assert.ok(ground);if(v.sole.y-ground.height<.08)break;step(s,.01);}
    const before=s.snapshot();assert.equal(before.state.grounded,false);fail=true;assert.equal(s.prepare(idle,.1,lens(s),'third',10,false).kind,'blocked');const rejected=s.snapshot();assert.deepEqual(rejected.state,before.state);assert.deepEqual(rejected.pose,before.pose);assert.deepEqual(rejected.npcs,before.npcs);fail=false;
    const q=ready(s.prepare(idle,.1,lens(s),'third',10,false));assert.deepEqual(s.snapshot().pose,before.pose);q.commit();const landed=s.snapshot(),event=landed.events.find(e=>e.type==='land');assert.ok(event);assert.equal(landed.landedAt,event.simTime);assert.ok(landed.pose.landing>0);assert.equal(landed.npcs.acceptedCommits,before.npcs.acceptedCommits+1);assert.equal(s.selectLook('white'),true);assert.equal(s.snapshot().landedAt,event.simTime);step(s,.1);step(s,.1);step(s,.1);assert.equal(s.snapshot().pose.landing,0);assert.equal(s.snapshot().recentEvents.filter(e=>e.type==='land').length,1);
  }finally{s.dispose();}
});

test('approved call age is staged with pose/eye and rejected or zero-time app frames do not move its source time',()=>{
  const base=createMapQueries(makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}));let fail=false;const s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',world:{...base,sphereClear:(...args)=>fail?undefined:base.sphereClear(...args)}});try{
    const v=step(s,.1,idle,'first',.02);near(v.calledAt,.08);near(v.pose.callAge,.02);coherent(s);fail=true;assert.equal(s.prepare(idle,.1,lens(s),'first',.01,false).kind,'blocked');assert.equal(s.snapshot().calledAt,v.calledAt);assert.deepEqual(s.snapshot().pose,v.pose);assert.deepEqual(s.snapshot().npcs,v.npcs);fail=false;const next=step(s,.1,idle,'first',.12);near(next.calledAt,.08);near(next.pose.callAge,.12);assert.equal(next.npcs.acceptedCommits,v.npcs.acceptedCommits+1);
  }finally{s.dispose();}
});

test('full foot roof-edge and larger-species ceiling rejection keep the actual scene coherent',()=>{
  const roof=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',preset:'roof-edge'});try{const before=roof.snapshot();assert.equal(roof.selectLook('owl'),false);assert.deepEqual(roof.snapshot(),before);coherent(roof);}finally{roof.dispose();}
  const high=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',spawnForTest:()=>({feet:{x:-37,y:179.75,z:8},heading:0})});try{const before=high.snapshot();assert.equal(high.selectLook('owl'),false);assert.deepEqual(high.snapshot(),before);}finally{high.dispose();}
});

test('home and stale proposals preserve NPC owner, canonical/raw continuity and the actual hidden identity',()=>{
  const s=createNativeScene(new THREE.Scene(),'pigeon',{quality:'mobile',initialAppearance:app('crow'),sessionId:'home-stream'});try{
    step(s,.1,{...idle,flapPressed:true});const stale=ready(s.prepare(idle,.1,lens(s),'third',10,false)),before=s.snapshot();assert.equal(s.home(),true);assert.equal(s.appearance.speciesId,'crow');assert.equal(s.look,null);assert.deepEqual(s.snapshot().npcs,before.npcs);assert.equal(s.state.nextEventSequence,before.state.nextEventSequence);assert.equal(s.snapshot().sequence,before.sequence);assert.throws(()=>stale.commit(),/Stale/);
    const final=step(s,.1,{...idle,flapPressed:true});assert.equal(final.events.find(e=>e.type==='flap').speciesId,'crow');assert.equal(final.batchSequence,before.batchSequence+1);assert.equal(final.state.time,before.state.time+.1);assert.equal(final.sessionId,'home-stream');
  }finally{s.dispose();}
});

test('home stages a private detached actor owner and publishes coherent scene links before root callbacks',()=>{
  const parent=new THREE.Scene();let s,watch=false,staged=false,inspectHome=true;
  s=createNativeScene(parent,'pigeon',{quality:'mobile',actorDependencies:{buildRig(options){const rig=defaultBuildRig(options);rig.root.addEventListener('added',()=>{if(watch&&rig.root.parent!==s.root.parent){staged=true;assert.equal(rig.root.parent.parent===null,true,'a not-yet-accepted home actor must stay outside the live scene');}});return rig;}}});
  try{
    const owner=s.root.parent;owner.addEventListener('removed',()=>{if(!inspectHome)return;assert.equal(parent.children.filter(o=>o.name==='player-bird-owner').length,1);assert.equal(s.root.parent.parent===parent,true);assert.equal(s.selectLook('white'),true);});
    watch=true;assert.equal(s.home(),true);assert.equal(staged,true);assert.equal(s.look,'white');assert.equal(parent.children.filter(o=>o.name==='player-bird-owner').length,1);
  }finally{inspectHome=false;s.dispose();}
});
