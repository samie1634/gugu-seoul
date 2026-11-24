import fs from 'node:fs';
import * as THREE from 'three';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {makeCloudPlatforms} from '../src/native/cloud-platforms.ts';
import {createWeatherRain,sampleWeather} from '../src/weather.ts';
const layout=makeMapLayout({data:'osm'}),clouds=makeCloudPlatforms(),results=[];
for(const quality of ['mobile','desktop']){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),rain=createWeatherRain(scene,{layout,clouds,quality});
 let updateMs=0,maxMs=0;const samples=[];
 for(let i=0;i<600;i++){
  camera.position.set(-336+i*.08,10,108+Math.sin(i*.02)*8);const time=500+i/60,start=performance.now();rain.update(time,camera,sampleWeather(time),1);const ms=performance.now()-start;updateMs+=ms;maxMs=Math.max(maxMs,ms);samples.push(ms);
 }
 samples.sort((a,b)=>a-b);results.push({quality,drops:rain.count,CPUmeanMs:updateMs/600,CPUmedianMs:samples[300],CPUp95Ms:samples[570],CPUmaxMs:maxMs,bytesPerFrame:rain.root.geometry.attributes.position.array.byteLength+rain.root.geometry.attributes.dropOpacity.array.byteLength,renderBatches:1});rain.dispose();
}
fs.writeFileSync('evidence/weather-cpu.json',JSON.stringify({context:'Node CPU only, not GPU/device FPS',results},null,2));console.log(results);
