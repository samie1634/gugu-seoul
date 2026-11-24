import{test}from'node:test';import assert from'node:assert/strict';import*as THREE from'three';
import{createBuildingLods,buildingPalette,BUILDING_LOD_METRES}from'../src/native/ported/map/real-map/buildings.ts';
import{realMapData}from'../src/native/ported/map/real-map/data.ts';
import{buildingVisuals}from'../src/native/ported/map/real-map/visual-data.ts';
test('far LOD cuts geometry while height and hole topology remain intact',()=>{
 const models=createBuildingLods(realMapData.buildings,'desktop');try{
 assert.ok(models.chunks<110);assert.ok(models.farTriangles<models.nearTriangles*.6);
 for(const b of realMapData.buildings){const v=buildingVisuals[b.id];assert.equal(v.rings.length,b.rings.length);assert.ok(b.height>b.minY);}
 const lod=models.root.children.find(c=>c.isLOD);assert.equal(lod.levels[1].distance,BUILDING_LOD_METRES.desktop);
 models.root.updateMatrixWorld(true);const camera=new THREE.PerspectiveCamera();camera.position.copy(lod.position);camera.position.y=2;camera.updateMatrixWorld(true);lod.update(camera);
 assert.equal(lod.levels[0].object.visible,true);assert.equal(lod.levels[1].object.visible,false);
 camera.position.x+=600;camera.updateMatrixWorld(true);lod.update(camera);assert.equal(lod.levels[0].object.visible,false);assert.equal(lod.levels[1].object.visible,true);
 }finally{models.dispose();}
});
test('colour categories are deterministic and never advertised as survey colours',()=>{
 const tagged=realMapData.buildings.find(b=>buildingVisuals[b.id].wallColor==='#92adaf');assert.ok(tagged);assert.equal(buildingPalette(tagged).wall.getHexString(),'92adaf');
 const untagged=realMapData.buildings.find(b=>buildingVisuals[b.id].colorStatus==='illustrative_palette_not_measured');assert.equal(buildingPalette(untagged).status,'illustrative_palette_not_measured');assert.equal(buildingPalette(untagged).wall.getHexString(),buildingPalette({...untagged}).wall.getHexString());
 const unique=new Set(realMapData.buildings.map(b=>buildingPalette(b).wall.getHexString()));assert.ok(unique.size>=8);
});
test('near façades are shader colour only, not thousands of extra window meshes',()=>{
 const models=createBuildingLods(realMapData.buildings,'mobile');try{
 assert.equal(models.root.children.filter(o=>o.isLOD).length,models.chunks);
 const lod=models.root.children[0];assert.equal(lod.levels[1].distance,170);
 const shader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};lod.levels[0].object.material.onBeforeCompile(shader);
 assert.match(shader.fragmentShader,/footprint=fwidth/);assert.match(shader.fragmentShader,/diffuseColor.rgb=mix/);
 assert.equal(lod.levels[0].object.castShadow,true);assert.equal(lod.levels[1].object.castShadow,false);
 assert.equal(models.root.children.reduce((n,l)=>n+l.children.length,0),models.chunks*2);
 }finally{models.dispose();}
});
