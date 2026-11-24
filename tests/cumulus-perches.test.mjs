import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {makeCloudPlatforms,createCloudLayer,cloudSurfaceAt,withCloudSupport} from '../src/native/cloud-platforms.ts';
import {createNativeMotionState,advanceNativeMotion,nativeFeet} from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
const empty={supportAt:()=>null,sweepBody:()=>null,sphereClear:()=>true,sweepSphere:()=>null};
const idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};

test('rendered billows and support triangles agree over all cloud surfaces',()=>{
  const scene=new THREE.Scene(),layer=createCloudLayer(scene);layer.root.updateWorldMatrix(true,true);
  const ray=new THREE.Raycaster();let checked=0;
  for(const c of layer.platforms){
    const mesh=scene.getObjectByName(c.id);
    for(let ix=-10;ix<=10;ix++)for(let iz=-10;iz<=10;iz++){
      const x=c.x+ix*c.width*.055,z=c.z+iz*c.depth*.055,surface=cloudSurfaceAt(c,x,z,.06);
      if(!surface)continue;
      ray.set(new THREE.Vector3(x,c.height+3,z),new THREE.Vector3(0,-1,0));
      const hit=ray.intersectObject(mesh)[0];assert.ok(hit);
      assert.ok(Math.abs(surface.height-hit.point.y)<1e-5,`${c.id}: ${ix},${iz}`);
      const support=withCloudSupport(empty,[c]).supportAt({at:{x,y:surface.height-1,z},previousFeetY:c.height+3,footRadiusM:.06,heightM:.3,maxRiseM:0,maxDropM:0});
      assert.ok(support);assert.equal(support.height,surface.height);checked++;
    }
  }
  assert.ok(checked>2500);layer.dispose();
});

test('pigeon lands once and remains still on each crown and shoulder, then takes off',()=>{
  for(const c of makeCloudPlatforms())for(const [dx,dz] of [[0,0],[-.22,-.06],[.23,.04],[-.10,.24],[.10,-.23]]){
    const x=c.x+dx*c.width,z=c.z+dz*c.depth,surface=cloudSurfaceAt(c,x,z,.08),world=withCloudSupport(empty,[c]);assert.ok(surface);
    let state=createNativeMotionState({feet:{x,y:surface.height+1,z}});state.grounded=false;state.mode='fall';state.vy=-3;let lands=0;
    for(let frame=0;frame<180;frame++){
      const result=advanceNativeMotion(state,idle,1/60,world);assert.equal(result.status,'advanced');state=result.state;lands+=result.events.filter(e=>e.type==='land').length;
    }
    assert.equal(lands,1);assert.equal(state.support.id,c.id);assert.equal(state.mode,'rest');assert.ok(Math.abs(nativeFeet(state).y-surface.height)<1e-8);
    const rest={x:state.x,y:state.y,z:state.z};
    for(let frame=0;frame<60;frame++)state=advanceNativeMotion(state,idle,1/60,world).state;
    assert.deepEqual({x:state.x,y:state.y,z:state.z},rest);
    const takeoff=advanceNativeMotion(state,{...idle,flapHeld:true,flapPressed:true},1/60,world);assert.equal(takeoff.status,'advanced');assert.equal(takeoff.state.grounded,false);assert.ok(takeoff.state.vy>0);
  }
});

test('rounded clouds do not catch upward flight or invent support outside the footprint',()=>{
  const c=makeCloudPlatforms()[0],world=withCloudSupport(empty,[c]);
  for(const [x,z] of [[c.x+c.width,c.z],[c.x,c.z+c.depth],...c.rings[0]])assert.equal(cloudSurfaceAt(c,x,z,.06),null);
  let state=createNativeMotionState({feet:{x:c.x,y:c.height-1,z:c.z}});state.grounded=false;state.mode='flap';state.vy=10;
  let lands=0;
  for(let frame=0;frame<30;frame++){
    const result=advanceNativeMotion(state,{...idle,flapHeld:true},1/60,world);assert.equal(result.status,'advanced');state=result.state;lands+=result.events.filter(e=>e.type==='land').length;
  }
  assert.equal(lands,0);assert.ok(nativeFeet(state).y>c.height);
});

test('clouds preserve unrelated query identity, undefined queries and higher supports',()=>{
  const c=makeCloudPlatforms()[0],support={id:'higher',layerId:'higher',height:c.height+1,normal:{x:0,y:1,z:0},surface:'roof',walkable:true,landable:true};
  const base={...empty,supportAt:()=>support,supportAtTime:()=>support};
  const world=withCloudSupport(base,[c]);
  assert.equal(world.supportAtTime,base.supportAtTime);assert.equal(world.sweepSphere,base.sweepSphere);
  const probe={at:{x:c.x,y:c.height,z:c.z},previousFeetY:c.height+2,footRadiusM:.06,heightM:.3,maxRiseM:0,maxDropM:0};
  assert.equal(world.supportAt(probe),support);assert.equal(withCloudSupport({...base,supportAt:()=>undefined},[c]).supportAt(probe),undefined);
});

test('cloud creation is deterministic and releases its twelve meshes once',()=>{
  assert.deepEqual(makeCloudPlatforms(),makeCloudPlatforms());
  const scene=new THREE.Scene(),layer=createCloudLayer(scene);let geometries=0,materials=0;
  for(const mesh of layer.root.children)mesh.geometry.addEventListener('dispose',()=>geometries++);
  layer.root.children[0].material.addEventListener('dispose',()=>materials++);
  layer.dispose();layer.dispose();assert.equal(geometries,12);assert.equal(materials,1);assert.equal(scene.children.length,0);
});

test('the complete billowing volume clears existing OSM buildings',async()=>{
  const {createMapQueries}=await import('../src/native/ported/motion/locomotion/b2/map-queries.ts');
  const {makeMapLayout}=await import('../src/native/ported/map/layout.ts');
  const world=createMapQueries(makeMapLayout({data:'osm'})),layer=createCloudLayer(new THREE.Scene());
  for(const mesh of layer.root.children){
    const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++)assert.equal(world.sphereClear({x:mesh.position.x+p.getX(i),y:mesh.position.y+p.getY(i),z:mesh.position.z+p.getZ(i)},.025),true,`${mesh.name} vertex ${i}`);
  }
  layer.dispose();
});
