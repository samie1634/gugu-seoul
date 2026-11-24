import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMapNpcAdapter} from '../src/native/ported/npcs/runtime/map-adapter.ts';
import {makeRealMapLayout} from '../src/native/ported/map/real-map/layout.ts';
import {makeMapLayout,sampleGround,isSpawnClear} from '../src/native/ported/map/layout.ts';
import {NpcSystem} from '../src/native/ported/npcs/runtime/simulation.ts';
import {PROFILES} from '../src/native/ported/npcs/src/profiles.ts';
const layout=makeRealMapLayout({quality:'desktop'}),adapter=createMapNpcAdapter(layout,{bodyScale:1,feedingWalks:true,landmarkCrowds:true});
const human=PROFILES.human;
for(const quality of ['mobile','desktop'])for(const area of ['plaza','palace-approach','palace'])for(const d of (quality==='desktop'?[[0,1],[1,0],[0,-1],[-1,0]]:[[0,1],[1,0]]))test(`${quality} ${area} women escape a short crowd route by 10 m from approach ${d}`,()=>{
 const observer=area==='plaza'?{x:-336,y:0,z:108}:area==='palace-approach'?{x:-320,y:0,z:-385}:{x:-331,y:0,z:-482};const sys=new NpcSystem(adapter.navigation,{limits:{human:quality==='mobile'?24:32},bodyScale:1});
 try{
  for(let i=0;i<160;i++)sys.update(.05,{observer});
  const start=sys.snapshot().filter(s=>s.humanGender==='female'&&s.routeId.startsWith('landmark-crowd:')).sort((a,b)=>Math.hypot(a.x-observer.x,a.z-observer.z)-Math.hypot(b.x-observer.x,b.z-observer.z))[0];assert.ok(start);
  const stimulus={id:'pigeon',type:'presence',position:{x:start.x+d[0]*1.2,y:start.y+1.2,z:start.z+d[1]*1.2},radius:.17,halfHeight:.12,birdFlight:{species:'pigeon',airborne:true,velocity:{x:-d[0]*4,y:0,z:-d[1]*4}}};
  let previous=start,path=0,finished=false;const before=sys.stats.traversalQueries;
  for(let i=0;i<600;i++){
   sys.update(.05,{observer,stimuli:i===0?[stimulus]:[]});const cur=sys.snapshot().find(s=>s.id===start.id);assert.ok(cur,'leaving a route does not remove the person');
   path+=Math.hypot(cur.x-previous.x,cur.z-previous.z);const g=sampleGround(layout,cur.x,cur.z);
   assert.ok(g.walkable);assert.ok(!['water','asphalt'].includes(g.surface));assert.ok(isSpawnClear(layout,cur,human.radius,human.height));
   assert.ok(Math.hypot(cur.x-previous.x,cur.z-previous.z)<=3.2*.05+1e-8);previous=cur;
   assert.equal(cur.routeId,start.routeId);assert.equal(cur.humanOutfit,start.humanOutfit);
   if(cur.action!=='startle'){finished=true;break;}
  }
  assert.ok(finished);assert.ok(path>=10.5,`path ${path}`);assert.ok(Math.hypot(previous.x-start.x,previous.z-start.z)>=10,'not a long loop in a short corridor');
  for(let i=0;i<200;i++){
   sys.update(.05,{observer});const cur=sys.snapshot().find(s=>s.id===start.id);assert.ok(cur,'ordinary-route return must not despawn the person');
   assert.equal(cur.routeId,start.routeId);assert.equal(cur.humanOutfit,start.humanOutfit);assert.ok(isSpawnClear(layout,cur,human.radius,human.height));
  }
  assert.ok(sys.stats.traversalQueries-before<50000,'bounded navigation work');
 }finally{sys.dispose();}
});

test('escape-only terrain access leaves ordinary human/animal corridors unchanged',()=>{
 let outside;
 for(let dx=-8;dx<=8&&!outside;dx++)for(let dz=-8;dz<=8&&!outside;dz++){
  const p={x:-331+dx,z:108+dz};
  if(!adapter.navigation.groundAt(p,human,{referenceY:0})&&adapter.navigation.groundAt(p,human,{referenceY:0,escape:true}))outside=p;
 }
 assert.ok(outside);assert.equal(adapter.navigation.groundAt(outside,human,{referenceY:0}),undefined);
 assert.ok(adapter.navigation.groundAt(outside,human,{referenceY:0,escape:true}));
 for(const kind of ['dog','cat','rat'])assert.deepEqual(adapter.navigation.groundAt(outside,PROFILES[kind],{referenceY:0,escape:true}),adapter.navigation.groundAt(outside,PROFILES[kind],{referenceY:0}));
});

