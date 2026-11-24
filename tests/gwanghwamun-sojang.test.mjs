import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGwanghwamun,gateWorld,GWANGHWAMUN_PLACEMENT,isReplacedGwanghwamun,gwanghwamunCollision} from '../src/native/ported/map/real-map/gwanghwamun.ts';
import {makeRealMapLayout,realGround,realSpawnClear} from '../src/native/ported/map/real-map/layout.ts';
import {createMapQueries} from '../src/native/ported/motion/locomotion/b2/map-queries.ts';
import {realMapData} from '../src/native/ported/map/real-map/data.ts';
const probe=(x,z,y)=>({at:gateWorld(x,z,y),previousFeetY:y,footRadiusM:.06,heightM:.25,maxRiseM:.08,maxDropM:.08});
test('Sojang source gate uses the actual metric anchor and palace orientation without rescaling physical dimensions',()=>{
 assert.equal(GWANGHWAMUN_PLACEMENT.sourceVersion,203);assert.equal(GWANGHWAMUN_PLACEMENT.scale,1);
 const p=gateWorld(0,145);assert.ok(Math.abs(p.x+325.4276037661184)<1e-9);assert.ok(Math.abs(p.z+325.4900262764422)<1e-9);
 const north=gateWorld(0,-135);assert.ok(north.x>p.x&&north.z<p.z);
 assert.ok(Math.abs(gateWorld(19,145).distanceTo(gateWorld(-19,145))-38)<1e-9);
 const replaced=realMapData.buildings.filter(isReplacedGwanghwamun);
 assert.ok(replaced.length>30&&replaced.length<55);assert.ok(replaced.every(b=>b.rings.flat().every(([x,z])=>Math.abs(x-p.x)<26&&Math.abs(z-p.z)<9)));
 assert.ok(realMapData.buildings.filter(b=>b.name==='수문장청').every(b=>!isReplacedGwanghwamun(b)));
});
for(const quality of ['mobile','desktop'])test(`${quality} imported three-arch double roof model has bounded draw calls, finite geometry and clean disposal`,()=>{
 const gate=createGwanghwamun(quality);try{
  assert.ok(gate.drawCalls<45);assert.ok(gate.triangles<(quality==='desktop'?450000:100000));
  const b=new THREE.Box3().setFromObject(gate.root);assert.ok(b.max.y>20&&b.max.y<23);
  let roofs=0;gate.root.traverse(o=>{if(o instanceof THREE.Mesh){if(o.userData.heritagePart==='roof')roofs++;for(const v of o.geometry.attributes.position.array)assert.ok(Number.isFinite(v));}});assert.equal(roofs,16);assert.ok(gate.farTriangles<40000);const camera=new THREE.PerspectiveCamera();camera.position.set(0,0,500);camera.updateMatrixWorld(true);gate.root.updateMatrixWorld(true);gate.root.update(camera);assert.equal(gate.root.getCurrentLevel(),1);
 }finally{gate.dispose();}assert.equal(gate.root.children.length,0);
});
test('all three stone portals remain passable, with the original filled OSM prism removed',()=>{
 const layout=makeRealMapLayout(),q=createMapQueries(layout);
 for(const x of[-10,0,10]){
  assert.equal(q.sweepSphere(gateWorld(x,139,1.4),gateWorld(x,151,1.4),.18),null,`portal ${x}`);
  assert.equal(q.sphereClear(gateWorld(x,145,1.4),.18),true);
 }
 for(const x of[-16,-5,5,16])assert.equal(q.sphereClear(gateWorld(x,145,3),.18),false,`pier ${x}`);
 assert.ok(q.sweepSphere(gateWorld(0,145,4.8),gateWorld(0,145,8),.18));
});
test('woldae, entry steps and rear terrace share visible support height',()=>{
 const layout=makeRealMapLayout(),q=createMapQueries(layout);
 for(const[x,z,y]of[[0,145,.85],[0,177,.812],[8,177,.8],[0,201.45,.1],[0,197.95,.8],[0,127,.2],[0,128.5,.8]]){
  const p=gateWorld(x,z,y),support=q.supportAt(probe(x,z,y));assert.ok(support,`${x},${z},${y}`);assert.ok(Math.abs(support.height-y)<.025,JSON.stringify(support));
  assert.ok(Math.abs(realGround(layout,p.x,p.z).y-y)<.025);assert.equal(q.sphereClear({...p,y:y+.24},.15),true);
 }
 const p=gateWorld(0,145,.85);assert.equal(realSpawnClear(layout,p,.18,1.8),true);
});
test('roof triangles provide sloping landing support instead of the old flat OSM levels',()=>{
 const layout=makeRealMapLayout(),q=createMapQueries(layout),surfaces=gwanghwamunCollision().surfaces.filter(s=>s.id.includes('roof'));
 let checked=0;
 for(const s of surfaces){
  for(const t of s.triangles){const tri=new THREE.Triangle(...t.map(p=>new THREE.Vector3(...p))),normal=tri.getNormal(new THREE.Vector3());if(normal.y<.65)continue;
   const p=tri.getMidpoint(new THREE.Vector3()),r=q.supportAt({at:p,previousFeetY:p.y,footRadiusM:.015,heightM:.2,maxRiseM:.02,maxDropM:.02});
   if(!r||!r.id.includes('roof'))continue;assert.ok(Math.abs(r.height-p.y)<1e-5);checked++;break;
  }
 }
 assert.ok(checked>=6,`roof sections checked ${checked}`);
});

test('actual pigeon lands and rests on the imported Woldae, portal thresholds and roof ridge without blocked frames',async()=>{
 const{createNativeMotionState,nativeFeet}=await import('../src/native/ported/motion/locomotion/b2/native-motion.ts');
 const{buildNativeAppearance,createSpeciesActor}=await import('../src/species-core/index.ts');
 const world=createMapQueries(makeRealMapLayout()),view={mode:'third',verticalFovDegrees:59,aspect:16/9},idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};
 for(const[x,z,y,expected]of[[0,177,2,.8],[4,145,24,21.35],[0,145,2,.85],[-10,145,2,.85]]){
  const rig=buildNativeAppearance({speciesId:'pigeon',skinId:'default'},0),body=rig.body;rig.dispose();const initial=createNativeMotionState({body,feet:gateWorld(x,z,y)});initial.grounded=false;initial.mode='fall';
  const actor=createSpeciesActor(new THREE.Scene(),{world,appearance:{speciesId:'pigeon',skinId:'default'},initialState:initial,view});
  try{for(let i=0;i<180;i++){const before=actor.snapshot(),frame=actor.prepareFrame({contractVersion:1,frame:before.lastFrame+1,simTime:before.state.time+.025,rawSeconds:.025,acceptedSeconds:.025,playing:true,quality:'mobile',reducedMotion:false},idle,view);assert.equal(frame.kind,'ready',`${x},${z}: ${frame.reason}`);frame.commit();}
   assert.equal(actor.state.mode,'rest');assert.ok(Math.abs(nativeFeet(actor.state).y-expected)<.002);assert.ok(actor.state.support.id.startsWith('sojang:gwanghwamun:'));
  }finally{actor.dispose();}
 }
});
