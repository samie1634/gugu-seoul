import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { polygonContains, polygonDistance } from './geometry.ts';
import type { Rings } from './geometry.ts';
export const WATER_MIRROR_BUDGET=Object.freeze({width:256,height:128,interval:1/12,maxDistance:110,maxHeight:80});
export function reflectionEligible(camera:THREE.Camera,areas:readonly {rings:Rings}[],waterY:number):boolean{
  const position=new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const above=position.y-waterY;if(above<.08||above>WATER_MIRROR_BUDGET.maxHeight)return false;
  return areas.some(a=>polygonContains(a.rings,position.x,position.z)||polygonDistance(a.rings,position.x,position.z)<WATER_MIRROR_BUDGET.maxDistance);
}
/** Wrap one shared planar capture; never one pass per water polygon or building. */
export function limitWaterReflection(reflector:Reflector,root:THREE.Group,areas:readonly {rings:Rings}[],waterY:number,getTime:()=>number,getEnvironmentRevision:()=>number=()=>0){
  const renderMirror=reflector.onBeforeRender,uniforms=(reflector.material as THREE.ShaderMaterial).uniforms;
  let lastCapture=-Infinity,lastSeen=-Infinity,hasCapture=false,capturing=false,captures=0,failed=false,lastEnvironmentRevision=NaN;
  const savedPosition=new THREE.Vector3(),savedQuaternion=new THREE.Quaternion(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion();
  reflector.onBeforeRender=(renderer,scene,camera,geometry,material,group)=>{
    root.userData.activeReflectionPasses=0;
    if(failed||capturing||!renderer.extensions.has('EXT_color_buffer_float')||!reflectionEligible(camera,areas,waterY)){uniforms.uMirrorActive.value=0;return;}
    const time=getTime();if(!Number.isFinite(time)||time<0){uniforms.uMirrorActive.value=0;return;}
    if(time<lastSeen){lastCapture=-Infinity;hasCapture=false;}lastSeen=time;
    const environmentRevision=getEnvironmentRevision();
    // A panorama can finish while simulation time is paused. Never retain a
    // bright/old planar capture over the newly ready analytical environment.
    // Invalidate it, then retain the normal capture interval on resume.
    if(environmentRevision!==lastEnvironmentRevision){hasCapture=false;lastEnvironmentRevision=environmentRevision;}
    camera.getWorldPosition(position);camera.getWorldQuaternion(quaternion);
    if(time-lastCapture>=WATER_MIRROR_BUDGET.interval-1e-9){
      const target=renderer.getRenderTarget(),xr=renderer.xr.enabled,shadow=renderer.shadowMap.autoUpdate,visible=reflector.visible;
      const decor=root.children.filter(o=>o!==reflector).map(o=>({o,visible:o.visible}));
      try{
        capturing=true;decor.forEach(d=>{d.o.visible=false;});
        renderMirror.call(reflector,renderer,scene,camera,geometry,material,group);
        lastCapture=time;hasCapture=true;savedPosition.copy(position);savedQuaternion.copy(quaternion);captures++;
        root.userData.activeReflectionPasses=1;root.userData.reflectionCaptures=captures;
      }catch{
        failed=true;hasCapture=false;uniforms.uMirrorActive.value=0;root.userData.reflectionFailure='capture-disabled-after-render-error';
      }finally{
        capturing=false;reflector.visible=visible;decor.forEach(d=>{d.o.visible=d.visible;});
        renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadow;renderer.setRenderTarget(target);
        const viewport=(camera as THREE.Camera&{viewport?:THREE.Vector4}).viewport;if(viewport)renderer.state.viewport(viewport);
        scene.traverse(o=>{if(o instanceof THREE.LOD&&o.autoUpdate)o.update(camera);});
      }
    }
    const distance=position.distanceTo(savedPosition),angle=quaternion.angleTo(savedQuaternion);
    const freshness=Math.max(0,1-Math.max(distance/5,angle/.22));
    const heightFade=Math.min(1,Math.max(0,(position.y-waterY-.08)/.25));
    uniforms.uMirrorActive.value=hasCapture?freshness*heightFade:0;
  };
}