function safetyFixture({buildings=[],roads=[],water=[]}={}){
 const base=makeMapLayout();return{...base,realMap:{buildings,roads,water,bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100}},colliders:[],navNodes:[],navEdges:[],spawns:[]};
}
const ring=[[[-2,-2],[2,-2],[2,2],[-2,2],[-2,-2]]];
test('escape navigation never bypasses buildings, water, motor roads or their footprint edges',()=>{
 const fixtures=[
  safetyFixture({buildings:[{id:'wall',rings:ring,minY:0,height:10,surface:'stone'}]}),
  safetyFixture({roads:[{id:'road',rings:ring,walkable:false,underground:false,bridge:false}]}),
  safetyFixture({water:[{id:'water',rings:ring,minY:-2,height:0,surface:'water'}]}),
 ];
 for(const source of fixtures){
  const nav=createMapNpcAdapter(source).navigation,context={referenceY:0,escape:true};
  assert.equal(nav.groundAt({x:0,z:0},human,context),undefined);
  assert.equal(nav.groundAt({x:2.1,z:0},human,context),undefined,'the body footprint must not overlap the unsafe surface');
  assert.equal(nav.canTraverse({x:-4,y:0,z:0},{x:4,y:0,z:0},human,context),false);
  assert.ok(nav.groundAt({x:4,z:0},human,context));
 }
});

test('an unobstructed plaza escape rejoins its original waypoint and restores ordinary corridor checks',()=>{
 const route=adapter.navigation.routes.find(r=>r.id==='landmark-crowd:plaza:3'),zone=adapter.navigation.spawnZones.find(z=>z.routeId===route.id);
 const nav={...adapter.navigation,routes:[route],spawnZones:[zone]},observer={x:-336,y:0,z:108};
 const sys=new NpcSystem(nav,{maxTotal:1,limits:{human:1,dog:0,cat:0,rat:0}});
 try{
  for(let i=0;i<40;i++)sys.update(.05,{observer});const start=sys.snapshot()[0];assert.ok(start);
  const stimulus={id:'pigeon',type:'presence',position:{x:start.x,y:start.y+1.2,z:start.z+1.2},radius:.17,halfHeight:.12,birdFlight:{species:'pigeon',airborne:true,velocity:{x:0,y:0,z:-4}}};
  let escaped=false,rejoined=false;
  for(let i=0;i<800;i++){
   sys.update(.05,{observer,stimuli:i===0?[stimulus]:[]});const cur=sys.snapshot()[0];assert.equal(cur.id,start.id);
   if(cur.action!=='startle')escaped=true;
   // Inspect the private state machine only here; no debugging metadata is exposed by the game.
   if(escaped&&!sys.agents[0].escapeNavigation){
    assert.ok(route.points.some(p=>Math.hypot(p.x-cur.x,p.z-cur.z)<.1));rejoined=true;break;
   }
  }
  assert.ok(rejoined,'reaching the original waypoint clears the temporary escape mode');
  for(let i=0;i<20;i++){sys.update(.05,{observer});const cur=sys.snapshot()[0];assert.ok(nav.groundAt(cur,human,{referenceY:cur.y}));assert.equal(sys.agents[0].escapeNavigation,false);}
 }finally{sys.dispose();}
});

test('a newly blocked return never crosses the blocker or clears escape navigation outside its route',()=>{
 let blocked=false;const route={id:'walk',kinds:['human'],points:[{x:-.1,z:0},{x:.1,z:0}],loop:false};
 const nav={routes:[route],spawnZones:[{id:'spawn',routeId:'walk',kinds:['human'],center:{x:0,z:0},radius:1,capacity:1}],groundAt:()=>({height:0,walkable:true,surface:'stone'}),canTraverse:(from,to)=>!blocked||to.z< -5};
 const observer={x:0,y:0,z:0},sys=new NpcSystem(nav,{maxTotal:1,limits:{human:1,dog:0,cat:0,rat:0},spawnMinDistance:0,spawnMaxDistance:60,despawnDistance:80});
 try{
  sys.update(.05,{observer});const start=sys.snapshot()[0];
  const stimulus={id:'pigeon',type:'presence',position:{x:start.x,y:1.2,z:start.z+1.2},radius:.17,halfHeight:.12,birdFlight:{species:'pigeon',airborne:true,velocity:{x:0,y:0,z:-4}}};
  for(let i=0;i<400;i++){sys.update(.05,{observer,stimuli:i===0?[stimulus]:[]});if(sys.snapshot()[0].action!=='startle')break;}
  assert.ok(sys.snapshot()[0].z< -5);blocked=true;const queries=sys.stats.traversalQueries;
  for(let i=0;i<400;i++){sys.update(.05,{observer});assert.equal(sys.snapshot()[0].id,start.id);assert.ok(sys.snapshot()[0].z< -5);assert.equal(sys.agents[0].escapeNavigation,true);}
  assert.ok(sys.stats.traversalQueries-queries<=400*7+400,'return work stays bounded by the ordinary steering candidates');
 }finally{sys.dispose();}
});
