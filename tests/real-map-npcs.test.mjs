import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeMapLayout, isSpawnClear, sampleGround} from '../src/native/ported/map/layout.ts';
import {createMapNpcAdapter} from '../src/native/ported/npcs/runtime/map-adapter.ts';
import {PROFILES} from '../src/native/ported/npcs/src/profiles.ts';

function fixture(buildings=[],roads=[]){
  const base=makeMapLayout();
  const nodes=[{id:'a',x:-8,y:0,z:8,zone:'square'},{id:'b',x:-3,y:0,z:8,zone:'square'}];
  return {...base,realMap:{buildings,roads,water:[],bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100}},
    colliders:[{id:'broad-only',x:0,z:0,width:20,depth:20,height:10,minY:0}],
    navNodes:nodes,navEdges:[{a:'a',b:'b',width:4,kind:'walk',requiresTrafficCheck:false}],
    spawns:[{id:'test',x:-8,y:0,z:8,clearance:1.2,for:['human','dog','cat','rat']}]};
}
const building={id:'triangle',sourceId:'fixture',rings:[[[-10,-10],[10,-10],[10,10],[-10,-10]]],minY:0,height:10,surface:'stone'};

test('real-map NPC paths use polygon clearance instead of building bounding boxes',()=>{
  const l=fixture([building]);
  const a=createMapNpcAdapter(l);
  assert.equal(a.navigation.routes.length,1);
  assert.equal(a.navigation.spawnZones.length,1);
  assert.equal(a.navigation.canTraverse(l.navNodes[0],l.navNodes[1],PROFILES.human,{referenceY:0}),true);
  assert.deepEqual(a.road.laneCentres,[]);
  const blocked={...l,realMap:{...l.realMap,buildings:[{...building,rings:[[[-10,5],[0,5],[0,10],[-10,10],[-10,5]]]}]}};
  assert.equal(createMapNpcAdapter(blocked).navigation.routes.length,0);
});

test('real-map NPC adapter excludes traffic edges, crossings and motor roads',()=>{
  for(const edge of [{requiresTrafficCheck:true},{kind:'crossing'}]){
    const l=fixture();l.navEdges=l.navEdges.map(e=>({...e,...edge}));
    const a=createMapNpcAdapter(l);assert.equal(a.navigation.routes.length,0);assert.equal(a.excludedEdges[0].reason,'traffic');
  }
  const road={id:'motor',rings:[[[-20,0],[20,0],[20,20],[-20,20],[-20,0]]],walkable:false,underground:false,bridge:false};
  assert.equal(createMapNpcAdapter(fixture([],[road])).navigation.routes.length,0);
});

test('actual OSM graph retains usable NPC routes and clear nearby spawn zones',()=>{
  const layout=makeMapLayout({data:'osm'}),start=performance.now(),adapter=createMapNpcAdapter(layout);
  console.log(`OSM NPC adapter: ${layout.navEdges.length} edges, ${adapter.navigation.routes.length} routes, ${adapter.navigation.spawnZones.length} zones, ${(performance.now()-start).toFixed(0)}ms`);
  assert.ok(adapter.navigation.routes.length>0);
  assert.ok(adapter.navigation.spawnZones.length>0);
  assert.deepEqual(adapter.road.laneCentres,[]);
  for(const route of adapter.navigation.routes){
    const edge=layout.navEdges.find(e=>route.id===`map-edge:${e.a}->${e.b}`);
    assert.ok(edge&&!edge.requiresTrafficCheck&&edge.kind!=='crossing');
    assert.ok(layout.realMap.roads.some(r=>r.walkable&&!r.underground&&r.centerline&&edge.a.startsWith(`osm-path:${r.id}:`)));
    for(const point of route.points){
      assert.notEqual(sampleGround(layout,point.x,point.z,{feetY:point.y}).surface,'asphalt');
      for(const kind of route.kinds)assert.ok(isSpawnClear(layout,point,PROFILES[kind].radius,PROFILES[kind].height));
    }
  }
  for(const spawn of adapter.navigation.spawnZones){
    assert.ok(adapter.navigation.routes.some(r=>r.id===spawn.routeId));
    for(const kind of spawn.kinds)assert.ok(adapter.navigation.groundAt(spawn.center,PROFILES[kind],{referenceY:spawn.referenceY}));
  }
});
