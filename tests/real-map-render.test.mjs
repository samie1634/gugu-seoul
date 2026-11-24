import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMapCandidate} from '../src/native/ported/map/candidate.ts';
import {createNativeScene} from '../src/native/scene.ts';
import {polygonGeometry} from '../src/native/ported/map/real-map/geometry.ts';
import {minimapPoint} from '../src/native/ported/map/real-map/minimap.ts';
test('rendered polygon caps preserve courtyard area and metric x,z extent',()=>{
 const rings=[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[3,7],[7,7],[7,3],[3,3]]];
 const g=polygonGeometry(rings,12,2),p=g.getAttribute('position');let area=0;
 for(let i=0;i<p.count;i+=3)if([i,i+1,i+2].every(j=>Math.abs(p.getY(j)-12)<1e-6))area+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getZ(i+1)-p.getZ(i))*(p.getX(i+2)-p.getX(i)))/2;
 assert.equal(area,84);g.computeBoundingBox();assert.deepEqual(g.boundingBox.min.toArray(),[0,2,0]);assert.deepEqual(g.boundingBox.max.toArray(),[10,12,10]);g.dispose();
});
test('real candidate preserves unknown-height status and bounds, has no old rectangular city',()=>{
 const map=createMapCandidate({data:'osm'});try{
 assert.equal(map.layout.buildings.length,0);assert.equal(map.layout.roofs.length,0);assert.equal(map.layout.realMap.buildings.length,1540);
 const treeBudget=map.root.userData.renderBudget.trees;const gateBudget=map.root.userData.renderBudget.gwanghwamun;
 assert.ok(map.stats.meshes-treeBudget.drawCalls-gateBudget.drawCalls<260);assert.ok(map.stats.triangles-treeBudget.nearTriangles-gateBudget.triangles<80000);
 assert.ok(treeBudget.drawCalls<=18);assert.ok(treeBudget.nearTriangles<=21000);
 assert.ok(map.root.userData.renderBudget.farBuildingTriangles<map.root.userData.renderBudget.nearBuildingTriangles);
 assert.ok(map.layout.realMap.buildings.filter(b=>b.heightStatus==='unconfirmed_footprint_only').every(b=>b.sourceHeight===null&&b.height===.12&&!b.measured));
 assert.equal(map.layout.realMap.heightCounts.estimated_not_measured,59);
 assert.equal(map.layout.realMap.buildings.find(b=>b.heightStatus==='published_maximum_applied_to_top_part').height,133.5);
 assert.deepEqual(minimapPoint(map.layout.realMap,-574.4,-555.1),[4,4]);
 map.root.traverse(o=>{if(o instanceof THREE.Mesh)for(const v of o.geometry.attributes.position.array)assert.ok(Number.isFinite(v));});
 }finally{map.dispose();}assert.equal(map.root.children.length,0);
});
test('real scene starts on reviewed plaza, frames commit, home remains compatible',()=>{
 const n=createNativeScene(new THREE.Scene(),'pigeon',{mapData:'osm'});try{
 assert.deepEqual(n.snapshot().sole,{x:-336,y:0,z:108});
 const input={forward:0,turn:0,roll:0,accelerate:false,flapPressed:false,flapHeld:false,descend:false};
 for(let i=0;i<8;i++){const p=n.prepare(input,.016,{near:.05,verticalFovDegrees:59,aspect:16/9},'third',10,false);assert.equal(p.kind,'ready',p.reason);p.commit();}
 assert.equal(n.snapshot().blockedFrames,0);assert.equal(n.home(),true);assert.deepEqual(n.snapshot().sole,{x:-336,y:0,z:108});
 }finally{n.dispose();}
});
