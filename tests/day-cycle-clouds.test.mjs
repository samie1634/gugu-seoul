import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DAY_SECONDS, sampleDayCycle, createDayCycle } from '../src/day-cycle.ts';
import { createCloudLayer, makeCloudPlatforms, withCloudSupport, cloudSurfaceAt } from '../src/native/cloud-platforms.ts';
import { createMapQueries } from '../src/native/ported/motion/locomotion/b2/map-queries.ts';
import { makeMapLayout } from '../src/native/ported/map/layout.ts';
import { createNativeMotionState, advanceNativeMotion, nativeFeet } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { createNativeScene } from '../src/native/scene.ts';
const input = { forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false };
const emptyWorld = {supportAt:()=>null,sweepBody:()=>null,sphereClear:()=>true,sweepSphere:()=>null,waterAt:()=>null};
const probe = (c,x=c.x,z=c.z,r=.06) => ({at:{x,y:c.height,z},previousFeetY:c.height,footRadiusM:r,heightM:.3,maxRiseM:0,maxDropM:0});
test('one second is a minute, one minute an hour, 24 minutes a complete day',()=>{
  assert.equal(DAY_SECONDS,1440);assert.equal(sampleDayCycle(0).hour,9);
  assert.equal(sampleDayCycle(1).minuteOfDay,541);assert.equal(sampleDayCycle(60).hour,10);
  assert.equal(sampleDayCycle(1440).hour,9);assert.equal(sampleDayCycle(1440).day,1);
  assert.deepEqual(sampleDayCycle(0).sunDirection,sampleDayCycle(1440).sunDirection);
  assert.equal(sampleDayCycle(4320).day,3);
  assert.throws(()=>sampleDayCycle(NaN),RangeError);assert.throws(()=>sampleDayCycle(-1),RangeError);
});
test('sun and moon cross opposite horizons with continuous twilight and visible night light',()=>{
  const noon=sampleDayCycle(180),midnight=sampleDayCycle(900),dusk=sampleDayCycle(540);
  assert.equal(noon.daylight,1);assert.equal(midnight.daylight,0);assert.ok(dusk.twilight>.99);
  assert.ok(noon.sunDirection.y>.95);assert.ok(midnight.moonDirection.y>.95);
  for(let t=0;t<1440;t+=5){const s=sampleDayCycle(t);assert.ok(Math.abs(Math.hypot(...Object.values(s.sunDirection))-1)<1e-12);assert.equal(s.sunDirection.x,-s.moonDirection.x);}
  const scene=new THREE.Scene();scene.background=new THREE.Color();scene.fog=new THREE.Fog('#ffffff',280,1700);
  const hemi=new THREE.HemisphereLight(),light=new THREE.DirectionalLight(),camera=new THREE.PerspectiveCamera();camera.position.set(1,2,3);
  const cycle=createDayCycle(scene,hemi,light);cycle.update(900,camera,{x:0,y:0,z:0});
  assert.ok(hemi.intensity>=.38);assert.ok(light.intensity>=.28);assert.equal(scene.getObjectByName('seoul:sun').visible,false);assert.equal(scene.getObjectByName('seoul:moon').visible,true);
  const snapshot=cycle.snapshot();cycle.update(900,camera,{x:5,y:2,z:3});assert.deepEqual(cycle.snapshot(),snapshot,'unchanged active time does not advance on render');
  cycle.dispose();cycle.dispose();assert.equal(scene.getObjectByName('seoul:day-cycle'),undefined);
});
test('cloud support matches rounded crowns and requires the whole foot disk',()=>{
  const scene=new THREE.Scene(),layer=createCloudLayer(scene),q=withCloudSupport(emptyWorld,layer.platforms);
  assert.equal(layer.platforms.length,12);layer.root.updateWorldMatrix(true,true);
  let triangles=0;
  for(const c of layer.platforms){
    assert.ok(c.height<175);assert.equal(q.supportAt(probe(c)).id,c.id);assert.equal(q.supportAt(probe(c)).surface,'cloud');
    const edge=c.rings[0][0];assert.equal(q.supportAt(probe(c,edge[0],edge[1])),null);
    assert.equal(q.supportAt(probe(c,c.x+c.width*2)),null);
    const mesh=scene.getObjectByName(c.id),pos=mesh.geometry.getAttribute('position');
    triangles+=mesh.geometry.index.count/3;
    const ray=new THREE.Raycaster(new THREE.Vector3(c.x,c.height+10,c.z),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObject(mesh)[0];assert.ok(hit,c.id);assert.ok(Math.abs(hit.point.y-c.height)<1e-5,c.id);
    const heights=Array.from({length:pos.count},(_,i)=>pos.getY(i));
    assert.ok(Math.max(...heights)-Math.min(...heights)>c.thickness*2,'billowing vertical volume, not a flat cap');
    for(const [dx,dz] of [[-.22,-.06],[.23,.04],[-.10,.24],[.10,-.23],[-.38,.04],[.40,-.02]]){
      const x=c.x+dx*c.width,z=c.z+dz*c.depth,surface=cloudSurfaceAt(c,x,z,.06);assert.ok(surface);
      ray.set(new THREE.Vector3(x,c.height+10,z),new THREE.Vector3(0,-1,0));
      const visible=ray.intersectObject(mesh)[0];assert.ok(visible);assert.ok(Math.abs(visible.point.y-surface.height)<1e-5);
      assert.ok(surface.normal.y>0);assert.ok(Math.abs(Math.hypot(...Object.values(surface.normal))-1)<1e-6);
    }
  }
  assert.ok(triangles<60000);assert.equal(layer.root.children.length,12);assert.equal(layer.root.children[0].material.transparent,false);assert.equal(layer.root.children[0].material.depthWrite,true);layer.dispose();assert.equal(scene.children.length,0);
});
test('cloud wrapper preserves map water/camera results and unavailable support',()=>{
  const base={...emptyWorld,waterAt:()=>({id:'water'}),supportAt:()=>undefined};
  const q=withCloudSupport(base,makeCloudPlatforms()),c=makeCloudPlatforms()[0];
  assert.equal(q.supportAt(probe(c)),undefined);assert.equal(q.sweepBody,base.sweepBody);assert.equal(q.sphereClear,base.sphereClear);assert.equal(q.sweepSphere,base.sweepSphere);assert.equal(q.waterAt,base.waterAt);
});
test('cloud landing, stable rest, walking off and takeoff all use native physics',()=>{
  const c=makeCloudPlatforms()[0],q=withCloudSupport(emptyWorld,[c]);
  let state=createNativeMotionState({feet:{x:c.x,y:c.height+2,z:c.z}});state.grounded=false;state.mode='fall';state.vy=-3;
  let lands=0;
  for(let i=0;i<120;i++){const r=advanceNativeMotion(state,input,1/60,q);assert.equal(r.status,'advanced');state=r.state;lands+=r.events.filter(e=>e.type==='land').length;}
  assert.equal(lands,1);assert.equal(state.grounded,true);assert.equal(state.support.id,c.id);assert.equal(state.mode,'rest');assert.equal(nativeFeet(state).y,c.height);
  const rest={x:state.x,y:state.y,z:state.z};for(let i=0;i<120;i++){state=advanceNativeMotion(state,input,1/60,q).state;}assert.deepEqual({x:state.x,y:state.y,z:state.z},rest);
  const takeoff=advanceNativeMotion(state,{...input,flapHeld:true,flapPressed:true},.05,q);assert.equal(takeoff.status,'advanced');assert.equal(takeoff.state.grounded,false);assert.ok(takeoff.state.vy>0);
  state={...state,x:c.x+c.width*2};const edge=advanceNativeMotion(state,input,.05,q);assert.equal(edge.status,'advanced');assert.equal(edge.state.grounded,false);
  let below=createNativeMotionState({feet:{x:c.x,y:c.height-1,z:c.z}});below.grounded=false;below.mode='flap';below.vy=10;
  const rising=advanceNativeMotion(below,input,.1,q);assert.equal(rising.status,'advanced');assert.ok(rising.state.y>below.y,'soft underside does not block upward flight');
});
test('cloud centers and caps clear actual OSM buildings and preserve dry spawn',()=>{
  const layout=makeMapLayout({data:'osm'}),base=createMapQueries(layout),q=withCloudSupport(base,makeCloudPlatforms());
  for(const c of makeCloudPlatforms()){
    for(const p of [[c.x,c.z],...c.rings[0]]) assert.equal(base.sphereClear({x:p[0],y:c.height+.3,z:p[1]},.25),true,c.id);
    assert.equal(q.supportAt(probe(c)).id,c.id);
  }
  const spawn=layout.spawns[0],p={at:spawn,previousFeetY:spawn.y,footRadiusM:.06,heightM:.3,maxRiseM:0,maxDropM:0};assert.deepEqual(q.supportAt(p),base.supportAt(p));
});
test('integrated species scene can perch, commit cloud land event, and relaunch without a blocked frame',()=>{
  const c=makeCloudPlatforms()[0];
  const scene=createNativeScene(new THREE.Scene(),'pigeon',{mapData:'osm',quality:'mobile',spawnForTest:()=>({feet:{x:c.x,y:c.height+1,z:c.z},heading:0})});
  const projection={near:.02,verticalFovDegrees:59,aspect:16/9};let landed=false;
  for(let i=0;i<120;i++){const frame=scene.prepare(input,1/60,projection,'third',10+i/60,false);assert.equal(frame.kind,'ready',frame.reason);frame.commit();landed ||= scene.events.some(e=>e.type==='land'&&e.surface==='cloud');}
  assert.equal(landed,true);assert.equal(scene.state.grounded,true);assert.equal(scene.state.support.id,c.id);assert.equal(scene.snapshot().blockedFrames,0);
  const takeoff=scene.prepare({...input,flapPressed:true,flapHeld:true},1/60,projection,'third',13,false);assert.equal(takeoff.kind,'ready',takeoff.reason);takeoff.commit();assert.ok(scene.state.vy>0);scene.dispose();
});
