import * as THREE from 'three';
import type { MapLayout } from './native/ported/map/contracts.ts';
import { footprintIndex, diskIntersects } from './native/ported/map/real-map/geometry.ts';
import type { CloudPlatform } from './native/cloud-platforms.ts';

const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
/** Authored game weather, not live Seoul observations. One loop is one 24-minute day. */
export function sampleWeather(activeSeconds:number){
  if(!Number.isFinite(activeSeconds)||activeSeconds<0)throw new RangeError('Invalid weather clock');
  const phase=(activeSeconds%1440)/1440;
  const ramp=(start:number,end:number)=>smooth((phase-start)/(end-start));
  const overcast=ramp(.08,.25)*(1-ramp(.57,.76));
  const rain=ramp(.25,.32)*(1-ramp(.48,.58));
  return{cloudiness:.28+.69*overcast,rain,overcast,windX:1.8+rain*2.6,windZ:.6+rain*.8,
    kind:rain>.05?'rain':overcast>.6?'overcast':overcast>.1?'cloudy':'clear'};
}
export type WeatherState=ReturnType<typeof sampleWeather>;
export interface WeatherOptions {quality?:'desktop'|'mobile';reducedMotion?:boolean;layout?:MapLayout;clouds?:readonly CloudPlatform[]}
/** Rain ends above actual roofs/bridge-ground and cloud perches; courtyard holes stay open. */
export function createWeatherShelter(options:WeatherOptions={}){
  const data=options.layout?.realMap,buildingIndex=data?footprintIndex(data.buildings):null,cloudIndex=footprintIndex([...(options.clouds??[])]);
  return(x:number,z:number)=>{
    let height=0;
    if(data&&buildingIndex){for(const b of buildingIndex(x,z,.2))if(diskIntersects(b.rings,x,z,.2))height=Math.max(height,b.height);}
    else for(const b of options.layout?.colliders??[])if(Math.abs(x-b.x)<=b.width/2&&Math.abs(z-b.z)<=b.depth/2)height=Math.max(height,b.height);
    for(const c of cloudIndex(x,z,.2))if(diskIntersects(c.rings,x,z,.2))height=Math.max(height,c.height);
    return height;
  };
}
/** One depth-tested batch. No textures, shadows, reflection pass, or per-drop objects. */
export function createWeatherRain(scene:THREE.Scene,options:WeatherOptions={}){
  const count=options.quality==='mobile'?160:360,positions=new Float32Array(count*6),opacity=new Float32Array(count*2);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('dropOpacity',new THREE.BufferAttribute(opacity,1).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,fog:false,
    uniforms:{tint:{value:new THREE.Color('#c6d8e8')}},
    vertexShader:'attribute float dropOpacity; varying float vOpacity; void main(){vOpacity=dropOpacity; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'uniform vec3 tint; varying float vOpacity; void main(){gl_FragColor=vec4(tint,vOpacity);\n #include <tonemapping_fragment>\n #include <colorspace_fragment> }'});
  const root=new THREE.LineSegments(geometry,material);root.name='seoul:weather-rain';root.frustumCulled=false;root.visible=false;scene.add(root);
  const shelter=createWeatherShelter(options),floors=new Float32Array(count),xs=new Float32Array(count),zs=new Float32Array(count),seeds=new Float32Array(count);
  let seed=98173;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  for(let i=0;i<count;i++){xs[i]=(random()-.5)*80;zs[i]=(random()-.5)*80;seeds[i]=random();}
  let anchorX=Infinity,anchorZ=Infinity,disposed=false,lastTime=NaN,lastCamera='';
  const update=(time:number,camera:THREE.Camera,state:WeatherState,daylight:number)=>{
    if(disposed)return;
    root.visible=state.rain>.005&&!options.reducedMotion;
    if(!root.visible)return;
    const cameraKey=`${camera.position.x},${camera.position.y},${camera.position.z}`;
    if(time===lastTime&&cameraKey===lastCamera)return;
    lastTime=time;lastCamera=cameraKey;
    const ax=Math.floor(camera.position.x/8)*8,az=Math.floor(camera.position.z/8)*8;
    if(ax!==anchorX||az!==anchorZ){anchorX=ax;anchorZ=az;for(let i=0;i<count;i++)floors[i]=shelter(ax+xs[i],az+zs[i]);}
    const top=camera.position.y+30,span=50;
    for(let i=0;i<count;i++){
      const x=anchorX+xs[i],z=anchorZ+zs[i],y=top-((time*22+seeds[i]*span)%span),length=.65+seeds[i]*.55;
      const bottom=y-length,visible=bottom>floors[i]+.03;
      // Vanish before a roof rather than drawing below it; avoid streaks touching the lens.
      const distance=Math.hypot(x-camera.position.x,z-camera.position.z);
      const alpha=visible?state.rain*.42*smooth((distance-.65)/2)*(1-smooth((distance-30)/15))*(.35+.65*daylight):0;
      const at=i*6;positions[at]=x;positions[at+1]=y;positions[at+2]=z;positions[at+3]=x+state.windX*.035;positions[at+4]=bottom;positions[at+5]=z+state.windZ*.035;opacity[i*2]=alpha*.55;opacity[i*2+1]=alpha;
    }
    geometry.attributes.position.needsUpdate=true;geometry.attributes.dropOpacity.needsUpdate=true;
  };
  return{root,count,update,dispose(){if(disposed)return;disposed=true;root.removeFromParent();geometry.dispose();material.dispose();}};
}

export const WEATHER_CLOUD_GLSL=/*glsl*/`
uniform float cloudiness; uniform float rainAmount; uniform float weatherTime;
float weatherHash(vec2 p){return fract(sin(dot(mod(p,113.),vec2(127.1,311.7)))*43758.5453);}
float weatherNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(weatherHash(i),weatherHash(i+vec2(1.,0.)),f.x),mix(weatherHash(i+vec2(0.,1.)),weatherHash(i+1.),f.x),f.y);}
vec3 weatherClouds(vec3 sky,vec3 ray,float daylight){
 if(ray.y<=.01)return sky;
 vec2 uv=ray.xz/max(ray.y,.12)*1.4+vec2(weatherTime*.003,weatherTime*.001);
 float noise=weatherNoise(uv)*.55+weatherNoise(uv*2.03+4.1)*.30+weatherNoise(uv*4.1+17.3)*.15;
 float coverage=smoothstep(1.-cloudiness-.18,1.-cloudiness+.12,noise)*smoothstep(.01,.18,ray.y);
 vec3 cloud=mix(vec3(.075,.095,.145),vec3(.82,.86,.90),daylight);
 cloud*=mix(.70,1.02,noise)*(1.-rainAmount*.28);
 return mix(sky,cloud,coverage*.92);
}
`;
