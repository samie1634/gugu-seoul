import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sweepVehicleParts } from '../src/native/vehicle-collision.ts';
import { createVehicleWorld } from '../src/native/vehicle-world.ts';
import { createRoadTraffic } from '../src/native/road-traffic.ts';
import { makeRealMapLayout } from '../src/native/ported/map/real-map/layout.ts';
import { createNativeMotionState, advanceNativeMotion, nativeFeet } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { createSpeciesActor } from '../src/species-core/actor.ts';

const floor={id:'floor',layerId:'floor',height:0,normal:{x:0,y:1,z:0},surface:'asphalt',walkable:true,landable:true};
const base={supportAt:p=>0>=Math.min(p.previousFeetY,p.at.y)-p.maxDropM-2e-6&&0<=p.previousFeetY+p.maxRiseM+2e-6?floor:null,sweepBody:()=>null,sweepSphere:()=>null,sphereClear:()=>true};
const idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};
const body=createNativeMotionState().body;
const car=(heading=0,z=0,speed=0)=>({id:'car',x:0,y:0,z,heading,speed,visible:true,roadId:'road'});
const rotate=(p,heading)=>({x:p.x*Math.cos(heading)+p.z*Math.sin(heading),y:p.y,z:-p.x*Math.sin(heading)+p.z*Math.cos(heading)});

for(const heading of [0,Math.PI/4,Math.PI/2,3*Math.PI/4,Math.PI,1.1,-.4])test(`empty chassis underside and between-wheel gap are traversable at heading ${heading}`,()=>{
  const vehicle=createVehicleWorld(base,()=>[car(heading)]);
  for(const [a,b] of [[{x:0,y:body.centreToSoleM,z:3},{x:0,y:body.centreToSoleM,z:-3}],[{x:-2,y:body.centreToSoleM,z:0},{x:2,y:body.centreToSoleM,z:0}]]) {
    const start=rotate(a,heading),end=rotate(b,heading);
    assert.equal(vehicle.world.sweepBody(start,end,body),null);
    assert.equal(vehicle.world.sweepSphere(start,end,.08),null);
    assert.equal(vehicle.world.sphereClear(rotate({x:0,y:.2,z:0},heading),.1),true);
  }
  const support=vehicle.world.supportAt({at:{x:0,y:0,z:0},previousFeetY:0,footRadiusM:.06,heightM:.225,maxDropM:0,maxRiseM:.04});
  assert.equal(support.id,'floor');assert.equal(support.height,0);
});

test('actual solid chassis, glass, roof, lights and each tyre still obstruct bodies and cameras',()=>{
  for(const center of [{x:0,y:.6,z:1.8},{x:0,y:1.2,z:0},{x:0,y:1.46,z:0},{x:.57,y:.72,z:2.1},...[-.9,.9].flatMap(x=>[-1.28,1.28].map(z=>({x,y:.31,z})))]) {
    const sphere=sweepVehicleParts(center,center,.005);assert.ok(sphere,JSON.stringify(center));assert.equal(sphere.fraction,0);
  }
  for(const z of [-1.28,1.28])for(const sign of [-1,1]) {
    const hit=sweepVehicleParts({x:sign*2,y:body.centreToSoleM,z},{x:0,y:body.centreToSoleM,z},body);
    assert.ok(hit);assert.ok(hit.fraction>0&&hit.fraction<1);assert.ok(sign*hit.normal.x>.99);
  }
  const taller={...body,heightM:.65,centreToSoleM:.325};
  assert.ok(sweepVehicleParts({x:0,y:.325,z:3},{x:0,y:.325,z:0},taller),'a bird too tall for the gap must still hit the chassis');
  const ceiling=sweepVehicleParts({x:0,y:.15,z:0},{x:0,y:.5,z:0},body);
  assert.ok(ceiling);assert.equal(ceiling.normal.y,-1);
  assert.ok(Math.abs(.15+.35*ceiling.fraction+body.heightM-body.centreToSoleM-.35)<1e-9);
});

test('unfilled square corners around octagonal wheels and gaps beyond real lamps remain clear',()=>{
  const tiny={...body,horizontalRadiusM:.001,heightM:.002,centreToSoleM:.001};
  for(const x of [-.9,.9])for(const z of [-1.28,1.28])for(const side of [-1,1]) {
    const point={x,y:.02,z:z+side*.28};
    assert.equal(sweepVehicleParts(point,point,.001),null);
    assert.equal(sweepVehicleParts(point,point,tiny),null);
  }
  for(const x of [0,.85,-.85]) {
    const point={x,y:.72,z:2.095};assert.equal(sweepVehicleParts(point,point,.002),null);
  }
});

