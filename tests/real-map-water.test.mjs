import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPolygonWater } from '../src/native/ported/map/real-map/water.ts';
import { CHEONGGYE_LEVELS as levels, channelWaterAreas } from '../src/native/ported/map/real-map/cheonggye-channel.ts';
import { realSurfaces } from '../src/native/ported/map/real-map/surfaces.ts';
import { diskInside, polygonContains } from '../src/native/ported/map/real-map/geometry.ts';
const waterAreas = channelWaterAreas;
const wet = (x,z,r=0) => waterAreas.some(a => diskInside(a.rings,x,z,r));
const get = (w,name) => w.root.getObjectByName(`cheonggyecheon:${name}`);
function eachInstance(mesh, callback) {
  const matrix=new THREE.Matrix4(), position=new THREE.Vector3(), scale=new THREE.Vector3(), rotation=new THREE.Quaternion();
  for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);callback(position,scale,matrix,i);}
}
test('polygon water preserves clipped shape and has real submerged bed without extra render passes',()=>{
 const w=createPolygonWater();try{
  assert.equal(w.root.children.length,5);assert.equal(w.root.userData.reflectionPasses,0);
  const surface=get(w,'water'),bed=get(w,'bed');
  assert.equal(surface.material.transparent,true);assert.equal(surface.material.depthWrite,false);
  assert.ok(surface.material.uniforms.uPhase.value instanceof Float32Array);
  assert.match(surface.material.vertexShader,/#define PLANAR_WATER 0/);
  assert.match(surface.material.fragmentShader,/#define PLANAR_WATER 0/);
  assert.ok(Math.abs(surface.material.uniforms.uDepth.value-.3)<1e-8);
  assert.equal(w.root.children.some(m=>m.isReflector),false);
  assert.equal(surface.material.uniforms.tDiffuse,undefined);
  assert.deepEqual([...surface.geometry.index.array],[...bed.geometry.index.array]);
  const p=surface.geometry.attributes.position,b=bed.geometry.attributes.position;
  for(let i=0;i<p.count;i++){assert.ok(Math.abs(p.getY(i)-levels.water)<1e-6);assert.ok(Math.abs(b.getY(i)-levels.bed)<1e-6);}
  const index=surface.geometry.index;
  for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
   const x=ids.reduce((n,j)=>n+p.getX(j),0)/3,z=ids.reduce((n,j)=>n+p.getZ(j),0)/3;
   assert.ok(wet(x,z),`triangle outside river: ${x},${z}`);
  }
 }finally{w.dispose();}
});
test('all submerged decoration vertices remain inside exact water polygons and below surface',()=>{
 const w=createPolygonWater();try{
  for(const name of ['stones','plants','fish']){
   const mesh=get(w,name);assert.ok(mesh.count>0);
   eachInstance(mesh,(p,s,m)=>{
    const geometry=mesh.geometry.attributes.position;
    for(let j=0;j<geometry.count;j++){
     const point=new THREE.Vector3().fromBufferAttribute(geometry,j).applyMatrix4(m);
     assert.ok(wet(point.x,point.z),name);assert.ok(point.y<levels.water);assert.ok(point.y>=levels.bed-.00001);
    }
   });
  }
 }finally{w.dispose();}
});
test('fish remain bounded across long clocks and reversed playback',()=>{
 const w=createPolygonWater();try{
  for(const time of [1,100,1e8,1e15,Number.MAX_VALUE,2,0]){
   w.update(time);
   eachInstance(get(w,'fish'),p=>assert.ok(wet(p.x,p.z,.159)));
   for(const phase of get(w,'water').material.uniforms.uPhase.value)assert.ok(Number.isFinite(phase)&&phase>=0&&phase<=2*Math.PI);
  }
 }finally{w.dispose();}
});
test('ripples reject dry land but retain water under bridge decks; invalid times are ignored and rewinds clear contacts',()=>{
 const w=createPolygonWater();try{
  const uniforms=get(w,'water').material.uniforms;
  let site;eachInstance(get(w,'fish'),p=>{site??=p.clone();});
  w.update(1);w.addRipple(site.x,site.z,1);assert.equal(uniforms.uImpactCount.value,1);
  w.addRipple(0,0,1);w.addRipple(site.x,site.z,NaN);w.addRipple(site.x,site.z,-1);w.addRipple(site.x,site.z,1,Infinity);
  assert.equal(uniforms.uImpactCount.value,1);
  for(const bridge of realSurfaces.filter(s=>s.kind==='bridge')){
   const points=bridge.rings[0],x=points.reduce((a,p)=>a+p[0],0)/points.length,z=points.reduce((a,p)=>a+p[1],0)/points.length;
   if(polygonContains(bridge.rings,x,z)&&!wet(x,z)){w.addRipple(x,z,1);assert.equal(uniforms.uImpactCount.value,1);}
  }
  const phases=[...uniforms.uPhase.value];for(const t of [NaN,Infinity,-1])w.update(t);
  assert.deepEqual([...uniforms.uPhase.value],phases);
  w.update(0);assert.equal(uniforms.uImpactCount.value,0);
  w.update(1);w.addRipple(site.x,site.z,2);assert.equal(uniforms.uImpactCount.value,0);
  w.update(2);assert.equal(uniforms.uImpactCount.value,1);
  for(let i=0;i<10;i++)w.addRipple(site.x,site.z,2);assert.equal(uniforms.uImpactCount.value,4);
  w.update(6);assert.equal(uniforms.uImpactCount.value,0);
 }finally{w.dispose();}
});
test('deterministic instances, five mesh budget, and idempotent complete resource disposal',()=>{
 const a=createPolygonWater(),b=createPolygonWater();
 for(const name of ['stones','plants','fish'])assert.deepEqual([...get(a,name).instanceMatrix.array],[...get(b,name).instanceMatrix.array]);
 const counters={geometry:0,material:0,instance:0};
 for(const mesh of a.root.children){mesh.geometry.addEventListener('dispose',()=>counters.geometry++);mesh.material.addEventListener('dispose',()=>counters.material++);if(mesh.isInstancedMesh)mesh.addEventListener('dispose',()=>counters.instance++);}
 const parent=new THREE.Group();parent.add(a.root);a.dispose();a.dispose();a.update(4);a.addRipple(0,0,4);
 assert.deepEqual(counters,{geometry:5,material:5,instance:3});assert.equal(parent.children.length,0);assert.equal(a.root.children.length,0);
 b.dispose();
});
