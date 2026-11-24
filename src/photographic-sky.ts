import * as THREE from 'three';
import type { WeatherOptions } from './weather.ts';

// Reuses the unmodified CC0 Poly Haven sky already used by Sojang Museum SAN.
// One decoded panorama per quality tier; no cube probe or extra render pass.
type Quality = NonNullable<WeatherOptions['quality']>;
type Source = { refs:number; texture:THREE.DataTexture; ready:boolean; panorama:THREE.IUniform<THREE.DataTexture>; available:THREE.IUniform<number>; capturedSun:THREE.Vector3; loading:Promise<void>|null; disposed:boolean; status:'idle'|'loading'|'ready'|'fallback'; abort:AbortController; bindings:Set<()=>void> };
const sources = new Map<Quality, Source>();
const fallback = () => {const t=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);t.needsUpdate=true;return t;};

export function findPanoramaSun(image:{data:Uint16Array|Float32Array;width:number;height:number}) {
  const {data,width,height}=image,half=data instanceof Uint16Array;
  const read=(i:number)=>half?THREE.DataUtils.fromHalfFloat(data[i]):data[i];
  let peak=-Infinity,bestX=width/2,bestY=height/4;
  for(let y=2;y<height*.48;y+=2)for(let x=0;x<width;x+=2){
    const i=(y*width+x)*4,light=.2126*read(i)+.7152*read(i+1)+.0722*read(i+2);
    if(light>peak){peak=light;bestX=x;bestY=y;}
  }
  const longitude=((bestX+.5)/width-.5)*Math.PI*2,latitude=(.5-(bestY+.5)/height)*Math.PI;
  return new THREE.Vector3(Math.cos(latitude)*Math.cos(longitude),Math.sin(latitude),Math.cos(latitude)*Math.sin(longitude));
}
export function photographWeight(daylight:number,cloudiness:number) {
  return THREE.MathUtils.smoothstep(daylight,.15,.9)*(1-THREE.MathUtils.smoothstep(cloudiness,.30,.65));
}
/** Preserve both hemispheres and the level horizon; never pitch/roll a panorama.
 * A bounded vertical reprojection aligns the photographed sun with the game sun.
 * Fade to the existing sky before the required stretch reaches two times. */
