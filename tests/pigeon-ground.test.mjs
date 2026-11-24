import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createGroundPigeon, createGroundTiming, isGroundLandingBlend, PIGEON_AUTO_PECK_DELAY, PIGEON_CYCLE_DISTANCE,
  PIGEON_PECK, PIGEON_REST, PIGEON_WALK } from '../src/pigeon-ground.ts';
import { useIntegratedScene } from '../src/entry-mode.ts';

test('ground phase follows signed travel, not blocked motion or inactive frames', () => {
  const timing = createGroundTiming();
  const step = (meters, dt = .02) => timing.update(dt, meters, true, true, PIGEON_CYCLE_DISTANCE, true, false, 2.33);
  assert.equal(step(.213).phase,.5);
  assert.equal(step(0).phase,.5);
  assert.equal(step(.213,0).phase,.5);
  assert.equal(step(-.213).phase,0);
});

test('active simulation alone advances the 3.2s timer, never duplicates an early manual peck, and re-arms after flight', () => {
  const timing = createGroundTiming();
  const step = (dt, {grounded = true, moving = false, allow = true, manual = false} = {}) =>
    timing.update(dt,0,grounded,moving,PIGEON_CYCLE_DISTANCE,allow,manual,2.33).peckAge;
  for (let i=0;i<31;i++) assert.equal(step(.1),-1);
  for (let i=0;i<15;i++) assert.equal(step(0),-1);
  assert.equal(step(.1,{manual:true}),-1);
  for (let i=0;i<35;i++) assert.equal(step(.1),-1);
  assert.equal(step(.1,{moving:true}),-1);
  assert.equal(step(.1,{allow:false}),-1);
  for (let i=0;i<31;i++) assert.equal(step(.1),-1);
  assert.equal(step(.1),0);
  assert.equal(step(0),0);
  assert.equal(step(.06),.06);
  assert.equal(step(.02,{manual:true}),-1);
  for (let i=0;i<34;i++) assert.equal(step(.1),-1);
  assert.equal(step(.1,{grounded:false}),-1);
  for (let i=0;i<31;i++) assert.equal(step(.1),-1);
  assert.equal(step(.1),0);
  assert.equal(PIGEON_AUTO_PECK_DELAY,3.2);
});

const pigeon = { x:-336,y:1.1125,z:108,vx:0,vz:0,heading:Math.PI/2,mode:'rest',grounded:true,
  body:{heightM:.225,centreToSoleM:.1125},support:{walkable:true} };
const c = { started:true,firstPerson:false,look:'pigeon',reducedMotion:false,manualPeckAge:10,
  flirtAge:Infinity,cooAge:10,landedRecently:false,committedSeconds:.1,distance:0 };

test('ordinary URL selects native scene, measured overlay preserves sole placement, and old controls take precedence', async () => {
  assert.equal(useIntegratedScene(new URLSearchParams()),true);
  assert.equal(useIntegratedScene(new URLSearchParams('native=legacy')),true);
  const scene=new THREE.Scene();
  let requests=0;
  const g=createGroundPigeon(scene,'./',async url=>{
    requests++;
    assert.equal(url,'./models/idea-pigeon-ground.glb');
    return { scene:new THREE.Group(), animations:[PIGEON_WALK,PIGEON_PECK,PIGEON_REST].map(name=>new THREE.AnimationClip(name,2.33,[])) };
  });
  assert.equal(g.update(pigeon,{...c,reducedMotion:true}),false);
  assert.equal(requests,1,'reduced motion preloads the approved resting model');
  assert.equal(g.update(pigeon,{...c,started:false}),false);
  assert.equal(requests,1);
  assert.equal(g.update(pigeon,c),false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.update(pigeon,c),true);
  assert.equal(g.snapshot().clip,PIGEON_REST);
  assert.deepEqual(g.root.position.toArray(),[-336,1,108]);
  assert.equal(g.root.rotation.y,Math.PI/2);
  assert.ok(g.root.scale.x>=.299 && g.root.scale.x<=.301);
  assert.equal(g.update({...pigeon,mode:'walk'},{...c,distance:.064}),true);
  assert.equal(g.snapshot().clip,PIGEON_WALK);
  assert.equal(g.update({...pigeon,mode:'walk',vx:1.8},{...c,distance:.18}),true, 'fast walk stays on the approved skin without spinning the slow clip');
  assert.equal(g.snapshot().clip,PIGEON_REST);
  for (const extra of [{manualPeckAge:0},{flirtAge:.4},{cooAge:.7},{landedRecently:true},{reducedMotion:true}]) {
    assert.equal(g.update(pigeon,{...c,...extra}),true,JSON.stringify(extra));
    assert.equal(g.snapshot().clip,PIGEON_REST);
  }
  for (const extra of [{look:'white'},{look:'owl'},{firstPerson:true}]) assert.equal(g.update(pigeon,{...c,...extra}),false);
  assert.equal(g.update({...pigeon,grounded:false,mode:'flap'},c),false);
  assert.equal(g.update({...pigeon,support:{walkable:false}},c),false);
  assert.equal(g.update(pigeon,c),true);
  assert.equal(requests,1);
  assert.equal(isGroundLandingBlend(.239),true);
  assert.equal(isGroundLandingBlend(.24),false);
});