test('tyre collision surfaces match the actual rendered octagonal mesh, not its enclosing box',()=>{
  const scene=new THREE.Scene(),traffic=createRoadTraffic(scene,makeRealMapLayout({quality:'mobile'}));
  try {
    const model=scene.getObjectByName(traffic.snapshot().states[0].id).children[0];
    const geometry=model.geometry,positions=geometry.getAttribute('position'),index=geometry.index;
    let checked=0;
    for(let i=0;i<(index?.count??positions.count);i+=3) {
      const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,index?index.getX(i+j):i+j));
      const middle=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/3);
      if(middle.y>=.34||middle.y<=.005)continue;
      const normal=new THREE.Vector3().subVectors(points[1],points[0]).cross(new THREE.Vector3().subVectors(points[2],points[0])).normalize();
      const inside=middle.clone().addScaledVector(normal,-.002),outside=middle.clone().addScaledVector(normal,.002);
      assert.ok(sweepVehicleParts(inside,inside,.0001));
      assert.equal(sweepVehicleParts(outside,outside,.0001),null,JSON.stringify({middle,normal}));
      checked++;
    }
    assert.ok(checked>=32,checked);
  }finally{traffic.dispose();}
});

for(const speed of [1,2,6])for(const hz of [10,60])test(`grounded lower-tyre contact cannot push through the floor or freeze at ${speed}m/s ${hz}Hz`,()=>{
  let state=createNativeMotionState({feet:{x:.9,y:0,z:0}}),cars=[car(0,-3,speed)];
  const vehicle=createVehicleWorld(base,()=>cars);let hits=0;
  for(let i=1;i<=hz*5;i++) {
    const next=[car(0,-3+speed*i/hz,speed)];
    const p=vehicle.preview([{seconds:0,states:cars},{seconds:1/hz,states:next}],state.time,()=>advanceNativeMotion(state,idle,1/hz,vehicle.world));
    assert.equal(p.result.status,'advanced',`${i}: ${p.result.reason}`);p.commit();state=p.result.state;cars=next;hits+=p.hits.length;
    assert.ok(nativeFeet(state).y>=-2e-6);assert.ok([state.x,state.y,state.z].every(Number.isFinite));
  }
  if(speed<2.5)assert.equal(hits,0);else assert.ok(hits>0);
});

for(const mode of ['first','third'])for(const hz of [10,60])test(`a moving car passes above a pigeon without impact or camera rollback: ${mode} ${hz}Hz`,()=>{
  for(const heading of [0,.4,Math.PI/2,Math.PI]) {
    const at=t=>({...car(heading,0,6),...rotate({x:0,y:0,z:-4+6*t},heading)});
    let cars=[at(0)];const vehicle=createVehicleWorld(base,()=>cars);
    const actor=createSpeciesActor(new THREE.Group(),{world:vehicle.world,initialState:createNativeMotionState({feet:{x:0,y:0,z:0}}),appearance:{speciesId:'pigeon',skinId:'gray'},sessionId:'car-underbody'});
    let hits=0;
    try {
      for(let frame=1;frame<=hz*2;frame++) {
        const dt=1/hz,next=[at(frame/hz)],time=actor.state.time;
        const p=vehicle.preview([{seconds:0,states:cars},{seconds:dt,states:next}],time,()=>actor.prepareFrame({contractVersion:1,frame,simTime:time+dt,rawSeconds:dt,acceptedSeconds:dt,playing:true,quality:'mobile',reducedMotion:false},idle,{mode,verticalFovDegrees:59,aspect:16/9}));
        assert.equal(p.result.kind,'ready',`${heading}/${frame}: ${p.result.reason}`);p.commit();cars=next;p.result.commit();hits+=p.hits.length;
        assert.equal(actor.state.grounded,true);assert.equal(actor.state.vy,0);
      }
      assert.equal(hits,0);assert.equal(vehicle.snapshot().sequence,0);assert.ok(Math.abs(actor.state.time-2)<1e-8);
    }finally{actor.dispose();}
  }
});

test('flapping below a stationary chassis respects its real underside without a spurious impact',()=>{
  let state=createNativeMotionState({feet:{x:0,y:0,z:0}});state.canHover=true;
  const vehicle=createVehicleWorld(base,()=>[car()]);
  for(let i=0;i<120;i++) {
    const p=vehicle.preview([{seconds:0,states:[car()]},{seconds:1/60,states:[car()]}],state.time,()=>advanceNativeMotion(state,{...idle,flapPressed:i%20===0,flapHeld:true},1/60,vehicle.world));
    assert.equal(p.result.status,'advanced',p.result.reason);p.commit();state=p.result.state;
    assert.equal(p.hits.length,0);assert.ok(state.y+body.heightM-body.centreToSoleM<=.350001);
  }
});
