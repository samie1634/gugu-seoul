import * as THREE from 'three';
import { createSkyPhotograph, PHOTOGRAPHIC_SKY_GLSL } from '../../../../photographic-sky.ts';
import { sampleDayCycle } from '../../../../day-cycle.ts';
import { sampleWeather, WEATHER_CLOUD_GLSL } from '../../../../weather.ts';
export interface ReflectionEnvironment { uniforms:Record<string,THREE.IUniform>; update(time:number):void; dispose():void }
/** Shared photographic sky and weather fallback, not a capture of nearby buildings. */
export function createReflectionEnvironment(quality:'desktop'|'mobile'='desktop'):ReflectionEnvironment{
  const photograph=createSkyPhotograph(quality);
  const uniforms={...photograph.uniforms,
    uReflectionCloudiness:{value:.28},uReflectionRain:{value:0},uReflectionOvercast:{value:0},uReflectionDaylight:{value:1},uReflectionTwilight:{value:0},uReflectionTime:{value:0},
    uReflectionZenith:{value:new THREE.Color()},uReflectionHorizon:{value:new THREE.Color()},
    uReflectionSunDirection:{value:new THREE.Vector3()},uReflectionMoonDirection:{value:new THREE.Vector3()},
  };
  const nightZenith=new THREE.Color('#101a35'),dayZenith=new THREE.Color('#3b79b4');
  const nightHorizon=new THREE.Color('#334567'),dayHorizon=new THREE.Color('#d6e3e4'),duskHorizon=new THREE.Color('#e4a37f'),stormHorizon=new THREE.Color('#7f8c9d');
  function update(time:number){
    if(!Number.isFinite(time)||time<0)return;
    const w=sampleWeather(time);uniforms.uReflectionCloudiness.value=w.cloudiness;uniforms.uReflectionRain.value=w.rain;uniforms.uReflectionOvercast.value=w.overcast;
    const s=sampleDayCycle(time);photograph.update(s.daylight,w.cloudiness,s.sunDirection);uniforms.uReflectionDaylight.value=s.daylight;uniforms.uReflectionTwilight.value=s.twilight;
    uniforms.uReflectionTime.value=time;
    uniforms.uReflectionZenith.value.copy(nightZenith).lerp(dayZenith,s.daylight);
    uniforms.uReflectionHorizon.value.copy(nightHorizon).lerp(dayHorizon,s.daylight).lerp(duskHorizon,s.twilight*.65).lerp(stormHorizon,w.overcast*s.daylight*.48);
    uniforms.uReflectionSunDirection.value.set(s.sunDirection.x,s.sunDirection.y,s.sunDirection.z);
    uniforms.uReflectionMoonDirection.value.set(s.moonDirection.x,s.moonDirection.y,s.moonDirection.z);
  }
  update(0);return{uniforms,update,dispose:photograph.dispose};
}
// Use precisely the visible sky's direction-space cloud field, not an unrelated
// world-space noise field. A distinct namespace keeps building shaders compatible.
const reflectionClouds = WEATHER_CLOUD_GLSL
  .replaceAll('cloudiness', 'uReflectionCloudiness').replaceAll('rainAmount', 'uReflectionRain')
  .replaceAll('weatherTime', 'uReflectionTime').replaceAll('weatherHash', 'reflectionWeatherHash')
  .replaceAll('weatherNoise', 'reflectionWeatherNoise').replaceAll('weatherClouds', 'reflectionWeatherClouds');
export const REFLECTION_ENVIRONMENT_GLSL=/*glsl*/`
uniform float uReflectionOvercast;
uniform float uReflectionDaylight;
uniform float uReflectionTwilight;
${reflectionClouds}
${PHOTOGRAPHIC_SKY_GLSL}
uniform vec3 uReflectionZenith;
uniform vec3 uReflectionHorizon;
uniform vec3 uReflectionSunDirection;
uniform vec3 uReflectionMoonDirection;
vec3 sampleSeoulEnvironment(vec3 direction,vec3 worldPosition,float roughness){
  vec3 ray=normalize(direction);float up=max(0.,ray.y);
  vec3 sky=mix(uReflectionHorizon,uReflectionZenith,pow(up,.55));
  float glow=pow(max(0.,dot(ray,uReflectionSunDirection)),5.)*(1.-up)*uReflectionTwilight;
  sky=mix(sky,vec3(1.,.39,.17),glow*.48);
  if(seoulPhotoWeight*seoulPhotoReady<.999)sky=reflectionWeatherClouds(sky,ray,uReflectionDaylight);
  sky=applySeoulSkyPhotograph(sky,ray);
  float sun=pow(max(0.,dot(ray,uReflectionSunDirection)),mix(1800.,60.,roughness));
  float moon=pow(max(0.,dot(ray,uReflectionMoonDirection)),mix(2400.,100.,roughness));
  sky+=vec3(1.,.85,.61)*sun*(1.-seoulPhotoWeight*seoulPhotoReady)*max(0.,uReflectionSunDirection.y)*(1.-roughness*.65)*(1.-uReflectionOvercast*.92);
  sky+=vec3(.35,.48,.67)*moon*max(0.,uReflectionMoonDirection.y)*(1.-uReflectionDaylight)*.65*(1.-uReflectionOvercast*.88);
  vec3 ground=mix(vec3(.018,.024,.036),vec3(.13,.15,.145),uReflectionDaylight);
  return mix(ground,sky,smoothstep(-.12,.04,ray.y));
}
`;
