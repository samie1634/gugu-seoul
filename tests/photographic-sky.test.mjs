import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {createSkyPhotograph,findPanoramaSun,photographWeight,setPhotographTransform,PHOTOGRAPHIC_SKY_GLSL} from '../src/photographic-sky.ts';
import {createDayCycle,sampleDayCycle} from '../src/day-cycle.ts';
import {sampleWeather} from '../src/weather.ts';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {limitWaterReflection} from '../src/native/ported/map/real-map/water-reflection.ts';
import {createReflectionEnvironment,REFLECTION_ENVIRONMENT_GLSL} from '../src/native/ported/map/real-map/reflection-environment.ts';

test('Museum SAN panorama bytes are unmodified and mobile uses a quarter as many HDR pixels',async()=>{
 const variants=[['1k',1024,'fd94c84997b8a3c353b62c2125a9b44e19509956986a126e472684432a02d798'],['2k',2048,'5244534e9cf5b606f2ff513aa00ddb161b0a4826ffd88a0d3bd03ac29247d198']];
 for(const [name,width,sha]of variants){const bytes=await fs.readFile(new URL(`../public/assets/sky/sky-${name}.hdr`,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);const image=new HDRLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.equal(image.width,width);assert.equal(image.height,width/2);const sun=findPanoramaSun(image);assert.ok(sun.y>0);assert.ok(Math.abs(sun.length()-1)<1e-10);}
});
test('photo weight is continuous and disappears completely at night and in overcast weather',()=>{
 assert.equal(photographWeight(1,.28),1);assert.equal(photographWeight(0,.28),0);assert.equal(photographWeight(1,.97),0);
 for(let c=0;c<1;c+=.001){const w=photographWeight(.7,c);assert.ok(w>=0&&w<=1);assert.ok(Math.abs(w-photographWeight(.7,c+.001))<.01);}
});
test('visible sky and distant reflection use one decoded mobile source, even when simulation is paused',async()=>{
 const previous=globalThis.fetch;let fetches=0;
 globalThis.fetch=async url=>{fetches++;assert.match(url,/sky-1k\.hdr$/);const bytes=await fs.readFile(new URL('../public/assets/sky/sky-1k.hdr',import.meta.url));return new Response(bytes);};
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),cycle=createDayCycle(scene,new THREE.HemisphereLight(),new THREE.DirectionalLight(),{quality:'mobile'}),reflection=createReflectionEnvironment('mobile');
 try{
  cycle.update(0,camera,{x:0,y:0,z:0});reflection.update(0);
  const dome=cycle.root.children.find(o=>o.geometry?.type==='SphereGeometry'),u=dome.material.uniforms;
  assert.equal(u.seoulPhotoReady.value,0);assert.equal(u.seoulPhotoPanorama,reflection.uniforms.seoulPhotoPanorama);
  await Promise.all([cycle.load(),cycle.load()]);assert.equal(fetches,1);
  assert.equal(u.seoulPhotoReady.value,1);assert.equal(reflection.uniforms.seoulPhotoReady.value,1);assert.equal(u.seoulPhotoPanorama.value.image.width,1024);
  for(const time of [0,120,360,540,900,1440]){cycle.update(time,camera,{x:0,y:0,z:0});reflection.update(time);assert.equal(u.seoulPhotoWeight.value,reflection.uniforms.seoulPhotoWeight.value);assert.deepEqual(u.seoulPhotoToCapture.value.elements,reflection.uniforms.seoulPhotoToCapture.value.elements);}
  cycle.update(0,camera,{x:0,y:0,z:0});assert.equal(scene.getObjectByName('seoul:sun').visible,false,'the photographed sun replaces the extra disc');
  assert.ok(REFLECTION_ENVIRONMENT_GLSL.includes(PHOTOGRAPHIC_SKY_GLSL));assert.equal(cycle.snapshot().photograph.extraPasses,0);
  let disposed=0;u.seoulPhotoPanorama.value.addEventListener('dispose',()=>disposed++);cycle.dispose();assert.equal(disposed,0);reflection.dispose();assert.equal(disposed,1);reflection.dispose();assert.equal(disposed,1);
 }finally{cycle.dispose();reflection.dispose();globalThis.fetch=previous;}
});
test('failed image load retains the dynamic sky and releases the source without rejecting',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:404});
 const photo=createSkyPhotograph('mobile');try{await photo.load();photo.update(1,.28,{x:0,y:1,z:0});assert.equal(photo.snapshot().status,'fallback');assert.equal(photo.uniforms.seoulPhotoReady.value,0);}finally{photo.dispose();globalThis.fetch=previous;}
});
test('disposal during the deferred fetch does not publish a texture into the next scene',async()=>{
 const previous=globalThis.fetch;let release;const gate=new Promise(resolve=>{release=resolve;});
 const bytes=await fs.readFile(new URL('../public/assets/sky/sky-1k.hdr',import.meta.url));
 globalThis.fetch=async()=>{await gate;return new Response(bytes);};
 const first=createSkyPhotograph('mobile'),pending=first.load();first.dispose();
 const next=createSkyPhotograph('mobile');
 try{release();await pending;assert.equal(next.snapshot().status,'idle');assert.equal(next.uniforms.seoulPhotoReady.value,0);await next.load();assert.equal(next.snapshot().status,'ready');}finally{next.dispose();globalThis.fetch=previous;}
});

