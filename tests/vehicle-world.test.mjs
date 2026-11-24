import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVehicleWorld } from '../src/native/vehicle-world.ts';
import { createNativeMotionState, advanceNativeMotion, nativeFeet } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { createSpeciesActor } from '../src/species-core/actor.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { createRoadTraffic } from '../src/native/road-traffic.ts';
import { makeRealMapLayout } from '../src/native/ported/map/real-map/layout.ts';
import { nativeNear } from '../src/native/body-profile.ts';

const floor={id:'ground',layerId:'ground',height:0,normal:{x:0,y:1,z:0},surface:'asphalt',walkable:true,landable:true};
const base={supportAt:p=>0>=Math.min(p.previousFeetY,p.at.y)-p.maxDropM-2e-6&&0<=p.previousFeetY+p.maxRiseM+2e-6?floor:null,sweepBody:()=>null,sphereClear:()=>true,sweepSphere:()=>null};
const idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};
const car=(z=0,speed=6,heading=0,x=0)=>({id:'car',x,y:0,z,heading,speed,visible:true,roadId:'road'});
const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
function fixture(state,cars,world=base){
  let committed=cars;const vehicle=createVehicleWorld(world,()=>committed);
  return {get state(){return state;},get cars(){return committed;},vehicle,
    step(next,dt=1/60,input=idle,commit=true){
      const p=vehicle.preview([{seconds:0,states:committed},{seconds:dt,states:next}],state.time,()=>advanceNativeMotion(state,input,dt,vehicle.world));
      if(p.result.status==='advanced'&&commit){p.commit();state=p.result.state;committed=next;}
      return p;
    }};
}
function perched(){const state=createNativeMotionState({feet:{x:.2,y:1.51,z:-.16}});state.support={...floor,id:'car:roof',layerId:'car:roof',height:1.51,surface:'metal'};return state;}

for(const hz of [30,60,120]) test(`speeding vehicle launches once and gravity lands on valid floor at ${hz} Hz`,()=>{
  const f=fixture(createNativeMotionState({feet:{x:1.1,y:0,z:0}}),[car(-3)]);let hits=[],highest=0,landed=false;
  for(let i=1;i<=hz*4;i++){
    const p=f.step([car(-3+6*i/hz)],1/hz);assert.equal(p.result.status,'advanced',p.result.reason);hits.push(...p.hits);highest=Math.max(highest,f.state.y);
    if(hits.length&&f.state.grounded)landed=true;
    assert.ok(Math.hypot(f.state.vx,f.state.vz)<=25.001);assert.ok(f.state.vy<=13);
  }
  assert.equal(hits.length,1);assert.ok(highest>3&&highest<7);assert.ok(f.state.z>20&&f.state.z<35);assert.ok(landed);
  close(nativeFeet(f.state).y,0);assert.equal(f.state.support.id,'ground');
});

test('heading zero travels +Z, rotated traffic hits outward, and fast relative sweeps cannot tunnel',()=>{
  for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    const x=Math.sin(heading),z=Math.cos(heading),f=fixture(createNativeMotionState({feet:{x:1.1*z,y:0,z:-1.1*x}}),[car(-3*z,6,heading,-3*x)]);
    let hits=[];
    for(let i=1;i<=8;i++){const p=f.step([car((-3+i*.6)*z,6,heading,(-3+i*.6)*x)],.1);assert.equal(p.result.status,'advanced',p.result.reason);hits.push(...p.hits);}
    assert.equal(hits.length,1);assert.ok(f.state.x*x+f.state.z*z>5);
  }
  const bird=createNativeMotionState({feet:{x:-4,y:.2,z:0}});bird.grounded=false;bird.vx=80;
  const f=fixture(bird,[car(0,0)]),p=f.step([car(0,0)],.1,{...idle,descend:true});
  assert.equal(p.result.status,'advanced');assert.ok(f.state.x<-.99);assert.equal(p.hits.length,0);
});

test('slow and stopped cars only block or gently push, without launch or feathers',()=>{
  for(const speed of [0,1,2.49]){
    const f=fixture(createNativeMotionState({feet:{x:0,y:0,z:0}}),[car(-2.4,speed)]);let hits=[];
    for(let i=1;i<=120;i++){const p=f.step([car(-2.4+speed*i/60,speed)]);assert.equal(p.result.status,'advanced',p.result.reason);hits.push(...p.hits);assert.ok(f.state.y<.2);assert.ok(Math.hypot(f.state.vx,f.state.vz)<=speed+.01);}
    assert.equal(hits.length,0);
  }
});