test('bad model safely keeps original native actor', async () => {
  const g=createGroundPigeon(new THREE.Scene(),'./',async()=>({scene:new THREE.Group(),animations:[]}));
  assert.equal(g.update(pigeon,c),false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.snapshot().loadState,'fallback');
  assert.equal(g.update(pigeon,c),false);
});

test('actual approved model joints maintain height in gait and reach three separated targets in one low sequence', async () => {
  const raw=readFileSync(new URL('../public/models/idea-pigeon-ground.glb',import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),'f597d7e608b33c3443d99dc9ffa39a77f99bb0437e8807171e69990da65c16df');
  // Node texture decoding is substituted at the graphics boundary, not browser QA.
  globalThis.self=globalThis;
  globalThis.createImageBitmap=async()=>({width:1,height:1});
  globalThis.ProgressEvent??=class {};
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const result=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
  const head=result.scene.getObjectByName('Head');
  assert.ok(head?.isBone);
  const mixer=new THREE.AnimationMixer(result.scene);
  const sample = (clip,times)=>{
    const action=mixer.clipAction(result.animations.find(a=>a.name===clip)).reset().play();
    const values=times.map(t=>{action.time=t;mixer.update(0);return head.getWorldPosition(new THREE.Vector3());});
    action.stop();
    return values;
  };
  const walk=sample(PIGEON_WALK,[0,.2,.3,.5,.7,.8]);
  assert.ok(Math.max(...walk.map(v=>v.y))-Math.min(...walk.map(v=>v.y))<.0001,'head height during a walk cycle');
  assert.ok(Math.max(...walk.map(v=>v.z))-Math.min(...walk.map(v=>v.z))>.11,'head moves forward then back');
  const [start,left,right,center,end]=sample(PIGEON_PECK,[0,.63,1.12,1.58,2.3]);
  assert.ok(left.x>center.x+.07 && center.x>right.x+.2);
  assert.ok(left.z>center.z+.06 && center.z>right.z+.12);
  assert.ok([left,right,center].every(v=>v.y<.18));
  assert.ok(start.y>.60 && end.y>.60);
});

test('preflight remains hidden and one latest floor intent survives a late model without a collision replay', async () => {
  let finish, requests=0;
  const g=createGroundPigeon(new THREE.Scene(),'./',()=>{requests++;return new Promise(resolve=>{finish=resolve;});});
  const prep = (extra={}) => g.update(pigeon,{...c,manualPeckSerial:0,manualPeckKind:'ground',...extra});
  assert.equal(prep({started:false}),false);
  assert.equal(requests,1);
  assert.equal(g.update({...pigeon,mode:'walk',vx:.1},{...c,manualPeckAge:.01,manualPeckSerial:1,manualPeckKind:'ground'}),false);
  assert.equal(g.snapshot().queuedManual,true);
  prep({manualPeckAge:.02,manualPeckSerial:2,landedRecently:true});
  assert.equal(g.snapshot().queuedManual,true);
  finish({scene:new THREE.Group(),animations:[PIGEON_WALK,PIGEON_PECK,PIGEON_REST].map(name=>new THREE.AnimationClip(name,2.333,[]))});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.ready,true);
  assert.equal(prep({manualPeckAge:1,manualPeckSerial:2,committedSeconds:0}),true);
  assert.equal(g.snapshot().manualAge,-1,'pause cannot consume a pending visual');
  assert.equal(prep({manualPeckAge:1,manualPeckSerial:2}),true);
  assert.equal(g.snapshot().manualAge,0);
  assert.equal(g.snapshot().clip,PIGEON_PECK);
  assert.equal(g.snapshot().queuedManual,false);
  prep({manualPeckAge:1.1,manualPeckSerial:2});
  assert.equal(g.snapshot().manualAge,.1,'same queued visual is not replayed');
  const opposite={manualPeckAge:.05,manualPeckSerial:3,manualPeckKind:'opponent'};
  assert.equal(prep(opposite),true,'subsequent opponent jab retains the approved skin');
  assert.equal(g.snapshot().clip,PIGEON_REST,'opponent jab never selects the food floor clip');
  assert.equal(g.snapshot().manualAge,-1);
});

