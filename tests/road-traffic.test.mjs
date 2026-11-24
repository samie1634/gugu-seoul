import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTrafficNetwork, createRoadTraffic, trafficOverlaps } from '../src/native/road-traffic.ts';
import { makeRealMapLayout } from '../src/native/ported/map/real-map/layout.ts';
import { polygonContains, diskIntersects, footprintIndex } from '../src/native/ported/map/real-map/geometry.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { nativeNear } from '../src/native/body-profile.ts';

const rect = (x1,z1,x2,z2) => [[[x1,z1],[x2,z1],[x2,z2],[x1,z2],[x1,z1]]];
function road(id, line, extra={}) {
  return { id, sourceId:id, centerline:line, rings:rect(Math.min(...line.map(p=>p[0]))-6,Math.min(...line.map(p=>p[1]))-6,Math.max(...line.map(p=>p[0]))+6,Math.max(...line.map(p=>p[1]))+6),
    width:12, walkable:false, underground:false, bridge:false, surface:'asphalt', highway:'residential', ...extra };
}
const data = (roads, extra={}) => ({ roads, buildings:[], water:[], bounds:{minX:-200,maxX:200,minZ:-200,maxZ:200}, ...extra });
const idle={forward:0,turn:0,flapPressed:false,flapHeld:false,descend:false};

test('traffic uses motor roads and source directions; excludes paths, tunnels, negative layers and restricted access',()=>{
  const roads=[road('forward',[[-80,0],[0,0]]),road('reverse',[[-80,30],[0,30]]),road('foot',[[-80,60],[0,60]],{highway:'footway',walkable:true}),road('tunnel',[[-80,90],[0,90]],{underground:true}),road('private',[[-80,120],[0,120]]),road('lower',[[-80,150],[0,150]])];
  const lanes=buildTrafficNetwork(data(roads),{forward:{oneway:'yes'},reverse:{oneway:'-1'},private:{access:'private'},lower:{layer:'-1'}});
  assert.deepEqual(lanes.map(l=>l.roadId),['forward','reverse']);
  assert.ok(lanes[0].points[0].x<lanes[0].points.at(-1).x);
  assert.ok(lanes[1].points[0].x>lanes[1].points.at(-1).x);
});

test('explicit endpoint joins turn smoothly, do not join merely crossing lines, and retain layer topology',()=>{
  const roads=[road('in',[[-80,0],[0,0]]),road('out',[[0,0],[0,80]]),road('cross',[[-40,-40],[-40,40]])];
  const rules={in:{oneway:'yes'},out:{oneway:'yes'},cross:{oneway:'yes'}};
  const lanes=buildTrafficNetwork(data(roads),rules), incoming=lanes.find(l=>l.roadId==='in');
  assert.equal(incoming.next.length,1);
  assert.equal(lanes[incoming.next[0].lane].roadId,'out');
  const curve=incoming.next[0].points;
  assert.ok(curve.length>8);
  for(let i=1;i<curve.length;i++)assert.ok(Math.abs(Math.atan2(Math.sin(curve[i].heading-curve[i-1].heading),Math.cos(curve[i].heading-curve[i-1].heading)))<.45);
  assert.equal(buildTrafficNetwork(data(roads),{...rules,out:{oneway:'yes',layer:'2'}}).find(l=>l.roadId==='in').next.length,0);
});

test('shared interior source vertices become junctions without connecting arbitrary crossings',()=>{
  const roads=[road('long',[[-80,0],[0,0],[80,0]]),road('branch',[[0,0],[0,80]]),road('cross',[[-40,-40],[-40,40]])];
  const lanes=buildTrafficNetwork(data(roads),{long:{oneway:'yes'},branch:{oneway:'yes'},cross:{oneway:'yes'}});
  const incoming=lanes.find(l=>l.roadId==='long'&&l.end?.x===0);
  assert.ok(incoming.next.some(next=>lanes[next.lane].roadId==='branch'));
  assert.ok(incoming.next.some(next=>lanes[next.lane].roadId==='long'));
  assert.ok(!incoming.next.some(next=>lanes[next.lane].roadId==='cross'));
});

test('water requires an actual bridge footprint and buildings remove obstructed route portions',()=>{
  const water=[{rings:rect(-10,-20,10,20)}], base=road('across',[[-80,0],[80,0]]);
  const dry=buildTrafficNetwork(data([base],{water}),{});
  assert.ok(dry.length>0);assert.ok(dry.every(l=>l.points.every(p=>!polygonContains(water[0].rings,p.x,p.z))));
  const bridge=buildTrafficNetwork(data([{...base,bridge:true}],{water}),{});
  assert.ok(bridge.some(l=>l.points.some(p=>Math.abs(p.x)<1)));
  const building={rings:rect(-7,-7,7,7),minY:0,height:15};
  const blocked=buildTrafficNetwork(data([base],{buildings:[building]}),{});
  assert.ok(blocked.every(l=>l.points.every(p=>!diskIntersects(building.rings,p.x,p.z,2.45))));
});