export function setPhotographTransform(matrix:THREE.Matrix3,capturedSun:{x:number;y:number;z:number},sun:{x:number;y:number;z:number}) {
  const capturedHorizontal=Math.hypot(capturedSun.x,capturedSun.z),horizontal=Math.hypot(sun.x,sun.z);
  if(capturedSun.y<=0||sun.y<=0||capturedHorizontal<1e-6||horizontal<1e-6){matrix.identity();return 0;}
  const verticalScale=capturedSun.y*horizontal/(sun.y*capturedHorizontal);
  if(!Number.isFinite(verticalScale)||verticalScale<=0){matrix.identity();return 0;}
  const yaw=Math.atan2(capturedSun.z,capturedSun.x)-Math.atan2(sun.z,sun.x),c=Math.cos(yaw),s=Math.sin(yaw);
  matrix.set(c,0,-s,0,THREE.MathUtils.clamp(verticalScale,.5,2),0,s,0,c);
  return 1-THREE.MathUtils.smoothstep(Math.max(verticalScale,1/verticalScale),1.5,2);
}
export function createSkyPhotograph(quality:Quality='desktop') {
  let source=sources.get(quality);
  if(!source){const texture=fallback();source={refs:0,texture,ready:false,panorama:{value:texture},available:{value:0},capturedSun:new THREE.Vector3(0,1,0),loading:null,disposed:false,status:'idle',abort:new AbortController(),bindings:new Set()};sources.set(quality,source);}
  const shared=source;shared.refs++;
  const uniforms={seoulPhotoPanorama:shared.panorama,seoulPhotoReady:shared.available,seoulPhotoWeight:{value:0},seoulPhotoToCapture:{value:new THREE.Matrix3()}};
  const sun=new THREE.Vector3(0,1,0);
  let disposed=false,daylight=0,cloudiness=1;
  const refresh=()=>{
    if(disposed)return;
    uniforms.seoulPhotoWeight.value=shared.ready?photographWeight(daylight,cloudiness)*setPhotographTransform(uniforms.seoulPhotoToCapture.value,shared.capturedSun,sun):0;
  };
  shared.bindings.add(refresh);
  async function load() {
    if(disposed||shared.disposed)return;
    if(!shared.loading)shared.loading=(async()=>{
      shared.status='loading';
      const timeout=setTimeout(()=>shared.abort.abort(),20000);
      try{
        const [{HDRLoader},response]=await Promise.all([import('three/addons/loaders/HDRLoader.js'),fetch(`${import.meta.env?.BASE_URL??'/'}assets/sky/sky-${quality==='mobile'?'1k':'2k'}.hdr`,{signal:shared.abort.signal,priority:'low'})]);
        if(!response.ok)throw new Error(`Sky HTTP ${response.status}`);
        const bytes=await response.arrayBuffer();if(shared.disposed)return;
        const image=new HDRLoader().parse(bytes);
        if(!(image.data instanceof Uint16Array||image.data instanceof Float32Array)||!image.width||!image.height)throw new Error('Invalid HDR panorama');
        shared.capturedSun.copy(findPanoramaSun({data:image.data,width:image.width,height:image.height}));
        const texture=new THREE.DataTexture(image.data,image.width,image.height,THREE.RGBAFormat,image.type);
        texture.colorSpace=THREE.LinearSRGBColorSpace;texture.minFilter=texture.magFilter=THREE.LinearFilter;
        texture.wrapS=THREE.RepeatWrapping;texture.flipY=true;texture.generateMipmaps=false;texture.needsUpdate=true;
        shared.texture.dispose();shared.texture=texture;shared.panorama.value=texture;shared.ready=true;
        // Recompute every owner's saved state before making the source visible.
        // The map may be paused and skip update while the visible sky still draws.
        for(const refreshBinding of shared.bindings)refreshBinding();
        shared.available.value=1;shared.status='ready';
      }catch{if(!shared.disposed)shared.status='fallback';}finally{clearTimeout(timeout);}
    })();
    return shared.loading;
  }
  return {uniforms,load,
    update(nextDaylight:number,nextCloudiness:number,direction:{x:number;y:number;z:number}) {
      if(disposed)return;
      daylight=nextDaylight;cloudiness=nextCloudiness;
      sun.set(direction.x,direction.y,direction.z).normalize();refresh();
    },
    snapshot:()=>({status:shared.status,quality,resolution:shared.ready?shared.texture.image.width:0,extraPasses:0}),
    dispose(){if(disposed)return;disposed=true;shared.bindings.delete(refresh);if(--shared.refs===0){shared.disposed=true;shared.abort.abort();shared.texture.dispose();sources.delete(quality);}}
  };
}
export const PHOTOGRAPHIC_SKY_GLSL=/*glsl*/`
uniform sampler2D seoulPhotoPanorama;
uniform float seoulPhotoWeight;
uniform float seoulPhotoReady;
uniform mat3 seoulPhotoToCapture;
vec3 applySeoulSkyPhotograph(vec3 sky,vec3 ray){
  if(seoulPhotoReady<=0.||seoulPhotoWeight<=0.||ray.y<=0.)return sky;
  vec3 p=normalize(seoulPhotoToCapture*ray);
  if(p.y<=0.)return sky;
  vec2 uv=vec2(atan(p.z,p.x)*.159154943+.5,asin(clamp(p.y,-1.,1.))*.318309886+.5);
  vec3 photograph=texture2D(seoulPhotoPanorama,uv).rgb*.95;
  // Below the horizon stays atmospheric rather than exposing the panorama nadir.
  return mix(sky,photograph,seoulPhotoWeight*seoulPhotoReady*smoothstep(0.,.035,ray.y)*smoothstep(0.,.035,p.y));
}
`;