test('actual gameplay ground layer accepts a brief rolling stop floor tap and keeps the first click after coo', async () => {
  const raw=readFileSync(new URL('../public/models/idea-pigeon-ground.glb',import.meta.url));
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  globalThis.self=globalThis;
  globalThis.createImageBitmap=async()=>({width:1,height:1});
  globalThis.ProgressEvent??=class {};
  const model=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
  const g=createGroundPigeon(new THREE.Scene(),'./',async()=>model);
  const floor = (extra={}) => ({...c,manualPeckSerial:0,manualPeckKind:'ground',...extra});
  assert.equal(g.update(pigeon,floor({started:false})),false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.update(pigeon,floor()),true);
  const head=model.scene.getObjectByName('Head'), tail=model.scene.getObjectByName('Tail');
  const world = bone => bone.getWorldPosition(new THREE.Vector3());
  const restHead=world(head), restTail=world(tail), restRot=head.quaternion.clone();
  assert.equal(g.update(pigeon,floor({cooMotion:{forward:.036}})),true);
  assert.equal(g.snapshot().clip,PIGEON_REST);
  const cooHead=world(head);
  assert.ok(Math.abs(cooHead.distanceTo(restHead)-g.root.scale.x*.036)<1e-8);
  assert.ok(Math.abs(cooHead.y-restHead.y)<1e-8,'coo does not bob');
  assert.ok(cooHead.clone().sub(restHead).dot(restHead.clone().sub(restTail))>0);
  assert.ok(world(tail).distanceTo(restTail)<1e-8,'coo does not shift the torso or legs');
  assert.ok(head.quaternion.angleTo(restRot)<1e-7,'coo does not pitch');

  const walking={...pigeon,mode:'walk',vx:.1};
  const tap=floor({manualPeckSerial:1,manualPeckAge:.01,cooMotion:{forward:.024}});
  assert.equal(g.update(walking,tap),true);
  assert.equal(g.snapshot().queuedManual,true);
  assert.equal(g.snapshot().clip,PIGEON_WALK);
  assert.equal(g.update(pigeon,{...tap,manualPeckAge:.1}),true);
  assert.equal(g.snapshot().clip,PIGEON_PECK);
  const samples=[];
  for (let i=1;i<=145;i++) {
    g.update(pigeon,floor({manualPeckSerial:1,manualPeckAge:.1+i/60,committedSeconds:1/60}));
    if ([38,67,95].includes(i)) samples.push(g.root.worldToLocal(world(head)).clone());
  }
  const [left,right,center]=samples;
  assert.ok(left.x>center.x+.07 && center.x>right.x+.2);
  assert.ok(left.z>center.z+.06 && center.z>right.z+.12);
  assert.ok([left,right,center].every(v=>v.y<.18));
  assert.equal(g.floorBusy,false);
  assert.equal(g.snapshot().clip,PIGEON_REST);
  assert.ok(world(head).distanceTo(restHead)<1e-8,'returns to the neutral pose');

  g.update(walking,floor({manualPeckSerial:2,manualPeckAge:.01}));
  for (let i=1;i<=8;i++) g.update(walking,floor({manualPeckSerial:2,manualPeckAge:.01+.1*i}));
  g.update(pigeon,floor({manualPeckSerial:2}));
  assert.equal(g.floorBusy,false,'long deliberate walk drops stale floor input');
});

