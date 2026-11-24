import{test}from'node:test';import assert from'node:assert/strict';import*as THREE from'three';import{Reflector}from'three/addons/objects/Reflector.js';
import{createPolygonWater}from'../src/native/ported/map/real-map/water.ts';
import{createReflectionEnvironment}from'../src/native/ported/map/real-map/reflection-environment.ts';
import{limitWaterReflection,reflectionEligible,WATER_MIRROR_BUDGET}from'../src/native/ported/map/real-map/water-reflection.ts';
const areas=[{rings:[[[0,0],[20,0],[20,20],[0,20],[0,0]]]}];
function cameraAt(x=10,y=2,z=10){const c=new THREE.PerspectiveCamera(59,2,.1,2400);c.position.set(x,y,z);c.updateMatrixWorld(true);return c;}
test('one bounded desktop target replaces the same polygon mesh; mobile stays pass-free',()=>{
 const environment=createReflectionEnvironment(),desktop=createPolygonWater('desktop',environment),mobile=createPolygonWater('mobile');try{
 const water=desktop.root.getObjectByName('cheonggyecheon:water'),fallback=mobile.root.getObjectByName('cheonggyecheon:water');
 assert.equal(desktop.root.children.length,5);assert.equal(mobile.root.children.length,5);assert.equal(water.isReflector,true);assert.equal(fallback.isReflector,undefined);
 assert.equal(water.getRenderTarget().width,256);assert.equal(water.getRenderTarget().height,128);assert.equal(water.getRenderTarget().samples,0);
 assert.equal(water.material.uniforms.uReflectionDaylight,environment.uniforms.uReflectionDaylight);
 assert.match(water.material.fragmentShader,/sampleSeoulEnvironment\(ray/);assert.match(water.material.fragmentShader,/coverage \* uMirrorActive/);
 assert.equal(mobile.root.userData.reflectionPasses,0);assert.equal(desktop.root.userData.reflectionPasses,1);
 desktop.update(900);assert.equal(water.material.uniforms.uReflectionDaylight.value,0);assert.ok(water.material.uniforms.uPhase.value.every(Number.isFinite));
 desktop.root.updateMatrixWorld(true);const p=water.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(water.matrixWorld);assert.ok(Math.abs(v.y+4)<1e-5);}
 }finally{desktop.dispose();mobile.dispose();}
});
test('camera eligibility excludes far, submerged, near-plane and high overhead views',()=>{
 assert.equal(reflectionEligible(cameraAt(),areas,.02),true);assert.equal(reflectionEligible(cameraAt(500,2,0),areas,.02),false);assert.equal(reflectionEligible(cameraAt(10,-1,10),areas,.02),false);assert.equal(reflectionEligible(cameraAt(10,.07,10),areas,.02),false);assert.equal(reflectionEligible(cameraAt(10,100,10),areas,.02),false);
});
test('capture rate is bounded, decor hidden only during capture, and stale positions use fallback',()=>{
 const mirror=new Reflector(new THREE.PlaneGeometry(20,20)),root=new THREE.Group(),decor=new THREE.Group(),scene=new THREE.Scene(),camera=cameraAt();root.add(mirror,decor);scene.add(root);
 mirror.material.uniforms.uMirrorActive={value:0};let time=0,calls=0;
 const renderer={extensions:{has:()=>true},getRenderTarget:()=>null,setRenderTarget(){},xr:{enabled:true},shadowMap:{autoUpdate:true},state:{viewport(){}}};
 mirror.onBeforeRender=()=>{calls++;assert.equal(decor.visible,false);};limitWaterReflection(mirror,root,areas,.02,()=>time);
 const draw=()=>mirror.onBeforeRender(renderer,scene,camera,mirror.geometry,mirror.material,null);
 for(let i=0;i<=120;i++){time=i/120;draw();}assert.ok(calls<=13);assert.equal(calls,13);assert.equal(decor.visible,true);assert.equal(root.userData.reflectionCaptures,13);
 time+=.001;camera.position.x+=8;camera.updateMatrixWorld(true);draw();assert.equal(mirror.material.uniforms.uMirrorActive.value,0);
 renderer.extensions.has=()=>false;time+=1;draw();assert.equal(calls,13);assert.equal(mirror.material.uniforms.uMirrorActive.value,0);
 mirror.geometry.dispose();mirror.dispose();assert.equal(WATER_MIRROR_BUDGET.interval,1/12);
});
test('failed nested render restores renderer and visibility instead of poisoning the main scene',()=>{
 const mirror=new Reflector(new THREE.PlaneGeometry()),root=new THREE.Group(),decor=new THREE.Group(),scene=new THREE.Scene(),camera=cameraAt();root.add(mirror,decor);scene.add(root);mirror.material.uniforms.uMirrorActive={value:0};
 let restored;const original={id:1};const renderer={extensions:{has:()=>true},getRenderTarget:()=>original,setRenderTarget:t=>{restored=t;},xr:{enabled:true},shadowMap:{autoUpdate:true},state:{viewport(){}}};
 mirror.onBeforeRender=()=>{mirror.visible=false;renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;throw new Error('GPU unavailable');};limitWaterReflection(mirror,root,areas,.02,()=>0);
 assert.doesNotThrow(()=>mirror.onBeforeRender(renderer,scene,camera,mirror.geometry,mirror.material,null));assert.equal(root.userData.reflectionFailure,'capture-disabled-after-render-error');assert.equal(mirror.material.uniforms.uMirrorActive.value,0);assert.equal(mirror.visible,true);assert.equal(decor.visible,true);assert.equal(renderer.xr.enabled,true);assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(restored,original);mirror.geometry.dispose();mirror.dispose();
});

test('sky reflection survives transparent compositing and does not receive local shadows twice',()=>{
 for(const quality of['desktop','mobile']){
  const water=createPolygonWater(quality);try{
   const shader=water.root.getObjectByName('cheonggyecheon:water').material.fragmentShader;
   assert.match(shader,/fresnel \/ waterOpacity/);assert.match(shader,/vec4\(colour, waterOpacity\)/);
   assert.doesNotMatch(shader,/reflected \*= mix\(0.33|mirror \* mix\(0.78/);
   assert.match(shader,/uMirrorActive > 0.001/);
   for(const incidence of[0,.1,.25,.5,.75,1]){
    const fresnel=.08+.92*(1-incidence)**4,alpha=.52+.48*fresnel,weight=fresnel/alpha;
    assert.ok(weight>=0&&weight<=1);
    assert.ok(Math.abs(alpha*weight-fresnel)<1e-12);
   }
  }finally{water.dispose();}
 }
});