test('roof has exact mesh height and full foot disk, while sides and underside do not snap upward',()=>{
  const f=fixture(perched(),[car(0,0)]),w=f.vehicle.world;
  const probe=(x,y,z=-.16)=>({at:{x,y,z},previousFeetY:y,footRadiusM:.06,heightM:.225,maxRiseM:0,maxDropM:0});
  assert.equal(w.supportAt(probe(.715,1.51)).id,'car:roof');assert.equal(w.supportAt(probe(.716,1.51)),null);
  assert.equal(w.supportAt(probe(0,.5)),null);assert.equal(w.supportAt(probe(0,1.51,.661)),null);
  assert.ok(w.sweepBody({x:0,y:.5,z:-4},{x:0,y:.5,z:4},f.state.body));
  assert.equal(w.sphereClear({x:0,y:1.2,z:0},.1),false);assert.ok(w.sweepSphere({x:-3,y:1.2,z:0},{x:3,y:1.2,z:0},.1));
});

test('a descending bird lands, then rests on translating and turning roof without footsteps or impact',()=>{
  const start=createNativeMotionState({feet:{x:.2,y:1.54,z:-.16}});start.grounded=false;start.vy=-1;start.mode='fall';
  const f=fixture(start,[car()]);let lands=0,steps=0,hits=0;
  for(let i=1;i<=120;i++){
    const theta=Math.min(i,60)*.005,p=f.step([car(i*.1,6,theta)]);assert.equal(p.result.status,'advanced',p.result.reason);
    lands+=p.result.events.filter(e=>e.type==='land').length;steps+=p.result.events.filter(e=>e.type==='step').length;hits+=p.hits.length;
    if(i>4){assert.equal(f.state.mode,'rest');close(nativeFeet(f.state).y,1.51);}
  }
  assert.equal(lands,1);assert.equal(steps,0);assert.equal(hits,0);assert.equal(f.state.support.id,'car:roof');close(f.state.heading,-.3,.02);
});

test('Space leaves the moving roof and walking beyond its edge falls without being glued',()=>{
  const f=fixture(perched(),[car()]);f.step([car(.1)]);
  const jump=f.step([car(.2)],1/60,{...idle,flapPressed:true,flapHeld:true});assert.equal(jump.result.status,'advanced');assert.equal(f.state.grounded,false);assert.ok(f.state.vy>0);assert.equal(f.state.support,null);
  const g=fixture(perched(),[car(0,0)]);let dropped=false;
  for(let i=0;i<180;i++){const p=g.step([car(0,0)],1/60,{...idle,forward:1});assert.equal(p.result.status,'advanced',p.result.reason);if(!g.state.grounded)dropped=true;}
  assert.ok(dropped);assert.notEqual(g.state.support?.id,'car:roof');
});

test('discarded and blocked previews do not consume cooldown, impacts, player time or car movement',()=>{
  const f=fixture(createNativeMotionState({feet:{x:1.1,y:0,z:0}}),[car(-2)]),before=structuredClone(f.state),stateBefore=f.vehicle.snapshot();
  const a=f.step([car(-1.4)],.1,idle,false),b=f.step([car(-1.4)],.1,idle,false);
  assert.equal(a.hits.length,1);assert.deepEqual(a.hits,b.hits);assert.deepEqual(f.state,before);assert.deepEqual(f.vehicle.snapshot(),stateBefore);
  a.commit();assert.equal(b.isCurrent(),false);assert.throws(()=>b.commit(),/Stale/);
  let unavailable=false;
  const world={...base,supportAt:p=>unavailable?undefined:base.supportAt(p)};
  const g=fixture(createNativeMotionState({feet:{x:0,y:0,z:0}}),[car(-2.4)],world);unavailable=true;
  const rejected=g.step([car(-1.8)],.1);assert.equal(rejected.result.status,'blocked');assert.equal(g.vehicle.snapshot().sequence,0);assert.equal(g.state.time,0);
});

test('world collision still stops knockback before a wall',()=>{
  const wall={...base,sweepBody(from,to){if(to.z<=5||to.z<=from.z)return null;const fraction=(5-from.z)/(to.z-from.z);return{fraction,point:{x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction,z:5},normal:{x:0,y:0,z:-1},colliderId:'wall'};}};
  const f=fixture(createNativeMotionState({feet:{x:1.1,y:0,z:0}}),[car(-3)],wall);
  for(let i=1;i<=120;i++){const p=f.step([car(-3+i*.1)]);assert.equal(p.result.status,'advanced',p.result.reason);assert.ok(f.state.z<=5+1e-6);}
});

