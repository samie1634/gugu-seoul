import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPolygonWater } from '../src/native/ported/map/real-map/water.ts';
import { WATER_DISTANCE_STYLE, waterDistanceBlend, waterReflectionWeight } from '../src/native/ported/map/real-map/water-distance.ts';
import { WATER_MIRROR_BUDGET, reflectionEligible } from '../src/native/ported/map/real-map/water-reflection.ts';

test('distance sky weight rises continuously beyond near range and remains visible overhead',()=>{
 for(const distance of[0,10,35])assert.equal(waterDistanceBlend(distance),0);
 for(const distance of[170,300,700,1200,2400])assert.equal(waterDistanceBlend(distance),1);
 for(const incidence of[0,.2,.5,.8,1]){
  let previous=0;
  for(let distance=0;distance<=1000;distance++){
   const weight=waterReflectionWeight(distance,incidence);
   assert.ok(weight>=previous&&weight<=1);previous=weight;
   if(distance>=170)assert.ok(weight>=.62);
  }
 }
 assert.equal(waterReflectionWeight(20,1),.08);
 assert.equal(waterReflectionWeight(300,1),.62);
 assert.ok(Math.abs(waterReflectionWeight(110.001,1)-waterReflectionWeight(109.999,1))<.00002);
 for(const distance of[NaN,Infinity,-1])assert.ok(Number.isFinite(waterReflectionWeight(distance,1)));
});

test('mobile and desktop shaders keep distant sky, discard invented banks and smooth tiny waves without extra passes',()=>{
 for(const quality of['mobile','desktop']){
  const water=createPolygonWater(quality);try{
   const mesh=water.root.getObjectByName('cheonggyecheon:water'),shader=mesh.material.fragmentShader;
   assert.match(shader,/smoothstep\(35\.0, 170\.0, distance\(cameraPosition, vWaterWorld\)\)/);
   assert.match(shader,/mix\(0\.08, 0\.62, farWater\)/);
   assert.match(shader,/horizon\*bankFacing\*\(1\.0-farWater\)/);
   assert.match(shader,/slope \*= mix\(1\.0, 0\.32, farWater\)/);
   assert.match(shader,/sampleSeoulEnvironment\(ray,vWaterWorld/);
   assert.match(shader,/#include <fog_fragment>/);
   assert.equal(water.root.children.length,5);
   assert.equal(water.root.userData.reflectionPasses,quality==='desktop'?1:0);
   assert.deepEqual(water.root.userData.distantSkyReflection,{...WATER_DISTANCE_STYLE,extraPasses:0});
  }finally{water.dispose();}
 }
 assert.deepEqual(WATER_MIRROR_BUDGET,{width:256,height:128,interval:1/12,maxDistance:110,maxHeight:80});
 const camera=new THREE.PerspectiveCamera();camera.position.set(500,150,500);camera.updateMatrixWorld(true);
 assert.equal(reflectionEligible(camera,[{rings:[[[0,0],[20,0],[20,20],[0,20],[0,0]]]}],.02),false);
 assert.equal(waterReflectionWeight(camera.position.length(),1),.62);
});
