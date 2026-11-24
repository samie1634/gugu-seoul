import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {footprintIndex, footprintBounds, polygonContains, diskIntersects, diskInside} from '../src/native/ported/map/real-map/geometry.ts';
import {realMapData} from '../src/native/ported/map/real-map/data.ts';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {createMapNpcAdapter} from '../src/native/ported/npcs/runtime/map-adapter.ts';

const rectangle=(id,x,z,w=1,d=1)=>({id,rings:[[[x,z],[x+w,z],[x+w,z+d],[x,z+d],[x,z]]]});
const matches=(features,x,z,radius)=>features.filter(f=>polygonContains(f.rings,x,z)||diskIntersects(f.rings,x,z,radius)||diskInside(f.rings,x,z,radius));

test('map index rejects unrelated occupants without turning bounding boxes into solids',()=>{
 const near=rectangle('near',2,2),far=rectangle('far',25,25),courtyard={id:'courtyard',rings:[[[5,5],[20,5],[20,20],[5,20],[5,5]],[[8,8],[12,8],[12,12],[8,12],[8,8]]]};
 const index=footprintIndex([near,far,courtyard]);
 assert.deepEqual(index(2.5,2.5),[near]);
 assert.deepEqual(index(10,10),[courtyard]);
 assert.equal(polygonContains(index(10,10)[0].rings,10,10),false);
 assert.deepEqual(index(50,50),[]);
 assert.deepEqual(index(24.1,25.5,1),[far]);
});

test('map index retains contact tolerance on either side of positive/negative cell seams',()=>{
 const a=rectangle('positive',32,2),b=rectangle('negative',-33,-3);
 const index=footprintIndex([a,b]);
 for(const [x,z,f] of [[32-5e-8,2.5,a],[-32+5e-8,-2.5,b]]){
  assert.equal(polygonContains(f.rings,x,z),true);
  assert.deepEqual(index(x,z),[f]);
 }
});

test('map index deduplicates overlapping cells and repeated source identity',()=>{
 const wide=rectangle('wide',-50,-50,100,100),edge=rectangle('edge',56,0);
 const index=footprintIndex([wide,wide,edge]);
 assert.deepEqual(index(0,0,60),[wide,edge]);
 for(const point of [[NaN,0,1],[0,Infinity,1],[0,0,Infinity],[0,0,-1]])assert.deepEqual(index(...point),[]);
});

test('actual source polygons retain every exact hit across deterministic world probes',()=>{
 let seed=924312;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
 for(const source of [realMapData.buildings,realMapData.roads,realMapData.water]){
  const index=footprintIndex(source),probes=[];
  for(let i=0;i<160;i++)probes.push([-590+random()*1180,-570+random()*1140,[0,.2,.65,1.2,20][i%5]]);
  for(let i=0;i<source.length;i+=Math.max(1,Math.floor(source.length/70))){const b=footprintBounds(source[i].rings);probes.push([b.minX,b.minZ,0],[(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2,.65]);}
  for(const [x,z,radius] of probes){
   const expected=matches(source,x,z,radius),candidates=index(x,z,radius);
   for(const f of expected)assert.ok(candidates.includes(f),`lost ${f.id} at ${x},${z}, radius ${radius}`);
   assert.deepEqual(new Set(matches(candidates,x,z,radius)),new Set(expected));
  }
 }
});

test('actual routes, node order, spawn zones and exclusions match frozen v19 behavior',()=>{
 const layout=makeMapLayout({data:'osm'}),adapter=createMapNpcAdapter(layout);
 const result={navNodes:layout.navNodes,navEdges:layout.navEdges,spawns:layout.spawns,routes:adapter.navigation.routes,spawnZones:adapter.navigation.spawnZones,excludedEdges:adapter.excludedEdges};
 const hash=crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
 assert.equal(hash,'24c621a34cf9f2be54712152bb8e8e0d13e3c78229880465e4ad975bb18f7953');
});

// Verbatim v19 point-in-polygon behavior, kept here as a differential oracle.
function legacySegmentDistance(x,z,a,b){
 const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
 const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length)):0;
 return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
}
function legacyRing(ring,x,z){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];
  if(legacySegmentDistance(x,z,a,b)<1e-7)return true;
  if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
const legacyContains=(rings,x,z)=>!!rings.length&&legacyRing(rings[0],x,z)&&!rings.slice(1).some(r=>legacyRing(r,x,z));

test('edge-bound rejection preserves v19 exact polygon results at source vertices and edges',()=>{
 let checked=0;
 for(const f of [...realMapData.buildings,...realMapData.roads,...realMapData.water]){
  for(const ring of f.rings){
   for(let i=0;i<ring.length;i+=Math.max(1,Math.floor(ring.length/4))){
    const a=ring[i],b=ring[(i+1)%ring.length];
    for(const offset of [0,5e-8,-5e-8,2e-7,-2e-7,.65]){
     for(const [x,z] of [[a[0]+offset,a[1]-offset],[(a[0]+b[0])/2+offset,(a[1]+b[1])/2-offset]]){
      assert.equal(polygonContains(f.rings,x,z),legacyContains(f.rings,x,z),`${f.id} at ${x},${z}`);checked++;
     }
    }
   }
  }
 }
 assert.ok(checked>100000);
 console.log(`v19 boundary equivalence: ${checked} probes`);
});