test('camera, posed eye, state and event-time landing share staged roof geometry in first/third person',()=>{
  let cars=[car()];const v=createVehicleWorld(base,()=>cars),state=createNativeMotionState({feet:{x:.2,y:1.54,z:-.16}});state.grounded=false;state.vy=-1;
  const actor=createSpeciesActor(new THREE.Group(),{world:v.world,initialState:state,appearance:{speciesId:'pigeon',skinId:'gray'},sessionId:'vehicle-camera'});
  try{
    for(let frame=1;frame<=80;frame++){
      const next=[car(frame*.1,6,frame*.005)],start=actor.state.time;
      const p=v.preview([{seconds:0,states:cars},{seconds:1/60,states:next}],start,()=>actor.prepareFrame({contractVersion:1,frame,simTime:start+1/60,rawSeconds:1/60,acceptedSeconds:1/60,playing:true,quality:'mobile',reducedMotion:false},idle,{mode:frame<40?'third':'first',verticalFovDegrees:59,aspect:16/9}));
      assert.equal(p.result.kind,'ready',p.result.reason);p.commit();cars=next;p.result.commit();
      const s=actor.snapshot();close(s.rootPosition[0],s.state.x);close(s.rootPosition[2],s.state.z);
      if(frame>=40){close(s.camera.position[0],s.eye.x);close(s.camera.position[1],s.eye.y);close(s.camera.position[2],s.eye.z);}
    }
    assert.equal(actor.state.mode,'rest');assert.equal(actor.state.support.id,'car:roof');
    const swap=actor.prepareAppearance({speciesId:'pigeon',skinId:'white'});assert.equal(swap.kind,'ready',swap.reason);swap.commit();assert.equal(actor.state.support.id,'car:roof');
  }finally{actor.dispose();}
});

test('traffic preview is pure and stale proposals cannot publish simulation or transforms',()=>{
  const layout=makeRealMapLayout({quality:'mobile'}),traffic=createRoadTraffic(new THREE.Scene(),layout);
  try {const before=traffic.snapshot(),a=traffic.prepare(.1),b=traffic.prepare(.1);assert.deepEqual(traffic.snapshot(),before);assert.ok(a.samples.at(-1).states.some((c,i)=>c.x!==before.states[i].x||c.z!==before.states[i].z));a.commit(layout.spawns[0]);assert.equal(b.isCurrent(),false);assert.throws(()=>b.commit(layout.spawns[0]),/Stale/);assert.equal(traffic.snapshot().time,.1);}finally{traffic.dispose();}
});

test('real scene rejected/stale frames, appearance, reset and disposal preserve transactional traffic/effects',()=>{
  const engine=createNativeScene(new THREE.Scene(),'pigeon',{mapData:'osm',quality:'mobile',sessionId:'vehicle-lifecycle'});
  try{
    const projection={near:nativeNear(engine.state.body,59,16/9),verticalFovDegrees:59,aspect:16/9},before=engine.snapshot();
    const a=engine.prepare(idle,.1,projection,'third',10,false),b=engine.prepare(idle,.1,projection,'third',10,false);assert.equal(a.kind,'ready',a.reason);assert.equal(b.kind,'ready',b.reason);
    assert.deepEqual(engine.snapshot().traffic,before.traffic);assert.deepEqual(engine.snapshot().vehicleFeathers,before.vehicleFeathers);
    assert.equal(engine.selectLook('white'),true);assert.equal(a.isCurrent(),false);assert.throws(()=>a.commit(),/Stale/);assert.deepEqual(engine.snapshot().traffic,before.traffic);
    const c=engine.prepare(idle,.1,projection,'third',10,false);assert.equal(c.kind,'ready',c.reason);c.commit();close(engine.snapshot().traffic.time,.1);
    assert.equal(engine.home(),true);assert.equal(engine.snapshot().vehicleImpacts.cooldown,0);
    const invalid=engine.prepare(idle,.2,projection,'third',10,false);assert.equal(invalid.kind,'blocked');close(engine.snapshot().traffic.time,.1);
  }finally{engine.dispose();engine.dispose();}
});

test('walking off all moving-roof edges inherits carrier motion and never chatters between land and support-lost',()=>{
  for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    const start=perched();start.heading=heading;start.tuning={walkSpeed:.9,flightSpeed:70/3.6,glideSpeed:60/3.6};
    const f=fixture(start,[car()]);let lands=0,lost=0,departed=false;
    for(let i=1;i<=120;i++){
      const p=f.step([car(i*.1)],1/60,{...idle,forward:1});assert.equal(p.result.status,'advanced',p.result.reason);
      lands+=p.result.events.filter(e=>e.type==='land').length;lost+=p.result.events.filter(e=>e.type==='support-lost').length;
      if(!f.state.grounded)departed=true;
    }
    assert.ok(departed);assert.ok(lands<=1,`heading ${heading}: ${lands} lands`);assert.ok(lost<=1,`heading ${heading}: ${lost} support losses`);
  }
});