test('verified OSM water rest retains the approved GroundRest at the native immersed sole and ignores floor peck', async t => {
  const { CHEONGGYE_LEVELS }=await import('../src/native/ported/map/real-map/cheonggye-channel.ts');
  const { createNativeScene }=await import('../src/native/scene.ts');
  const parent=new THREE.Scene();
  const native=createNativeScene(parent,'pigeon',{mapData:'osm',quality:'mobile',spawnForTest:()=>({feet:{x:-170,y:2,z:420},heading:0})});
  t.after(()=>native.dispose());
  const g=createGroundPigeon(parent,'./',async()=>({ scene:new THREE.Group(),
    animations:[PIGEON_WALK,PIGEON_PECK,PIGEON_REST].map(name=>new THREE.AnimationClip(name,2.33,[])) }));
  const projection={near:.03,verticalFovDegrees:59,aspect:390/844};
  const step=(flapPressed=false)=>{
    const p=native.prepare({forward:0,turn:0,flapPressed,flapHeld:flapPressed,descend:false},1/60,projection,'third',100+native.state.time,false);
    assert.equal(p.kind,'ready',p.reason);p.commit();
  };
  assert.equal(g.update(native.state,{...c,started:false}),false);
  await new Promise(resolve=>setImmediate(resolve));
  for(let i=0;i<100;i++) step();
  assert.equal(native.state.mode,'rest');
  assert.equal(native.state.grounded,false);
  assert.equal(native.snapshot().waterSplash.spawned,1);
  assert.equal(g.update(native.state,{...c,manualPeckAge:.1,manualPeckSerial:1,manualPeckKind:'ground'}),true);
  assert.equal(g.snapshot().clip,PIGEON_REST);
  assert.equal(g.floorBusy,false);
  assert.ok(Math.abs(g.root.position.y-(CHEONGGYE_LEVELS.water-.06))<1e-8);
  assert.deepEqual([g.root.position.x,g.root.position.z],[native.state.x,native.state.z]);
  assert.equal(g.update(native.state,{...c,firstPerson:true}),false);
  step(true);
  assert.ok(native.state.vy>0);
  assert.equal(g.update(native.state,c),false);
});

test('exact approved GLB retargets a single native opponent jab, not floor feeding or an old model', async () => {
  const raw=readFileSync(new URL('../public/models/idea-pigeon-ground.glb',import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),'f597d7e608b33c3443d99dc9ffa39a77f99bb0437e8807171e69990da65c16df');
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  globalThis.self=globalThis;
  globalThis.createImageBitmap=async()=>({width:1,height:1});
  globalThis.ProgressEvent??=class {};
  const model=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
  const g=createGroundPigeon(new THREE.Scene(),'./',async()=>model);
  const step=(age,reducedMotion=false)=>g.update(pigeon,{...c,manualPeckSerial:1,manualPeckAge:age,manualPeckKind:'opponent',reducedMotion});
  g.update(pigeon,c);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(step(0),true);
  const bone=name=>g.root.getObjectByName(name);
  const head=bone('Head'), body=bone('Body'), collar=bone('NeckCollar');
  const place=node=>node.getWorldPosition(new THREE.Vector3());
  const position=place(head), orientation=head.getWorldQuaternion(new THREE.Quaternion());
  const pinned=[body,collar,bone('Foot_NegX'),bone('Foot_PosX'),bone('Tail')];
  const anchors=pinned.map(place);
  assert.equal(step(.09),true);
  assert.ok(Math.abs(place(head).distanceTo(position)-.225*.12)<1e-7);
  assert.equal(step(.18),true);
  assert.equal(g.snapshot().clip,PIGEON_REST);
  assert.equal(g.floorBusy,false);
  const tip=place(head);
  assert.ok(Math.abs(tip.y-position.y)<1e-8);
  assert.ok(Math.abs(tip.distanceTo(position)-.225*.24)<1e-7);
  assert.ok(tip.clone().sub(position).dot(position.clone().sub(place(bone('Tail'))))>0);
  assert.ok(Math.abs(head.getWorldQuaternion(new THREE.Quaternion()).angleTo(orientation)-.18)<1e-7);
  pinned.forEach((node,i)=>assert.ok(place(node).distanceTo(anchors[i])<1e-8));
  assert.equal(step(.27),true);
  assert.ok(Math.abs(place(head).distanceTo(position)-.225*.12)<1e-7);
  assert.equal(step(.36),true);
  assert.ok(place(head).distanceTo(position)<1e-8);
  const recovered=head.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(recovered.toArray().every((n,i)=>Math.abs(n-orientation.toArray()[i])<1e-9));
  assert.equal(step(.18,true),true);
  assert.ok(place(head).distanceTo(position)<1e-8);
});
