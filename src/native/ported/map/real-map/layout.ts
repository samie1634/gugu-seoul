import { gwanghwamunCollision, isReplacedGwanghwamun, nearGwanghwamun } from './gwanghwamun.ts';
import { CHEONGGYE_LEVELS, channelGroundAt, channelPools } from './cheonggye-channel.ts';
import type { GroundSample, MapLayout, MapOptions, MapPoint, WaterContact } from '../contracts.ts';
import { realMapData } from './data.ts';
import { diskInside, diskIntersects, footprintBounds, footprintIndex, polygonContains } from './geometry.ts';
import type { RealMapData } from './types.ts';
const indices=new WeakMap<RealMapData,ReturnType<typeof makeIndices>>();
function makeIndices(data:RealMapData){return{buildings:footprintIndex(data.buildings),water:footprintIndex(data.water),roads:footprintIndex(data.roads.filter(r=>!r.underground))};}
function index(layout:MapLayout){const data=layout.realMap!;let i=indices.get(data);if(!i){i=makeIndices(data);indices.set(data,i);}return i;}
export function realGround(layout:MapLayout,x:number,z:number):GroundSample{
  if(layout.realMap===realMapData&&nearGwanghwamun(x,z)){const terrace=gwanghwamunCollision().solids.filter(s=>s.height<=.86&&polygonContains(s.rings,x,z)).sort((a,b)=>b.height-a.height)[0];if(terrace)return{y:terrace.height,surface:'stone',walkable:true,zone:'square'};}
  const i=index(layout),roads=i.roads(x,z).filter(r=>polygonContains(r.rings,x,z));
  if(roads.some(r=>r.bridge))return{y:0,surface:'stone',walkable:true,zone:'bridge'};
  const channel=layout.realMap===realMapData?channelGroundAt(x,z):null;if(channel)return channel;
  if(i.water(x,z).some(w=>polygonContains(w.rings,x,z)))return{y:-.5,surface:'water',walkable:false,zone:'riverbed'};
  const pedestrian=roads.some(r=>r.walkable),road=roads.some(r=>!r.walkable);
  return{y:0,surface:pedestrian?'stone':road?'asphalt':'stone',walkable:true,zone:pedestrian?'square':'street'};
}
export function realWater(layout:MapLayout,x:number,y:number,z:number):WaterContact|null{
  if(![x,y,z].every(Number.isFinite))return null;
  const i=index(layout),channel=layout.realMap===realMapData;
  const pool=channel?channelPools.find(p=>polygonContains(p.rings,x,z)):undefined;
  const level=pool?.y??(channel?CHEONGGYE_LEVELS.water:.02),bed=pool?.bed??(channel?CHEONGGYE_LEVELS.bed:-.5);
  if(y>level+.12||y<bed-.1)return null;
  if(y>=-.6&&i.roads(x,z).some(r=>r.bridge&&polygonContains(r.rings,x,z)))return null;
  const water=i.water(x,z).find(w=>polygonContains(w.rings,x,z));
  return water||pool?{id:pool?.id??water!.sourceId,y:level,depth:Math.max(0,level-y),current:{x:0,z:0}}:null;
}
export function realSpawnClear(layout:MapLayout,p:MapPoint,radius:number,height:number):boolean{
  const data=layout.realMap!,b=data.bounds;
  if(![p.x,p.y,p.z,radius,height].every(Number.isFinite)||radius<0||height<=0||p.x-radius<b.minX||p.x+radius>b.maxX||p.z-radius<b.minZ||p.z+radius>b.maxZ)return false;
  const i=index(layout),ground=realGround(layout,p.x,p.z);
  if(!ground.walkable||Math.abs(ground.y-p.y)>.08)return false;
  const bridge=i.roads(p.x,p.z,radius).some(r=>r.bridge&&diskInside(r.rings,p.x,p.z,radius));
  if(!bridge&&i.water(p.x,p.z,radius).some(w=>diskIntersects(w.rings,p.x,p.z,radius)))return false;
  const candidates=i.buildings(p.x,p.z,radius).filter(b=>layout.realMap!==realMapData||!isReplacedGwanghwamun(b));
  if(layout.realMap===realMapData&&nearGwanghwamun(p.x,p.z,radius))candidates.push(...gwanghwamunCollision().solids.map(s=>({...s,sourceId:s.id,surface:'stone' as const,heightStatus:'sojang_model',sourceHeight:null,measured:false as const})));
  return !candidates.some(b=>p.y+height>b.minY+1e-6&&p.y<b.height-1e-6&&diskIntersects(b.rings,p.x,p.z,radius));
}
export function makeRealMapLayout(options:MapOptions={}):MapLayout{
  const layout:MapLayout={realMap:realMapData,terrain:'flat-compatible',proportions:'reference-scale',quality:options.quality??'mobile',water:{id:'cheonggyecheon',minX:-181,maxX:575,minZ:410,maxZ:555,y:CHEONGGYE_LEVELS.water,bedY:CHEONGGYE_LEVELS.bed,flowX:0,flowZ:0,flowSpeed:0},promenadeY:CHEONGGYE_LEVELS.promenade,buildings:[],roofs:[],props:[],colliders:[],landingSurfaces:[],navNodes:[],navEdges:[],spawns:[]};
  for(const b of [...realMapData.buildings.filter(b=>!isReplacedGwanghwamun(b)),...gwanghwamunCollision().solids]){const a=footprintBounds(b.rings),width=a.maxX-a.minX,depth=a.maxZ-a.minZ;
    layout.colliders.push({id:b.id,x:(a.minX+a.maxX)/2,z:(a.minZ+a.maxZ)/2,width,depth,height:b.height,minY:b.minY,surface:b.surface,kind:'building'});
    // AABBs are broad phase metadata only. Real queries and rendering retain polygon holes.
  }
  // Real walking paths only. Do not repurpose the old compressed-city graph.
  for(const road of realMapData.roads){
    if(!road.walkable||road.underground||road.highway==='steps'||!road.centerline)continue;
    const line=road.centerline;
    for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(distance<1)continue;
      // Split long curved routes at source vertices and at 25m intervals.
      const pieces=Math.ceil(distance/25);
      for(let j=0;j<pieces;j++){
        const at=(t:number)=>({x:a[0]+(b[0]-a[0])*t,y:0,z:a[1]+(b[1]-a[1])*t});
        const p=at(j/pieces),q=at((j+1)/pieces),mid=at((j+.5)/pieces);
        if(![p,mid,q].every(v=>realSpawnClear(layout,v,.65,2)))continue;
        const id=`osm-path:${road.id}:${i}:${j}`,aid=id+':a',bid=id+':b',width=Math.min(road.width,4);
        layout.navNodes.push({...p,id:aid,zone:realGround(layout,p.x,p.z).zone},{...q,id:bid,zone:realGround(layout,q.x,q.z).zone});
        layout.navEdges.push({a:aid,b:bid,width,kind:'walk',requiresTrafficCheck:false});
      }
    }
  }
  const plaza={x:-336,y:0,z:108};
  // Bound NPC validation cost; the complete source road geometry remains intact.
  const nodes=new Map(layout.navNodes.map(n=>[n.id,n]));
  layout.navEdges.sort((a,b)=>{const x=nodes.get(a.a)!,y=nodes.get(b.a)!;return Math.hypot(x.x-plaza.x,x.z-plaza.z)-Math.hypot(y.x-plaza.x,y.z-plaza.z);});
  layout.navEdges=layout.navEdges.slice(0,48);
  const used=new Set(layout.navEdges.flatMap(e=>[e.a,e.b]));layout.navNodes=layout.navNodes.filter(n=>used.has(n.id));
  if(!realSpawnClear(layout,plaza,1.2,2))throw new Error('OSM plaza spawn is obstructed');
  layout.spawns.push({...plaza,id:'osm:plaza',clearance:1.2,for:['human','dog','cat','rat','bird']});
  const nearby=layout.navNodes.filter(n=>Math.hypot(n.x-plaza.x,n.z-plaza.z)<180);
  for(let i=0;i<nearby.length;i+=Math.max(1,Math.ceil(nearby.length/10))){const p=nearby[i];if(realSpawnClear(layout,p,1.2,2))layout.spawns.push({...p,id:`osm:spawn:${i}`,clearance:1.2,for:['human','dog','cat','rat','bird']});}
  return layout;
}