test('malformed underlying supports and sweeps are never concealed by a valid vehicle hit or roof',()=>{
  const badSupport={...base,supportAt:p=>p.maxDropM===100?{...floor,height:NaN}:base.supportAt(p)};
  const f=fixture(createNativeMotionState({feet:{x:1.1,y:0,z:0}}),[car(-2)],badSupport);
  const p=f.step([car(-1.4)],.1);assert.equal(p.result.status,'blocked');assert.equal(f.vehicle.snapshot().sequence,0);assert.equal(f.state.time,0);
  for(const malformed of [{...floor,height:NaN},{...floor,normal:{x:2,y:1,z:0}},{...floor,id:''}]){
    const v=createVehicleWorld({...base,supportAt:()=>malformed},()=>[car()]);
    assert.equal(v.world.supportAt({at:{x:0,y:1.51,z:0},previousFeetY:1.51,footRadiusM:.06,heightM:.225,maxDropM:0,maxRiseM:0}),undefined);
  }
  const v=createVehicleWorld({...base,sweepBody:()=>({fraction:NaN,point:{x:0,y:0,z:0},normal:{x:0,y:1,z:0},colliderId:'bad'})},()=>[car()]);
  assert.equal(v.world.sweepBody({x:-4,y:.1,z:0},{x:4,y:.1,z:0},perched().body),undefined);
});

test('actual OSM approaching car cannot freeze the camera, and one accepted hit emits feathers then lands on asphalt',()=>{
  const layout=makeRealMapLayout({quality:'mobile'}),traffic=createRoadTraffic(new THREE.Scene(),layout),initial=traffic.snapshot().states[0];traffic.dispose();
  const feet={x:initial.x+Math.sin(initial.heading)*8+Math.cos(initial.heading)*1.1,y:0,z:initial.z+Math.cos(initial.heading)*8-Math.sin(initial.heading)*1.1};
  const engine=createNativeScene(new THREE.Scene(),'pigeon',{mapData:'osm',quality:'mobile',sessionId:'real-vehicle-impact',spawnForTest:()=>({feet,heading:initial.heading+Math.PI})});
  try{
    const projection={near:nativeNear(engine.state.body,59,16/9),verticalFovDegrees:59,aspect:16/9};let hit=false,landed=false,highest=0;
    for(let i=0;i<360;i++){
      const before=engine.snapshot(),mode=i%120>=60?'first':'third';
      const p=engine.prepare(idle,1/60,projection,mode,10+i/60,false);assert.equal(p.kind,'ready',`${i}: ${p.reason}`);
      const duplicate=i===155?engine.prepare(idle,1/60,projection,mode,10+i/60,false):null;
      assert.deepEqual(engine.snapshot().traffic,before.traffic);assert.equal(engine.snapshot().vehicleFeathers.spawned,before.vehicleFeathers.spawned);
      p.commit();if(duplicate){assert.equal(duplicate.kind,'ready',duplicate.reason);assert.equal(duplicate.isCurrent(),false);assert.throws(()=>duplicate.commit(),/Stale/);}
      const s=engine.snapshot();hit ||= s.vehicleFeathers.spawned>0;
      if(hit){highest=Math.max(highest,s.sole.y);if(s.state.grounded){landed=true;assert.equal(s.state.support.surface,'asphalt');}}
      if(mode==='first'){close(s.camera.position[0],s.posedEye.x);close(s.camera.position[1],s.posedEye.y);close(s.camera.position[2],s.posedEye.z);}
    }
    const end=engine.snapshot();assert.ok(hit&&landed);assert.ok(highest>2.5&&highest<5);assert.ok(Math.hypot(end.sole.x-feet.x,end.sole.z-feet.z)>20);
    assert.equal(end.vehicleFeathers.spawned,1);assert.equal(end.vehicleImpacts.sequence,1);assert.equal(end.blockedFrames,0);close(end.traffic.time,end.state.time);
  }finally{engine.dispose();}
});

test('temporal camera recovery never hides a static overlap or unverified world query',()=>{
  const f=fixture(perched(),[car()]);
  f.vehicle.preview([{seconds:0,states:[car()]},{seconds:.1,states:[car(.6)]}],0,()=>{
    assert.equal(f.vehicle.world.sweepCameraMotion({x:0,y:.5,z:2.3},{x:0,y:.5,z:2.9},.1),null);
  });
  for(const clear of [false,undefined]){
    const v=createVehicleWorld({...base,sphereClear:()=>clear},()=>[car()]);
    v.preview([{seconds:0,states:[car()]},{seconds:.1,states:[car(.6)]}],0,()=>assert.equal(v.world.sweepCameraMotion({x:0,y:.5,z:2.3},{x:0,y:.5,z:2.9},.1),undefined));
  }
});

