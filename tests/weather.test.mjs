import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {sampleWeather,createWeatherRain,createWeatherShelter,WEATHER_CLOUD_GLSL} from '../src/weather.ts';
import {createDayCycle,DAY_SECONDS} from '../src/day-cycle.ts';
import {createReflectionEnvironment} from '../src/native/ported/map/real-map/reflection-environment.ts';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {makeCloudPlatforms} from '../src/native/cloud-platforms.ts';
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} vs ${b}`);

test('weather follows the active 24-minute day, stays bounded, and transitions continuously',()=>{
 assert.equal(sampleWeather(0).kind,'clear');assert.equal(sampleWeather(400).kind,'rain');assert.equal(sampleWeather(900).kind,'overcast');
 for(let t=0;t<=DAY_SECONDS;t+=.5){const w=sampleWeather(t),n=sampleWeather(t+.01);for(const key of ['rain','overcast','cloudiness']){assert.ok(w[key]>=0&&w[key]<=1);assert.ok(Math.abs(w[key]-n[key])<.001);}}
 assert.deepEqual(sampleWeather(0),sampleWeather(1440));assert.deepEqual(sampleWeather(600),sampleWeather(2040));
 assert.throws(()=>sampleWeather(-1),RangeError);assert.throws(()=>sampleWeather(Infinity),RangeError);
});

test('rain shelter respects actual polygons, holes, highest roofs and cloud caps',()=>{
 const ring=[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[7,3],[7,7],[3,7],[3,3]]];
 const shelter=createWeatherShelter({layout:{realMap:{buildings:[{rings:ring,height:20}],roads:[],water:[]}},clouds:[{rings:[[[20,20],[30,20],[30,30],[20,30],[20,20]]],height:100}]});
 assert.equal(shelter(1,1),20);assert.equal(shelter(5,5),0);assert.equal(shelter(25,25),100);assert.equal(shelter(40,40),0);
 const real=createWeatherShelter({layout:makeMapLayout({data:'osm'}),clouds:makeCloudPlatforms()});
 for(const cloud of makeCloudPlatforms())assert.ok(real(cloud.x,cloud.z)>=cloud.height);
});

test('rain is one bounded batch, hidden in clear weather, stationary while active time pauses',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(-336,2,108);
 for(const quality of ['mobile','desktop']){
  const rain=createWeatherRain(scene,{quality});assert.equal(rain.count,quality==='mobile'?160:360);assert.equal(rain.root.material.depthTest,true);assert.equal(rain.root.material.depthWrite,false);
  rain.update(0,camera,sampleWeather(0),1);assert.equal(rain.root.visible,false);
  rain.update(500,camera,sampleWeather(500),1);assert.equal(rain.root.visible,true);
  const p=rain.root.geometry.attributes.position,a=rain.root.geometry.attributes.dropOpacity;
  assert.ok([...p.array].every(Number.isFinite));assert.ok([...a.array].some(n=>n>0));
  for(let i=0;i<rain.count;i++)if(a.getX(i*2)>0)assert.ok(p.getY(i*2+1)>.03);
  const paused=Array.from(p.array),version=p.version;rain.update(500,camera,sampleWeather(500),1);assert.deepEqual(Array.from(p.array),paused);assert.equal(p.version,version);
  rain.update(500.1,camera,sampleWeather(500.1),1);assert.notDeepEqual(Array.from(p.array),paused);
  rain.dispose();rain.dispose();assert.equal(scene.children.length,0);
 }
 const reduced=createWeatherRain(scene,{reducedMotion:true});reduced.update(500,camera,sampleWeather(500),1);assert.equal(reduced.root.visible,false);reduced.dispose();
});

test('roof shelter suppresses all below-roof rain even when the camera is under cover',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(50,2,50);
 const rings=[[[-100,-100],[200,-100],[200,200],[-100,200],[-100,-100]]];
 const rain=createWeatherRain(scene,{layout:{realMap:{buildings:[{rings,height:50}],roads:[],water:[]}}});rain.update(500,camera,sampleWeather(500),1);
 assert.ok([...rain.root.geometry.attributes.dropOpacity.array].every(n=>n===0));rain.dispose();
});

test('weather drives existing sky, visible celestial objects, fog and reflection state together',()=>{
 const scene=new THREE.Scene();scene.background=new THREE.Color();scene.fog=new THREE.Fog('#ffffff',280,1700);
 const hemi=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight(),camera=new THREE.PerspectiveCamera(),cycle=createDayCycle(scene,hemi,sun);
 const environment=createReflectionEnvironment();
 for(const t of [0,500,900,1440]){
  cycle.update(t,camera,{x:0,y:0,z:0});environment.update(t);
  assert.deepEqual(cycle.snapshot().weather,sampleWeather(t));near(environment.uniforms.uReflectionRain.value,sampleWeather(t).rain);
  near(environment.uniforms.uReflectionCloudiness.value,sampleWeather(t).cloudiness);
  assert.ok(hemi.intensity>=.38);assert.ok(sun.intensity>=.28);assert.ok(scene.fog.far>=900);
 }
 const solar=scene.getObjectByName('seoul:sun'),lunar=scene.getObjectByName('seoul:moon');
 assert.equal(solar.material.transparent,false,'celestial disks stay in opaque sky order, behind buildings');assert.equal(lunar.material.transparent,false);
 assert.match(WEATHER_CLOUD_GLSL,/weatherNoise/);
 const dome=cycle.root.children.find(o=>o.material?.isShaderMaterial&&o.geometry?.type==='SphereGeometry');assert.match(dome.material.fragmentShader,/weatherClouds\(color,d,weatherDaylight\)/);
 cycle.dispose();assert.equal(scene.children.length,0);
});