test('rendered cars remain separated on actual OSM roads for ten minutes and never teleport while visible',t=>{
  const layout=makeRealMapLayout({quality:'mobile'}), parent=new THREE.Scene(), traffic=createRoadTraffic(parent,layout);t.after(()=>traffic.dispose());
  const origin=layout.spawns[0], first=traffic.snapshot();
  assert.equal(first.count,14);assert.ok(first.laneCount>100);
  const nearby=first.states.filter(s=>Math.hypot(s.x-origin.x,s.z-origin.z)<100);
  assert.ok(nearby.length>=2);
  const nearest=Math.min(...first.states.map(s=>Math.hypot(s.x-origin.x,s.z-origin.z)));
  assert.ok(nearest<65);
  let previous=first.states, movingAt180=0, movingAt300=0, movingAt600=0, maxVisibleJump=0;
  const roadsAt=footprintIndex(layout.realMap.roads), buildingsAt=footprintIndex(layout.realMap.buildings);
  for(let frame=1;frame<=12000;frame++){
    traffic.update(.05,origin);const states=traffic.snapshot().states;
    for(let i=0;i<states.length;i++){
      const a=states[i],b=previous[i],travel=Math.hypot(a.x-b.x,a.z-b.z);
      assert.equal(a.y,0);
      if(a.visible||b.visible){assert.ok(travel<.55,`visible teleport ${travel}`);maxVisibleJump=Math.max(maxVisibleJump,travel);}
      if(frame%20===0){
        assert.ok(roadsAt(a.x,a.z).some(r=>!r.walkable&&!r.underground&&polygonContains(r.rings,a.x,a.z)));
        assert.ok(!buildingsAt(a.x,a.z,2.4).some(b=>b.minY<1.65&&b.height>0&&diskIntersects(b.rings,a.x,a.z,2.35)));
        for(let j=i+1;j<states.length;j++)assert.equal(trafficOverlaps(a,states[j]),false);
      }
    }
    previous=states;
    if(frame===3600)movingAt180=states.filter(s=>s.speed>.2).length;
    if(frame===6000)movingAt300=states.filter(s=>s.speed>.2).length;
    if(frame===12000)movingAt600=states.filter(s=>s.speed>.2&&s.visible).length;
  }
  assert.ok(movingAt180>=2);assert.ok(movingAt300>=2);assert.ok(movingAt600>=4);
  assert.ok(previous.filter((s,i)=>Math.hypot(s.x-first.states[i].x,s.z-first.states[i].z)>1).length>=6);
  console.log(JSON.stringify({nearest,initialWithin100m:nearby.length,initialVisible:first.states.filter(s=>s.visible).length,movingAt180,movingAt300,movingAt600,visibleMovingAt600:previous.filter(s=>s.visible&&s.speed>.2).length,maxVisibleJump}));
});

test('quality bounds two meshes per car, shared resources dispose once, and invalid/paused direct updates do nothing',()=>{
  for(const quality of ['mobile','desktop']){
    const parent=new THREE.Scene(),traffic=createRoadTraffic(parent,makeRealMapLayout({quality})),first=traffic.snapshot(),resources=new Set();let meshes=0,triangles=0;
    traffic.root.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;resources.add(o.geometry);resources.add(o.material);}});
    assert.equal(first.count,quality==='mobile'?14:20);assert.equal(meshes,first.count*2);assert.ok(triangles<=7000);
    for(const dt of [0,-1,NaN,Infinity,.11])traffic.update(dt,{x:0,y:0,z:0});assert.deepEqual(traffic.snapshot(),first);
    let disposed=0;for(const r of resources)r.addEventListener('dispose',()=>disposed++);
    traffic.dispose();traffic.dispose();assert.equal(disposed,resources.size);assert.equal(parent.children.length,0);assert.deepEqual(traffic.snapshot().states,[]);
    console.log(JSON.stringify({quality,meshes,triangles,sharedResources:resources.size}));
  }
});

test('native snapshots expose committed rendered cars, never preview, stale, blocked or world-only advancement',t=>{
  const parent=new THREE.Scene(),native=createNativeScene(parent,'pigeon',{mapData:'osm',quality:'mobile',sessionId:'traffic-test'});t.after(()=>native.dispose());
  const lens={near:nativeNear(native.state.body,59,16/9),verticalFovDegrees:59,aspect:16/9},before=native.snapshot().traffic;
  const old=native.prepare(idle,.1,lens,'third',10,false);assert.equal(old.kind,'ready');assert.deepEqual(native.traffic.snapshot(),before);
  native.world.update(100,.1);assert.deepEqual(native.traffic.snapshot(),before);
  const winner=native.prepare(idle,.1,lens,'third',10,false);winner.commit();
  const committed=native.snapshot().traffic;assert.ok(committed.time>before.time);assert.deepEqual(committed,native.traffic.snapshot());
  assert.throws(()=>old.commit(),/Stale/);assert.deepEqual(native.traffic.snapshot(),committed);
  assert.equal(native.prepare(idle,.1,lens,'third',-1,false).kind,'blocked');assert.deepEqual(native.traffic.snapshot(),committed);
  for(const s of committed.states){const mesh=parent.getObjectByName(s.id);assert.deepEqual(mesh.position.toArray(),[s.x,s.y,s.z]);assert.equal(mesh.visible,s.visible);}
});


test('denser desktop circuit retains twenty moving separated cars through ten minutes', () => {
  const layout = makeRealMapLayout({ quality: 'desktop' }), traffic = createRoadTraffic(new THREE.Scene(), layout);
  try {
    const at = layout.spawns[0];
    for (let frame = 0; frame < 12000; frame++) {
      traffic.update(.05, at);
      if (frame % 20 === 0) {
        const states = traffic.snapshot().states;
        for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) assert.equal(trafficOverlaps(states[i], states[j]), false);
      }
    }
    const final = traffic.snapshot();
    assert.equal(final.count, 20);
    assert.equal(final.states.filter(s => s.speed > .2).length, 20);
  } finally { traffic.dispose(); }
});
