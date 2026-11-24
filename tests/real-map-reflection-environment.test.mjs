import{test}from'node:test';import assert from'node:assert/strict';import{createReflectionEnvironment,REFLECTION_ENVIRONMENT_GLSL}from'../src/native/ported/map/real-map/reflection-environment.ts';
import{sampleDayCycle}from'../src/day-cycle.ts';
test('glass and water environment follows the same active 24-minute day clock',()=>{
 const e=createReflectionEnvironment();for(const t of[0,180,540,900,1260,1440,1e12]){e.update(t);const s=sampleDayCycle(t);assert.equal(e.uniforms.uReflectionDaylight.value,s.daylight);assert.deepEqual(e.uniforms.uReflectionSunDirection.value.toArray(),[s.sunDirection.x,s.sunDirection.y,s.sunDirection.z]);assert.equal(e.uniforms.uReflectionTime.value,t);}
 e.update(0);const day=e.uniforms.uReflectionZenith.value.clone();e.update(900);assert.ok(e.uniforms.uReflectionZenith.value.r<day.r);e.update(1440);assert.ok(e.uniforms.uReflectionZenith.value.equals(day));
});
test('invalid clocks do not pollute reflection uniforms and shader is an explicit analytical fallback',()=>{
 const e=createReflectionEnvironment();e.update(54);const previous=e.uniforms.uReflectionTime.value;for(const t of[NaN,Infinity,-1])e.update(t);assert.equal(e.uniforms.uReflectionTime.value,previous);assert.match(REFLECTION_ENVIRONMENT_GLSL,/sampleSeoulEnvironment/);assert.doesNotMatch(REFLECTION_ENVIRONMENT_GLSL,/textureCube|samplerCube/);
});

import * as THREE from 'three';
import { createDayCycle } from '../src/day-cycle.ts';
import { WEATHER_CLOUD_GLSL } from '../src/weather.ts';
test('fallback clouds and storm horizon match the actual sky for every weather phase',()=>{
 const scene=new THREE.Scene(),sky=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight();
 const day=createDayCycle(scene,sky,sun),environment=createReflectionEnvironment(),camera=new THREE.PerspectiveCamera();
 try{for(const t of[0,120,360,540,720,1050,1440,4095,4096,5000]){
  day.update(t,camera,{x:0,y:0,z:0});environment.update(t);
  const dome=day.root.children.find(o=>o.geometry?.type==='SphereGeometry'),u=dome.material.uniforms;
  assert.ok(environment.uniforms.uReflectionHorizon.value.equals(u.horizon.value));
  assert.ok(environment.uniforms.uReflectionZenith.value.equals(u.zenith.value));
  assert.equal(environment.uniforms.uReflectionCloudiness.value,u.cloudiness.value);
  assert.equal(environment.uniforms.uReflectionRain.value,u.rainAmount.value);
  assert.equal(environment.uniforms.uReflectionTime.value,u.weatherTime.value);
 }
 const expected=WEATHER_CLOUD_GLSL.replaceAll('cloudiness','uReflectionCloudiness').replaceAll('rainAmount','uReflectionRain').replaceAll('weatherTime','uReflectionTime').replaceAll('weatherHash','reflectionWeatherHash').replaceAll('weatherNoise','reflectionWeatherNoise').replaceAll('weatherClouds','reflectionWeatherClouds');
 assert.ok(REFLECTION_ENVIRONMENT_GLSL.includes(expected));
 }finally{day.dispose();}
});
