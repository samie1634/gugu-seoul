import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Controls } from '../src/input.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { createGroundPigeon, PIGEON_PECK } from '../src/pigeon-ground.ts';
import { createFlightPigeon, PIGEON_APPROVED_WINGBEAT, PIGEON_GLIDE, PIGEON_FALL, shoulderPoseTime } from '../src/pigeon-flight.ts';
import { pigeonPeckClockDelta } from '../src/pigeon-kinematics.ts';
import { preparePigeonTakeoff } from '../src/pigeon-takeoff-intent.ts';

class Button extends EventTarget {
  style = { removeProperty() {}, transform: '' };
  querySelector() { return new Button(); }
  closest() { return null; }
}
const neutral = { started: true, look: 'pigeon', firstPerson: false, reducedMotion: false };
const projection = { near: .03, verticalFovDegrees: 59, aspect: 390 / 844 };
const models = {
  'idea-pigeon-ground.glb':'f597d7e608b33c3443d99dc9ffa39a77f99bb0437e8807171e69990da65c16df',
  'idea-pigeon-flight-approved.glb':'12188f2684fb3475b97b2259328dddc21dbd5741ae8bbb4a172303db7452b5d9',
};
const caseAssets = (name) => {
  // CPU mesh/animation probe. Do not claim device textures, WebGL or sound.
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });
  globalThis.ProgressEvent ??= class {};
  return async url => {
    assert.equal(url, './models/' + name);
    const raw = readFileSync(new URL('../public/models/' + name, import.meta.url));
    assert.equal(createHash('sha256').update(raw).digest('hex'), models[name]);
    return new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
  };
};

function harness(t, key) {
  const scene = new THREE.Scene();
  delete globalThis.document; // Skip texture-only canvases, not default OSM terrain or simulation.
  const native = createNativeScene(scene, 'pigeon', { preset:'plaza', mapData:'osm', quality:'mobile', sessionId:key });
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget(); globalThis.Element = Button;
  document.hasFocus = () => true; document.hidden = false;
  const tap = new Button(), flap = new Button();
  const controls = new Controls(new Button(), flap, new Button(), tap);
  controls.setGate({ enabled:true, focused:true, hidden:false, paused:false, dialogOpen:false });
  t.after(() => native.dispose());
  return { controls, tap, flap, scene, native };
}

test('ordinary mobile native scene: initial tap and R play exact full ground motion before auto wait and never count an NPC hit', async t => {
  const { controls, tap, scene, native } = harness(t, 'approved-ground');
  const ground = createGroundPigeon(scene, './', caseAssets('idea-pigeon-ground.glb'));
  let age=10, serial=0;
  controls.onPeck=()=>{ age=0; serial++; };
  const dt=.01;
  const update = (acceptedSeconds=dt,extra={}) => {
    if (acceptedSeconds) {
      age += pigeonPeckClockDelta(native.look, acceptedSeconds);
      const prepared = native.prepare(controls.sample(), acceptedSeconds, projection, 'third', 10, false, age,
        undefined, Infinity, ground.ready);
      assert.equal(prepared.kind,'ready',prepared.reason);
      prepared.commit();
    }
    return ground.update(native.state,{ ...neutral,committedSeconds:acceptedSeconds,distance:0,cooAge:10,
      flirtAge:Infinity,landedRecently:false,manualPeckAge:age,manualPeckSerial:serial,manualPeckKind:native.peckKind,...extra });
  };
  const untouched=()=>native.snapshot().flock.birds.map(b=>[b.id,b.peckHits]);
  const before=untouched();
  assert.equal(update(),false);
  for (let i=0;!ground.ready && i<60;i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(ground.ready,true);
  assert.equal(update(),true);
  for (let i=0;i<20;i++) update();
  const head=ground.root.getObjectByName('Head');
  const samples=[];
  tap.dispatchEvent(new Event('click',{ cancelable:true }));
  assert.equal(update(),true);
  assert.equal(ground.snapshot().manualAge,0);
  assert.equal(ground.snapshot().clip,PIGEON_PECK);
  samples.push(head.getWorldPosition(new THREE.Vector3()).sub(ground.root.position));
  for (let i=1;i<=230;i++) {
    update();
    if ([63,112,158,230].includes(i)) samples.push(head.getWorldPosition(new THREE.Vector3()).sub(ground.root.position));
  }
  const [up,left,right,center,recovered]=samples;
  assert.ok([left,right,center].every(p=>p.y < up.y - .09));
  assert.ok(left.distanceTo(right) > .065 && right.distanceTo(center) > .04 && left.distanceTo(center) > .012);
  assert.ok(recovered.y > up.y - .01);
  assert.equal(ground.snapshot().peckAge,-1);
  assert.deepEqual(untouched(),before);
  const key = type => window.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{code:'KeyR',repeat:false}));
  key('keydown'); key('keyup');
  assert.equal(update(),true);
  assert.equal(ground.snapshot().manualAge,0);
  assert.equal(ground.snapshot().clip,PIGEON_PECK);
  assert.equal(update(0,{firstPerson:true}),false);
});

