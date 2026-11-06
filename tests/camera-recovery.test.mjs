import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveNativeCamera} from '../src/native/ported/motion/controls/b2/native-camera.ts';
import {cameraNearRadius} from '../src/native/ported/motion/controls/camera-resolver.ts';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {createMapQueries} from '../src/native/ported/motion/locomotion/b2/map-queries.ts';
import * as THREE from 'three';
import {createNativeScene} from '../src/native/scene.ts';
import {nativeNear} from '../src/native/body-profile.ts';
const drop=JSON.parse(fs.readFileSync(new URL('./fixtures/camera-drop.json',import.meta.url),'utf8'));
const point=([x,y,z])=>({x,y,z});
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const metrics=body=>({body,chaseTargetOffset:[0,body.eyeFromSoleM.y-body.centreToSoleM,0],chaseGroundOffset:[0,body.heightM*3.2-body.centreToSoleM,body.heightM*10],chaseAirOffset:[0,body.heightM*5.2-body.centreToSoleM,body.heightM*14.5]});

test('captured roof-drop camera recovers a visible nearby bird without a cut or an intersecting inter-frame chord',()=>{
  const world=createMapQueries(makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}));
  const radius=cameraNearRadius(drop.projection)+.001;
  let previous=drop.camera.position;
  const eye=[drop.eye.x,drop.eye.y,drop.eye.z];
  assert.ok(dist(previous,eye)>23);
  assert.ok(world.sweepSphere(point(previous),drop.eye,.001));
  let result;
  for(let i=0;i<120;i++){
    result=resolveNativeCamera({bird:drop.state,mode:'third',world,metrics:metrics(drop.state.body),projection:drop.projection,acceptedSeconds:1/60,previousPosition:previous,posedEyeWorld:drop.eye});
    assert.equal(result.kind,'resolved');assert.equal(result.cut,false);
    assert.equal(world.sphereClear(point(result.position),radius),true);
    assert.equal(world.sweepSphere(point(previous),point(result.position),radius),null);
    previous=result.position;
  }
  assert.ok(dist(previous,eye)<4,'camera must return to native chase range rather than remain23m away');
  assert.equal(result.occluded,false);
  assert.equal(world.sweepSphere(point(previous),drop.eye,.001),null,'rendered eye must be visible');
});

test('roof recovery converges at30/60/120Hz and a subsequent first-person view uses the actual eye',()=>{
  const world=createMapQueries(makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}));
  const final=[];
  for(const hz of [30,60,120]){
    let previous=drop.camera.position;
    for(let i=0;i<3*hz;i++){
      const r=resolveNativeCamera({bird:drop.state,mode:'third',world,metrics:metrics(drop.state.body),projection:drop.projection,acceptedSeconds:1/hz,previousPosition:previous,posedEyeWorld:drop.eye});
      assert.equal(r.kind,'resolved');assert.equal(r.cut,false);previous=r.position;
    }
    const first=resolveNativeCamera({bird:drop.state,mode:'first',world,metrics:metrics(drop.state.body),projection:drop.projection,acceptedSeconds:1/hz,previousPosition:previous,posedEyeWorld:drop.eye});
    assert.equal(first.kind,'resolved');assert.deepEqual(first.position,[drop.eye.x,drop.eye.y,drop.eye.z]);assert.deepEqual(first.up,[0,1,0]);
    final.push(previous);
  }
  assert.ok(dist(final[0],final[1])<.05);assert.ok(dist(final[1],final[2])<.05);
});

test('an unavailable tangent query rejects the entire camera proposal instead of choosing an unchecked recovery',()=>{
  const base=createMapQueries(makeMapLayout({terrain:'sunken-channel',proportions:'reference-scale'}));
  let normal=null,unavailable=0;
  const before=JSON.stringify(drop);
  const world={...base,sweepSphere(from,to,radius){
    const atPrevious=dist([from.x,from.y,from.z],drop.camera.position)<1e-8;
    if(normal&&atPrevious){
      const delta=[to.x-from.x,to.y-from.y,to.z-from.z];
      if(Math.abs(delta[0]*normal.x+delta[1]*normal.y+delta[2]*normal.z)<1e-6&&Math.hypot(...delta)>.1){unavailable++;return undefined;}
    }
    const hit=base.sweepSphere(from,to,radius);if(atPrevious&&hit&&!normal)normal=hit.normal;return hit;
  }};
  const result=resolveNativeCamera({bird:drop.state,mode:'third',world,metrics:metrics(drop.state.body),projection:drop.projection,acceptedSeconds:1/60,previousPosition:drop.camera.position,posedEyeWorld:drop.eye});
  assert.ok(unavailable>0);assert.deepEqual(result,{kind:'blocked',reason:'invalid-query'});assert.equal(JSON.stringify(drop),before);
});

test('the actual native scene walks off the ridge, lands on the lower wall and keeps a visible nearby camera',()=>{
  const engine=createNativeScene(new THREE.Scene(),'pigeon',{preset:'roof-edge',quality:'mobile',sessionId:'camera-recovery-test'});
  const projection={near:nativeNear(engine.state.body,59,16/9),verticalFovDegrees:59,aspect:16/9};
  const radius=cameraNearRadius(projection)+.001;
  try{
    for(let i=0;i<240;i++){
      const previous=engine.camera?.position;
      const frame=engine.prepare({forward:i>=15&&i<117?1:0,turn:0,flapPressed:false,flapHeld:false,descend:false},1/60,projection,'third',10+(i+1)/60,false);
      assert.equal(frame.kind,'ready','actual moving scene must not freeze on the roof edge');frame.commit();
      if(previous)assert.equal(engine.queries.sweepSphere(point(previous),point(engine.camera.position),radius),null);
    }
    const s=engine.snapshot();assert.equal(s.state.grounded,true);assert.equal(s.state.support.id,'palace:wall:1');assert.equal(s.sole.y,3.6);
    assert.equal(s.camera.occluded,false);assert.ok(dist(s.camera.position,[s.posedEye.x,s.posedEye.y,s.posedEye.z])<4);
    assert.equal(engine.queries.sweepSphere(point(s.camera.position),s.posedEye,.001),null);
  }finally{engine.dispose();}
});
