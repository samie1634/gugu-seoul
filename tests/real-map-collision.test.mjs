import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapQueries } from '../src/native/ported/motion/locomotion/b2/map-queries.ts';
const rect = (x,z,w,d) => [[x,z],[x+w,z],[x+w,z+d],[x,z+d],[x,z]];
const building = (rings, minY=0, height=8) => ({id:'building:test',sourceId:'way/1',rings,minY,height,surface:'stone',heightStatus:'tagged'});
const world = (buildings=[],water=[],roads=[]) => createMapQueries({realMap:{buildings,water,roads},water:{y:0.02,bedY:-0.5}});
const probe = (x,z,y=8,r=.15) => ({at:{x,y,z},previousFeetY:y,footRadiusM:r,heightM:.5,maxRiseM:.05,maxDropM:.1});
test('concave footprint does not create broad-phase false walls',()=>{
 const q=world([building([[[0,0],[8,0],[8,2],[2,2],[2,8],[0,8],[0,0]]])]);
 assert.equal(q.sphereClear({x:5,y:3,z:5},.2),true);
 assert.equal(q.sweepSphere({x:4,y:3,z:4},{x:7,y:3,z:7},.2),null);
 assert.equal(q.sphereClear({x:1,y:3,z:5},.2),false);
});
test('courtyard holes remain clear, including roof support',()=>{
 const q=world([building([rect(0,0,10,10),rect(3,3,4,4)])]);
 assert.equal(q.sphereClear({x:5,y:4,z:5},.2),true);
 assert.equal(q.supportAt(probe(5,5)),null);
 assert.equal(q.supportAt(probe(2.9,5,8,.2)),null);
 assert.equal(q.supportAt(probe(2,5)).height,8);
});
test('roof landing and exact wall sweep',()=>{
 const q=world([building([rect(0,0,10,10)])]);
 const land=q.sweepSphere({x:5,y:10,z:5},{x:5,y:7,z:5},.2);
 assert.ok(Math.abs(land.fraction-.6)<1e-6); assert.ok(land.normal.y>.99);
 const hit=q.sweepSphere({x:-2,y:4,z:5},{x:2,y:4,z:5},.2);
 assert.ok(Math.abs(hit.fraction-.45)<1e-6); assert.ok(hit.normal.x<-.99);
 assert.equal(q.sphereClear({x:5,y:4,z:5},.1),false);
});
test('elevated building parts allow passage underneath and block their volume',()=>{
 const q=world([building([rect(0,0,10,10)],4,8)]);
 assert.equal(q.sweepSphere({x:-2,y:2,z:5},{x:12,y:2,z:5},.2),null);
 assert.equal(q.sphereClear({x:5,y:6,z:5},.2),false);
 assert.equal(q.supportAt(probe(5,5,0)).height,0);
});
test('water polygon boundary, hole, and bridge shield ground support',()=>{
 const water=[building([rect(0,0,10,10),rect(4,4,2,2)],-.5,.02)];
 const bridge={id:'bridge',rings:[rect(-1,1,12,1)],surface:'stone',walkable:true,bridge:true,underground:false};
 const q=world([],water,[bridge]);
 assert.equal(q.supportAt(probe(2,3,0)),null);
 assert.equal(q.supportAt(probe(-.1,3,0,.2)),null);
 assert.equal(q.supportAt(probe(-1,3,0)).height,0);
 assert.equal(q.supportAt(probe(5,5,0)).height,0);
 assert.equal(q.supportAt(probe(5,1.5,0)).id,'bridge');
 assert.equal(q.sweepSphere({x:2,y:.4,z:3},{x:2,y:.1,z:3},.15),null);
 assert.ok(q.sweepSphere({x:5,y:.4,z:1.5},{x:5,y:.1,z:1.5},.15));
});
test('stationary body probe catches fully enclosed solid volume',()=>{
 const q=world([building([rect(0,0,10,10)])]);
 const body={horizontalRadiusM:.2,heightM:.8,centreToSoleM:.4,footSupportRadiusM:.15,eyeFromSoleM:{x:0,y:.7,z:0}};
 assert.equal(q.sweepBody({x:5,y:4,z:5},{x:5,y:4,z:5},body).fraction,0);
});

test('water contact uses footprint holes and bridge shielding',()=>{
 const water=[building([rect(0,0,10,10),rect(4,4,2,2)],-.5,.02)];
 const bridge={id:'bridge',rings:[rect(-1,1,12,1)],surface:'stone',walkable:true,bridge:true,underground:false};
 const q=world([],water,[bridge]);
 assert.ok(q.waterAt({x:2,y:0,z:3}));
 assert.equal(q.waterAt({x:-1,y:0,z:3}),null);
 assert.equal(q.waterAt({x:5,y:0,z:5}),null);
 assert.equal(q.waterAt({x:5,y:0,z:1.5}),null);
});

import { makeMapLayout } from '../src/native/ported/map/layout.ts';
test('actual OSM experiment spawns have exact dry support and clearance',()=>{
 const layout=makeMapLayout({data:'osm'}),q=createMapQueries(layout);
 assert.ok(layout.realMap.buildings.length>1000);
 for(const p of layout.spawns){
  assert.equal(q.supportAt(probe(p.x,p.z,p.y,.2))?.height,0,p.id);
  assert.equal(q.sphereClear({x:p.x,y:p.y+.3,z:p.z},.2),true,p.id);
 }
});