async function capturedSun(variant='1k'){
 const bytes=await fs.readFile(new URL(`../public/assets/sky/sky-${variant}.hdr`,import.meta.url));
 return findPanoramaSun(new HDRLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
}
test('yaw and bounded latitude reprojection keep every upper ray above the source horizon and align the sun',async()=>{
 const matrix=new THREE.Matrix3(),ray=new THREE.Vector3(),projected=new THREE.Vector3();
 for(const variant of ['1k','2k']){
  const captured=await capturedSun(variant);
  for(let time=0;time<=1440;time+=5){
   const sun=sampleDayCycle(time).sunDirection,weight=setPhotographTransform(matrix,captured,sun);
   assert.ok(matrix.elements.every(Number.isFinite));assert.ok(weight>=0&&weight<=1);
   for(let elevation=0;elevation<=90;elevation+=5)for(let azimuth=0;azimuth<360;azimuth+=5){
    const e=elevation*Math.PI/180,a=azimuth*Math.PI/180;
    ray.set(Math.cos(e)*Math.cos(a),Math.sin(e),Math.cos(e)*Math.sin(a));projected.copy(ray).applyMatrix3(matrix).normalize();
    assert.ok(projected.y>=-1e-12,`${variant} t=${time}, elevation=${elevation}, azimuth=${azimuth}`);
    if(elevation===0)assert.ok(Math.abs(projected.y)<1e-12,'the horizon cannot tilt');
   }
   if(weight>0){projected.set(sun.x,sun.y,sun.z).applyMatrix3(matrix).normalize();assert.ok(projected.angleTo(captured)<1e-7,'the photograph sun follows the unchanged game sun');}
  }
  assert.equal(setPhotographTransform(matrix,captured,sampleDayCycle(0).sunDirection),1);
  for(const time of [120,180,900,1300])assert.equal(setPhotographTransform(matrix,captured,sampleDayCycle(time).sunDirection),0);
  for(const sun of [{x:0,y:1,z:0},{x:0,y:0,z:1},{x:0,y:-1,z:0},{x:NaN,y:1,z:0},{x:1,y:Infinity,z:1}]){
   assert.equal(setPhotographTransform(matrix,captured,sun),0);assert.ok(matrix.elements.every(Number.isFinite));
  }
 }
 assert.match(PHOTOGRAPHIC_SKY_GLSL,/ray.y<=0/);assert.match(PHOTOGRAPHIC_SKY_GLSL,/if\(p.y<=0.\)return sky/);
});
test('angle suitability fades continuously without changing day-cycle sun positions',async()=>{
 const captured=await capturedSun(),matrix=new THREE.Matrix3();let previous=null;
 for(let time=0;time<=1440;time+=.25){
  const day=sampleDayCycle(time),weather=sampleWeather(time),before={...day.sunDirection};
  const weight=photographWeight(day.daylight,weather.cloudiness)*setPhotographTransform(matrix,captured,day.sunDirection);
  assert.deepEqual(day.sunDirection,before);assert.ok(weight>=0&&weight<=1);
  if(previous!==null)assert.ok(Math.abs(weight-previous)<.03,`weight jumps at ${time}`);previous=weight;
 }
});
test('HDR finishing after a pause updates all saved analytic bindings before shared readiness',async()=>{
 const previous=globalThis.fetch;let finish;const gate=new Promise(resolve=>{finish=resolve;});
 const bytes=await fs.readFile(new URL('../public/assets/sky/sky-1k.hdr',import.meta.url));
 globalThis.fetch=async()=>{await gate;return new Response(bytes);};
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),cycle=createDayCycle(scene,new THREE.HemisphereLight(),new THREE.DirectionalLight(),{quality:'mobile'}),reflection=createReflectionEnvironment('mobile');
 try{
  cycle.update(0,camera,{x:0,y:0,z:0});reflection.update(0);
  const u=cycle.root.children.find(o=>o.geometry?.type==='SphereGeometry').material.uniforms;
  const loading=cycle.load();finish();await loading;
  // Deliberately do not call reflection.update after load: paused map.update skips it.
  assert.equal(u.seoulPhotoReady.value,1);assert.ok(u.seoulPhotoToCapture.value.equals(reflection.uniforms.seoulPhotoToCapture.value));
  assert.equal(u.seoulPhotoWeight.value,reflection.uniforms.seoulPhotoWeight.value);
  cycle.update(0,camera,{x:0,y:0,z:0});assert.ok(u.seoulPhotoToCapture.value.equals(reflection.uniforms.seoulPhotoToCapture.value));
  const sun=sampleDayCycle(0).sunDirection,captured=await capturedSun();
  for(const uniforms of [u,reflection.uniforms])assert.ok(new THREE.Vector3(sun.x,sun.y,sun.z).applyMatrix3(uniforms.seoulPhotoToCapture.value).normalize().angleTo(captured)<1e-7);
 }finally{cycle.dispose();reflection.dispose();globalThis.fetch=previous;}
});
test('paused desktop mirror drops its stale capture on HDR readiness and refreshes only at the existing budget',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async()=>new Response(await fs.readFile(new URL('../public/assets/sky/sky-1k.hdr',import.meta.url)));
 const photo=createSkyPhotograph('mobile'),environment=createReflectionEnvironment('mobile');
 const mirror=new Reflector(new THREE.PlaneGeometry(20,20)),root=new THREE.Group(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();root.add(mirror);scene.add(root);camera.position.set(10,2,10);camera.updateMatrixWorld(true);
 mirror.material.uniforms.uMirrorActive={value:0};let time=0;const captures=[];
 const renderer={extensions:{has:()=>true},getRenderTarget:()=>null,setRenderTarget(){},xr:{enabled:true},shadowMap:{autoUpdate:true},state:{viewport(){}}};
 mirror.onBeforeRender=()=>captures.push(environment.uniforms.seoulPhotoReady.value);
 limitWaterReflection(mirror,root,[{rings:[[[0,0],[20,0],[20,20],[0,20],[0,0]]]}],0,()=>time,()=>environment.uniforms.seoulPhotoReady.value);
 const draw=()=>mirror.onBeforeRender(renderer,scene,camera,mirror.geometry,mirror.material,null);
 try{
  draw();assert.deepEqual(captures,[0]);assert.equal(mirror.material.uniforms.uMirrorActive.value,1);
  await photo.load();draw();assert.deepEqual(captures,[0]);assert.equal(mirror.material.uniforms.uMirrorActive.value,0,'fresh photographic fallback replaces the old planar sky while paused');
  for(let i=0;i<10;i++)draw();assert.deepEqual(captures,[0]);
  time=.04;draw();assert.deepEqual(captures,[0]);time=1/12;draw();assert.deepEqual(captures,[0,1]);assert.equal(mirror.material.uniforms.uMirrorActive.value,1);
 }finally{photo.dispose();environment.dispose();mirror.geometry.dispose();mirror.dispose();globalThis.fetch=previous;}
});