test('exact shoulder GLB follows real native flap and glide physics, with both flanks changing height and no gray fallback in descent', async t => {
  const { controls, scene, native } = harness(t, 'approved-flight');
  let parse;
  const flight = createFlightPigeon(scene, './', url => parse = caseAssets('idea-pigeon-flight-approved.glb')(url));
  const apply = (extra={}) => flight.update(native.state,native.root,{ ...neutral,preload:true,descend:false,...extra });
  assert.equal(apply({preload:false}),false);
  assert.equal(flight.snapshot().loadState,'idle');
  assert.equal(apply(),false);
  const parsed=await parse;
  assert.ok(parsed.animations.some(clip=>clip.name===PIGEON_APPROVED_WINGBEAT));
  assert.equal(flight.snapshot().loadState,'ready');
  assert.equal(apply(),false);
  window.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code:'Space',repeat:false}));
  const candidates=[];
  parsed.scene.traverse(node=>{
    if (!node.morphTargetInfluences || !node.geometry.getAttribute('position')) return;
    const attr=node.geometry.getAttribute('position');
    for (let i=0;i<attr.count;i+=3) {
      const v=node.localToWorld(new THREE.Vector3().fromBufferAttribute(attr,i));
      if (Math.abs(v.x)>.26) candidates.push([node,i,v.x<0?0:1]);
    }
  });
  assert.ok(candidates.some(c=>c[2]===0)&&candidates.some(c=>c[2]===1));
  const pose=()=>candidates.map(([node,i])=>{
    return flight.root.worldToLocal(node.localToWorld(node.getVertexPosition(i,new THREE.Vector3()))).y;
  });
  let taken, down, cycleEnded;
  for (let i=0;i<80;i++) {
    const p=native.prepare(controls.sample(),.01,projection,'third',10,false);
    assert.equal(p.kind,'ready',p.reason); p.commit();
    assert.equal(apply(),true);
    assert.deepEqual(flight.root.position.toArray(),native.root.position.toArray());
    if (i===0) taken=pose();
    if (i===39) down=pose();
    if (i===79) cycleEnded=pose();
  }
  assert.equal(native.state.mode,'glide');
  assert.ok(native.state.y>1);
  for(const side of [0,1]) {
    assert.ok(Math.max(...down.map((v,i)=>candidates[i][2]===side?Math.abs(v-taken[i]):0))>.18,
      'approved wing poses on both sides must visibly change, not merely switch actors');
    assert.ok(Math.max(...cycleEnded.map((v,i)=>candidates[i][2]===side?Math.abs(v-taken[i]):0))<.04,
      'approved loop returns to its opening pose before spreading');
  }
  assert.equal(shoulderPoseTime(10),.21);
  assert.equal(apply({firstPerson:true}),false);
  assert.equal(apply({descend:true}),true);
  assert.equal(flight.snapshot().clip,PIGEON_FALL);
  assert.equal(apply({look:'white'}),false);
  assert.equal(apply({reducedMotion:true}),true);
  assert.equal(flight.snapshot().clip,PIGEON_GLIDE);
  assert.equal(flight.snapshot().clipTime,0);
  assert.equal(apply(),true);
});

