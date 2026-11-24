import{test}from'node:test';import assert from'node:assert/strict';
import{createMapCandidate}from'../src/native/ported/map/candidate.ts';
import{makeMapLayout,sampleGround,sampleWater}from'../src/native/ported/map/layout.ts';
import{createMapQueries}from'../src/native/ported/motion/locomotion/b2/map-queries.ts';
import{CHEONGGYE_LEVELS as L,CHEONGGYE_BRIDGES,channelPoint,channelPools,channelSolids,channelExcavations,channelTerraces,channelWaterAreas,CHEONGGYE_AUDIO_ANCHORS}from'../src/native/ported/map/real-map/cheonggye-channel.ts';
import{createCheonggyeLandmarks}from'../src/native/ported/map/real-map/cheonggye-landmarks.ts';
import{polygonContains,diskInside}from'../src/native/ported/map/real-map/geometry.ts';
const layout=makeMapLayout({data:'osm'}),world=createMapQueries(layout);
const probe=(p,previous=p.y,r=.08,drop=.05)=>world.supportAt({at:p,previousFeetY:previous,footRadiusM:r,heightM:.3,maxRiseM:.05,maxDropM:drop});
test('source water stays intact and normal illustrative depth is separate from documented fall',()=>{
 assert.equal(L.upperWater-L.water,4);assert.ok(Math.abs(L.water-L.bed-.3)<1e-8);
 const p=channelPoint(6,0),g=sampleGround(layout,p.x,p.z),w=sampleWater(layout,p.x,g.y,p.z);assert.equal(g.y,-4.3);assert.equal(w.y,-4);assert.ok(Math.abs(w.depth-.3)<1e-8);
 assert.equal(sampleWater(layout,p.x,0,p.z),null);assert.equal(sampleWater(layout,p.x,-6,p.z),null);
 assert.ok(channelWaterAreas.some(a=>polygonContains(a.rings,p.x,p.z)));
 assert.deepEqual(layout.realMap.origin,[126.9805,37.573]);
});
test('headwater pools, main fall and sound anchor share a single coordinate plan',()=>{
 for(const pool of channelPools){const ps=pool.rings[0],x=ps.slice(0,4).reduce((n,p)=>n+p[0],0)/4,z=ps.slice(0,4).reduce((n,p)=>n+p[1],0)/4,w=sampleWater(layout,x,pool.bed,z);assert.equal(w?.id,pool.id);assert.equal(w.y,pool.y);assert.ok(w.depth>.1&&w.depth<.16);}
 const p=CHEONGGYE_AUDIO_ANCHORS.fountain;assert.ok(polygonContains(channelPools[0].rings,p.x,p.z));
 assert.ok(channelSolids.some(s=>s.id.includes('entry-step')));assert.equal(channelSolids.filter(s=>s.id.includes('palseokdam')).length,8);
});
test('lower promenade and all stair treads have matching support instead of invisible grade-zero ground',()=>{
 for(const step of channelSolids.filter(s=>s.id.includes('entry-step'))){const a=step.rings[0].slice(0,4),p={x:a.reduce((n,v)=>n+v[0],0)/4,y:step.height,z:a.reduce((n,v)=>n+v[1],0)/4};assert.equal(probe(p)?.height,step.height,step.id);assert.equal(world.sphereClear({...p,y:p.y+.16},.12),true,step.id);}
 let checked=0;for(const terrace of channelTerraces){const ring=terrace.rings[0];for(const [x,z]of ring){for(const dx of[-1,1])if(diskInside(terrace.rings,x+dx,z,.1)&&!channelSolids.some(s=>polygonContains(s.rings,x+dx,z))){assert.equal(probe({x:x+dx,y:L.promenade,z})?.height,L.promenade);checked++;}}}
 assert.ok(checked>0);
});
test('bridge has a solid deck and real open water passage below, including underside collision',()=>{
 for(const b of CHEONGGYE_BRIDGES){assert.equal(probe({x:b.x,y:0,z:b.z})?.height,0);assert.equal(world.sphereClear({x:b.x,y:-2,z:b.z},.1),true);const wet=Array.from({length:16},(_,j)=>({x:b.x,y:-4.2,z:b.z-7+j})).find(p=>world.waterAt(p));assert.ok(wet);assert.equal(world.waterAt(wet).y,-4);const hit=world.sweepSphere({x:b.x,y:-2,z:b.z},{x:b.x,y:.5,z:b.z},.1);assert.ok(hit);assert.match(hit.colliderId,/deck/);}
 assert.equal(world.waterAt({x:CHEONGGYE_BRIDGES[0].x,y:0,z:CHEONGGYE_BRIDGES[0].z}),null);
});
test('Spring silhouette has local collision, without blocking surrounding plaza',()=>{
 const p=channelPoint(-72,-1.5,10);assert.equal(world.sphereClear(p,.1),false);assert.equal(world.sphereClear({...p,x:p.x+6},.1),true);assert.equal(world.sphereClear({...p,y:20.5},.1),true);
});
test('render has original procedural landmarks, finite animation and bounded draw count',()=>{
 const a=createCheonggyeLandmarks();const root=a.root;try{for(const name of['cheonggye:main-waterfall','cheonggye:upper-cascade','cheonggye:candle-fountain','cheonggye:spring-sculpture'])assert.ok(root.getObjectByName(name),name);let meshes=0;root.traverse(o=>{if(o.isMesh)meshes++;});assert.ok(meshes<=10);for(const t of[0,1,900,1e9,2]){a.update(t,.2);root.updateMatrixWorld(true);root.traverse(o=>{assert.ok(o.matrixWorld.elements.every(Number.isFinite));if(o.isInstancedMesh)assert.ok(o.instanceMatrix.array.every(Number.isFinite));});}}finally{a.dispose();a.dispose();assert.equal(root.children.length,0);}
});
test('complete map initialization and resource cleanup retain existing city features',()=>{
 const map=createMapCandidate({data:'osm',quality:'desktop'});try{assert.equal(map.layout.realMap.buildings.length,1540);assert.ok(map.root.getObjectByName('cheonggye:headwater-landmarks'));assert.ok(map.root.getObjectByName('cheonggyecheon:water'));map.update(90,.016);assert.ok(map.stats.triangles-map.root.userData.renderBudget.trees.nearTriangles-map.root.userData.renderBudget.gwanghwamun.triangles<80000);assert.ok(channelExcavations.length>0);}finally{map.dispose();map.dispose();assert.equal(map.root.children.length,0);}
});