test('kestrel Space inherits actual moving-platform contact velocity once, including turning, but no stationary-floor thrust',()=>{
  for(const hz of [30,60,120]){
    const dt=1/hz,start={...perched(),canHover:true},f=fixture(start,[car(0,6)]);
    const first=f.step([car(6*dt,6)],dt,{...idle,flapPressed:true,flapHeld:true});assert.equal(first.result.status,'advanced');
    close(f.state.vx,0);close(f.state.vz,6*Math.exp(-3.5*dt));
    const second=f.step([car(12*dt,6)],dt,{...idle,flapHeld:true});assert.equal(second.result.status,'advanced');
    close(f.state.vz,6*Math.exp(-7*dt));assert.equal(f.state.flaps,1);
  }
  const start={...perched(),canHover:true},f=fixture(start,[car(0,0)]),dt=1/60,angle=.01;
  const p=f.step([car(0,0,angle)],dt,{...idle,flapPressed:true});assert.equal(p.result.status,'advanced');
  assert.ok(Math.abs(f.state.vx)>0.05&&Math.abs(f.state.vz)>.05,'turning imparts the off-centre contact velocity');
  assert.ok(Math.hypot(f.state.vx,f.state.vz)<1,'rotation momentum is bounded by actual corner motion');
});

test('pigeon takeoff preserves vehicle velocity plus its non-hovering flight thrust', () => {
  const dt = 1 / 60, start = perched(), f = fixture(start, [car(0, 6)]);
  const result = f.step([car(6 * dt, 6)], dt, { ...idle, flapPressed: true, flapHeld: true });
  assert.equal(result.result.status, 'advanced');
  close(f.state.vz, 6 * Math.exp(-3.5 * dt) - start.tuning.flightSpeed * (1 - Math.exp(-3.5 * dt)));
  assert.equal(f.state.flaps, 1); assert.ok(f.state.vy > 0);
});

for (const hz of [10, 30, 60]) test(`walking across traffic keeps camera and simulation advancing at ${hz} Hz`, () => {
  // Retraction toward the bird crosses the car in these cases. The old camera
  // rejected frame 49 of the first case at 60 Hz and could never advance again.
  const cases = [
    { heading: 0, birdHeading: .6, lateral: 0 },
    { heading: 0, birdHeading: Math.PI * 1.5, lateral: 3 },
    { heading: .4, birdHeading: Math.PI * 1.5, lateral: 2 },
    { heading: 1, birdHeading: Math.PI * 1.5, lateral: 0 },
    { heading: 2, birdHeading: Math.PI, lateral: 2 },
  ];
  for (const { heading, birdHeading, lateral } of cases) for (const mode of ['first', 'third']) {
    const at = time => car(Math.cos(heading) * (-8 + 6 * time), 6, heading, Math.sin(heading) * (-8 + 6 * time));
    let cars = [at(0)];
    const vehicles = createVehicleWorld(base, () => cars);
    const state = createNativeMotionState({ feet: { x: Math.cos(heading) * lateral, y: 0, z: -Math.sin(heading) * lateral } });
    state.heading = birdHeading;
    const actor = createSpeciesActor(new THREE.Group(), { world: vehicles.world, initialState: state,
      appearance: { speciesId: 'pigeon', skinId: 'gray' }, sessionId: 'crossing-traffic' });
    try {
      for (let frame = 1; frame <= hz * 4; frame++) {
        const next = [at(frame / hz)], start = actor.state.time;
        const p = vehicles.preview([{ seconds: 0, states: cars }, { seconds: 1 / hz, states: next }], start,
          () => actor.prepareFrame({ contractVersion: 1, frame, simTime: start + 1 / hz, rawSeconds: 1 / hz,
            acceptedSeconds: 1 / hz, playing: true, quality: 'mobile', reducedMotion: false },
          { ...idle, forward: 1 }, { mode, verticalFovDegrees: 59, aspect: 16 / 9 }));
        assert.equal(p.result.kind, 'ready', `${heading}/${birdHeading}/${lateral}/${mode} frame ${frame}: ${p.result.reason}`);
        p.commit(); cars = next; p.result.commit();
        assert.ok(actor.snapshot().camera.position.every(Number.isFinite));
      }
      close(actor.state.time, 4);
    } finally { actor.dispose(); }
  }
});