test('the first mobile click during load still flies natively, then plays one full approved visual after readiness', async t => {
  const { controls, flap, scene, native } = harness(t, 'approved-flight-delayed');
  let release, requested=0;
  const g=createFlightPigeon(scene,'./',()=>{requested++;return new Promise(resolve=>{release=resolve;});});
  const present=(extra={})=>g.update(native.state,native.root,{...neutral,preload:true,descend:false,...extra});
  assert.equal(present({started:false}),false);
  assert.equal(requested,1);
  flap.dispatchEvent(new Event('click'));
  for (let i=0;i<48;i++) {
    const p=native.prepare(controls.sample(),.01,projection,'third',10,false);
    assert.equal(p.kind,'ready',p.reason); p.commit();
    assert.equal(present(),false);
  }
  assert.equal(native.state.flaps,1);
  assert.equal(native.state.grounded,false);
  assert.equal(g.snapshot().queuedFlap,true);
  release({scene:new THREE.Group(),animations:[new THREE.AnimationClip(PIGEON_APPROVED_WINGBEAT,.8,[])]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.snapshot().loadState,'ready');
  assert.equal(present({committedSeconds:0}),false);
  assert.equal(g.snapshot().queuedFlap,true);
  assert.equal(present(),true);
  assert.equal(g.snapshot().clipTime,0);
  assert.equal(g.snapshot().queuedFlap,false);
  const p=native.prepare(controls.sample(),.02,projection,'third',10,false);
  assert.equal(p.kind,'ready',p.reason); p.commit();
  assert.equal(present({committedSeconds:.02}),true);
  assert.ok(Math.abs(g.snapshot().clipTime-.02)<1e-9);
  assert.equal(native.state.flaps,1,'the late visual does not produce another physical impulse');
});

test('cold first flap release stays grounded until render readiness and then launches the approved rig and sound event once', async t => {
  const { controls, flap, scene, native } = harness(t, 'approved-ready-first-takeoff');
  let resolveModel;
  const visual=createFlightPigeon(scene,'./',()=>new Promise(resolve=>{resolveModel=resolve;}));
  const present=()=>visual.update(native.state,native.root,{...neutral,preload:true,descend:false,committedSeconds:.05});
  let pending=null, flapEvents=0;
  const frame=()=>{
    const next=preparePigeonTakeoff(controls.sample(),pending,{eligible:true,atRest:native.state.grounded,
      readiness:visual.readiness,simTime:native.state.time});
    const p=native.prepare(next.input,.05,projection,'third',10,false);
    assert.equal(p.kind,'ready',p.reason); p.commit();
    pending=next.pending;
    flapEvents+=native.events.filter(event=>event.type==='flap').length;
    return present();
  };
  assert.equal(present(),false);
  assert.equal(visual.readiness,'loading');
  flap.dispatchEvent(new Event('click')); // same path as a completed iOS tap without a held pointer.
  for (let i=0;i<19;i++) {
    assert.equal(frame(),false);
    assert.ok(pending);
    assert.equal(native.state.grounded,true);
    assert.equal(native.state.flaps,0); assert.equal(flapEvents,0);
  }
  resolveModel(await caseAssets('idea-pigeon-flight-approved.glb')('./models/idea-pigeon-flight-approved.glb'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(visual.readiness,'ready');
  assert.equal(frame(),true);
  assert.equal(pending,null); assert.equal(native.state.flaps,1); assert.equal(flapEvents,1);
  assert.equal(native.state.grounded,false);
  assert.equal(visual.snapshot().clip,PIGEON_APPROVED_WINGBEAT);
  assert.equal(visual.snapshot().queuedFlap,false);
  assert.ok(Math.abs(visual.snapshot().clipTime - .05) < 1e-9);
  assert.equal(native.state.heldSeconds,0,'release during load must not turn a tap into a hold');
  for (let i=0;i<8;i++) frame();
  assert.equal(native.state.flaps,1); assert.equal(flapEvents,1);
});


test('default gray third-person glide keeps wings spread and fall stays tucked on the same exact model', async t => {
  const {scene,native} = harness(t,'glide-fall-actual-rig');
  let parsed;
  const model = createFlightPigeon(scene,'./',url => parsed = caseAssets('idea-pigeon-flight-approved.glb')(url));
  const stable = { ...neutral, descend:false, preload:true, committedSeconds:.02 };
  const manual = (mode, extra={}) => ({ ...native.state, grounded:false, mode, flapAge:2, flaps:0, ...extra });
  model.update(native.state,native.root,stable); const rig=await parsed;
  const geom = [];
  rig.scene.traverse(node => {
    const position=node.geometry?.getAttribute('position');
    if (!node.morphTargetInfluences || !position) return;
    for(let i=0;i<position.count;i+=7) geom.push([node,i]);
  });
  const span=()=>{
    model.root.updateMatrixWorld(true);
    let lo=Infinity,hi=-Infinity;
    for(const [n,i] of geom) {
      const v=model.root.worldToLocal(n.localToWorld(n.getVertexPosition(i,new THREE.Vector3())));
      lo=Math.min(lo,v.x); hi=Math.max(hi,v.x);
    }
    return hi-lo;
  };
  for(let i=0;i<19;i++) assert.equal(model.update(manual('glide'),native.root,stable),true);
  assert.equal(model.snapshot().clip,PIGEON_GLIDE);
  const sp=span(), spreadAxis=new THREE.Vector3(0,0,1).applyQuaternion(model.root.quaternion);
  assert.ok(sp>.93);
  const firstTime=model.snapshot().clipTime;
  model.update(manual('glide'),native.root,{...stable,committedSeconds:0});
  assert.equal(model.snapshot().clipTime,firstTime);
  assert.equal(model.update(manual('fall'),native.root,stable),true);
  assert.equal(model.snapshot().clip,PIGEON_FALL);
  assert.ok(Math.abs(sp-span())<1e-5, 'crossfade starts at same presented geometry');
  for(let i=0;i<19;i++) assert.equal(model.update(manual('fall'),native.root,stable),true);
  assert.ok(span()<.69);
  assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(model.root.quaternion).y<spreadAxis.y-.15);
  assert.equal(model.update(manual('glide'),native.root,{...stable,descend:true}),true);
  assert.equal(model.snapshot().clip,PIGEON_FALL, 'explicit descent stays on approved tucked player');
  assert.equal(model.update(native.state,native.root,stable),false);
  assert.equal(model.snapshot().clip,null,'landing restores ground presenter');
});

test('real native Space retrigger preserves displayed pose, accelerates approved tail, and starts only one next cycle', async t => {
  const {scene,native,controls} = harness(t,'retrigger-native-player');
  let parsed;
  const m=createFlightPigeon(scene,'./',url=>parsed=caseAssets('idea-pigeon-flight-approved.glb')(url));
  const ctx={...neutral,descend:false,preload:true,committedSeconds:.01};
  m.update(native.state,native.root,ctx); const gltf=await parsed;
  const pose=()=>{
    const list=[];
    gltf.scene.traverse(n=>{if(n.morphTargetInfluences) list.push(...n.morphTargetInfluences);});
    return list;
  };
  const key=(type,repeat=false)=>window.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{code:'Space',repeat}));
  const step=()=>{
    const prepared=native.prepare(controls.sample(),.01,projection,'third',10,false);
    assert.equal(prepared.kind,'ready',prepared.reason); prepared.commit();
    return m.update(native.state,native.root,ctx);
  };
  key('keydown'); for(let i=0;i<32;i++) assert.equal(step(),true);
  const exactTime=m.snapshot().clipTime, exactPose=pose();
  key('keydown',true); step(); assert.equal(native.state.flaps,1);
  assert.equal(m.snapshot().queuedRetrigger,false);
  const preRetriggerTime=m.snapshot().clipTime, preRetriggerPose=pose();
  assert.ok(preRetriggerTime>exactTime);
  assert.notDeepEqual(preRetriggerPose,exactPose);
  key('keyup'); key('keydown'); assert.equal(step(),true);
  assert.equal(native.state.flaps,2,'discrete press changes flight immediately');
  assert.ok(m.snapshot().queuedRetrigger);
  assert.equal(m.snapshot().clipTime,preRetriggerTime);
  assert.deepEqual(pose(),preRetriggerPose,'no immediate morph reset on Space');
  const geometry=()=>{
    const list=[];
    gltf.scene.traverse(n=>{
      const position=n.geometry?.getAttribute('position');
      if(!n.morphTargetInfluences||!position) return;
      for(let i=0;i<position.count;i+=30) list.push(...n.getVertexPosition(i,new THREE.Vector3()).toArray());
    });
    return list;
  };
  const phases=[]; let endPose,nextPose;
  for(let i=1;i<=29;i++){
    if(i===3){key('keyup');key('keydown');}
    assert.equal(step(),true);
    const phase=m.snapshot().clipTime; phases.push(phase);
    if(phase===.8)endPose=geometry();
    if(phase===0)nextPose=geometry();
  }
  assert.ok(phases.includes(.8)&&phases.includes(0));
  const firstZero=phases.indexOf(0);
  assert.ok(firstZero>=7&&firstZero<=17,'tail finishes quickly, without snapping on input');
  assert.equal(phases[firstZero-1],.8,'show approved tail endpoint before next opening');
  assert.equal(phases.filter(p=>p===0).length,1,'multiple discrete impulses coalesce to one next visual beat');
  assert.ok(Math.max(...endPose.map((w,i)=>Math.abs(w-nextPose[i])))<1e-4,'loop endpoint vertices match the next opening');
  assert.equal(native.state.flaps,3,'visual coalescing never suppresses physical impulses');
});

