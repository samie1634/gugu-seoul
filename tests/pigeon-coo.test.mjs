import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGroundPigeon } from '../src/pigeon-ground.ts';
import { ORIGINAL_AUDIO_CLIPS } from '../src/audio-clips.ts';
import { pigeonCooCue, pigeonCooForwardOffset, PIGEON_COO_OFFSETS } from '../src/pigeon-coo.ts';

test('actual unchanged source hashes resolve distinct two-pulse peaks and return to neutral', () => {
  const originals=ORIGINAL_AUDIO_CLIPS.filter(x=>x.kind==='coo'); assert.equal(originals.length,5);
  const timings=[];
  for(const clip of originals) {
    const bytes=readFileSync(new URL('../public/'+clip.path,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),clip.sha256);
    const cue=pigeonCooCue(clip.sha256); assert.ok(cue);
    timings.push(cue.join(':'));
    assert.equal(pigeonCooForwardOffset(0,cue),0);
    assert.equal(pigeonCooForwardOffset((cue[0]+cue[1])/2,cue),0);
    assert.equal(pigeonCooForwardOffset(1.2,cue),0);
    for(let i=0;i<2;i++) assert.equal(pigeonCooForwardOffset(cue[i],cue),PIGEON_COO_OFFSETS[i]);
  }
  assert.equal(new Set(timings).size,5);
  assert.equal(pigeonCooCue('unknown'),undefined);
});

test('real approved GLB: head only advances on yawed flat plane, resets on stop, does not override manual peck',async ()=>{
  globalThis.self=globalThis;
  globalThis.createImageBitmap=async()=>({width:1,height:1});globalThis.ProgressEvent??=class {};
  const raw=readFileSync(new URL('../public/models/idea-pigeon-ground.glb',import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),'f597d7e608b33c3443d99dc9ffa39a77f99bb0437e8807171e69990da65c16df');
  const parsed=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
  const ground=createGroundPigeon(new T.Scene(),'./',async()=>parsed);
  const bird={x:3,y:.3,z:-5,vx:0,vz:0,heading:.8,mode:'rest',grounded:true,body:{heightM:.3,centreToSoleM:.3},support:{walkable:true}};
  const c={committedSeconds:.02,distance:0,started:true,firstPerson:false,look:'pigeon',reducedMotion:false,manualPeckAge:10,manualPeckSerial:0,manualPeckKind:'ground',flirtAge:Infinity,cooAge:0,cooMotion:null,landedRecently:false};
  assert.equal(ground.update(bird,c),false); await new Promise(r=>setImmediate(r));
  assert.equal(ground.update(bird,c),true);
  const head=ground.root.getObjectByName('Head'), tail=ground.root.getObjectByName('Tail');
  const position=node=>node.getWorldPosition(new T.Vector3());
  const before=position(head), tailPos=position(tail);
  const forward=before.clone().sub(tailPos);forward.y=0;forward.normalize();
  const rot=head.getWorldQuaternion(new T.Quaternion()).normalize();
  const jointNames=['Body','NeckBase','NeckMid','NeckUpper','Foot_NegX','Foot_PosX','Tail'];
  const other=jointNames.map(n=>ground.root.getObjectByName(n));
  const previous=other.map(position);
  for(const offset of [.036,.029,.036]) {
    assert.equal(ground.update(bird,{...c,cooMotion:{forward:offset}}),true);
    const delta=position(head).sub(before);
    assert.ok(delta.clone().normalize().dot(forward)>.998);
    assert.ok(Math.abs(delta.y)<1e-7);
    assert.ok(Math.abs(delta.length()-.3/.750905672*offset)<1e-6);
    assert.ok(head.getWorldQuaternion(new T.Quaternion()).normalize().angleTo(rot)<1e-6);
    assert.ok(other.every((node,i)=>position(node).distanceTo(previous[i])<1e-8));
  }
  assert.equal(ground.update(bird,c),true);
  assert.ok(position(head).distanceTo(before)<1e-8);
  assert.equal(ground.update(bird,{...c,cooMotion:{forward:.036},manualPeckAge:0,manualPeckSerial:1}),true);
  assert.equal(ground.snapshot().clip,'FoodPeck_ThreeTargets_Approved');
  ground.reset();
  assert.equal(ground.update(bird,{...c,firstPerson:true,cooMotion:{forward:.036}}),false);
  assert.equal(ground.update(bird,c),true);
  assert.ok(position(head).distanceTo(before)<1e-8);
});
