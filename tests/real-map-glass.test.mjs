import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createBuildingLods,BUILDING_LOD_METRES} from '../src/native/ported/map/real-map/buildings.ts';
import {createReflectionEnvironment} from '../src/native/ported/map/real-map/reflection-environment.ts';
import {realMapData} from '../src/native/ported/map/real-map/data.ts';

function compile(material){
 const shader={uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
 material.onBeforeCompile(shader);
 return shader;
}
function expand(source){return source.replace(/#include <([\w]+)>/g,(_,name)=>{
 assert.ok(name in THREE.ShaderChunk,`Unknown chunk ${name}`);return expand(THREE.ShaderChunk[name]);
});}

test('glass composes in real Three standard shader at valid lighting stages',()=>{
 const models=createBuildingLods(realMapData.buildings.slice(0,2),'desktop');
 try{
  const shader=compile(models.root.children[0].levels[0].object.material);
  const fragment=expand(shader.fragmentShader),vertex=expand(shader.vertexShader);
  assert.match(vertex,/vBuildingWorld=\(modelMatrix\*vec4\(position,1.0\)\).xyz/);
  assert.equal((fragment.match(/float glassPane=/g)||[]).length,1);
  assert.ok(fragment.indexOf('float glassPane=')<fragment.indexOf('roughnessFactor=mix('));
  assert.ok(fragment.indexOf('float roughnessFactor =')<fragment.indexOf('roughnessFactor=mix('));
  assert.ok(fragment.indexOf('vec3 outgoingLight =')<fragment.indexOf('outgoingLight=mix('));
  assert.ok(fragment.indexOf('outgoingLight=mix(')<fragment.indexOf('gl_FragColor = vec4( outgoingLight'));
  assert.ok(fragment.indexOf('outgoingLight=mix(')<fragment.lastIndexOf('toneMapping( gl_FragColor.rgb )'));
  assert.match(fragment,/sampleSeoulEnvironment\(reflect\(-viewDir, worldNormal\),vBuildingWorld,roughness\)/);
  assert.match(fragment,/\.04\+\.96\*pow\(1.0-facing,5.0\)/);
  assert.match(fragment,/viewDelta\/max\(length\(viewDelta\),0.0001\)/);
  assert.match(fragment,/max\(facing,.22\)/);
  assert.doesNotMatch(fragment,/#include </);
 }finally{models.dispose();}
});

test('glass shares live finite environment uniforms without program churn',()=>{
 const env=createReflectionEnvironment();
 const models=createBuildingLods(realMapData.buildings.slice(0,2),'desktop',env);
 try{
  const material=models.root.children[0].levels[0].object.material;
  const key=material.customProgramCacheKey();const shader=compile(material);
  for(const [name,uniform] of Object.entries(env.uniforms))assert.equal(shader.uniforms[name],uniform);
  for(const time of [0,360,720,1080,1440]){
   env.update(time);
   assert.equal(material.customProgramCacheKey(),key);
   for(const uniform of Object.values(env.uniforms)){
    const value=uniform.value;
    if(typeof value==='number')assert.ok(Number.isFinite(value));
    else if(value?.toArray)assert.ok(value.toArray().every(Number.isFinite));
   }
   assert.ok(env.uniforms.uReflectionDaylight.value>=0&&env.uniforms.uReflectionDaylight.value<=1);
  }
  assert.equal(key,'osm-illustrative-glass-v2');
 }finally{models.dispose();}
});

test('glass remains opaque at original LOD and draw counts with truthful provenance',()=>{
 for(const quality of ['desktop','mobile']){
  const models=createBuildingLods(realMapData.buildings.slice(0,8),quality);
  try{
   assert.equal(models.root.children.length,models.chunks);
   assert.match(models.root.userData.glassProvenance,/approximation.*not reconstructed interiors or transparent holes/);
   assert.match(models.root.userData.colorProvenance,/unverified.*not measured/);
   for(const lod of models.root.children){
    assert.equal(lod.children.length,2);assert.equal(lod.levels[1].distance,BUILDING_LOD_METRES[quality]);
    const near=lod.levels[0].object,far=lod.levels[1].object;
    for(const mesh of [near,far]){
     assert.equal(mesh.material.transparent,false);assert.equal(mesh.material.depthWrite,true);
     assert.equal(mesh.material.opacity,1);assert.equal(mesh.material.side,THREE.DoubleSide);
     assert.equal(mesh.material.vertexColors,true);
    }
    assert.equal(near.castShadow,true);assert.equal(far.castShadow,false);
    assert.equal(near.receiveShadow,true);assert.equal(far.receiveShadow,false);
    assert.doesNotMatch(compile(far.material).fragmentShader,/glassPane/);
   }
  }finally{models.dispose();}
 }
});