test('approved landing retains contact-frame mesh pose, settles once, and hands off at 0.24 s', async t => {
  const { scene, native } = harness(t, 'approved-landing');
  let parse;
  const flight = createFlightPigeon(scene, './', url => parse = caseAssets('idea-pigeon-flight-approved.glb')(url));
  const bird = { ...native.state, grounded: false, mode: 'glide', flaps: 0, flapAge: 3 };
  const apply = (context={}) => flight.update(bird, native.root, { ...neutral, preload:true, descend:false, committedSeconds:.01,...context });
  assert.equal(apply(),false);
  const parsed=await parse;
  let morphMesh;
  parsed.scene.traverse(node=>{ if (node.morphTargetInfluences) morphMesh=node; });
  assert.ok(morphMesh);
  assert.equal(apply(),true);
  assert.equal(flight.snapshot().clip,PIGEON_GLIDE);
  const before=[...morphMesh.morphTargetInfluences], rotation=flight.root.quaternion.clone();
  Object.assign(bird,{ grounded:true, mode:'rest' });
  assert.equal(apply({landingSeconds:0}),true);
  assert.equal(flight.snapshot().clip,'PigeonLand_Settle');
  assert.deepEqual(morphMesh.morphTargetInfluences,before);
  assert.ok(Math.abs(rotation.dot(flight.root.quaternion)) > .999999);
  assert.equal(apply({landingSeconds:.22}),true);
  assert.notDeepEqual(morphMesh.morphTargetInfluences,before);
  const level=native.root.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
  assert.ok(Math.abs(level.dot(flight.root.quaternion)) > .999999);
  assert.equal(apply({landingSeconds:.24}),false);
  assert.equal(apply({landingSeconds:0}),false,'do not replay after a fresh ground-only event');
});
