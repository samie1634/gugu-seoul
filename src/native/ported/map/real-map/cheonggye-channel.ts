import { realMapData } from './data.ts';
import type { GroundSample } from '../contracts.ts';
import { polygonContains, diskInside, footprintBounds, footprintIndex } from './geometry.ts';
import { cheonggyeChannelData as data } from './cheonggye-channel-data.ts';
/** Documented total headwater drop; all absolute elevations are visual estimates. */
export const CHEONGGYE_LEVELS = Object.freeze({ upperWater: 0, middleWater: -.85, water: -4, bed: -4.3, promenade: -3.72 });
export const CHEONGGYE_ORIGIN = Object.freeze({ x: data.origin[0], z: data.origin[1] });
export function channelPoint(u:number,v:number,y=0){return{x:data.origin[0]+u*data.direction[0]-v*data.direction[1],y,z:data.origin[1]+u*data.direction[1]+v*data.direction[0]};}
export function channelLocal(x:number,z:number){const dx=x-data.origin[0],dz=z-data.origin[1];return{u:dx*data.direction[0]+dz*data.direction[1],v:-dx*data.direction[1]+dz*data.direction[0]};}
export const CHEONGGYE_AUDIO_ANCHORS = Object.freeze({ fountain:channelPoint(-18,0,.25), waterfall:channelPoint(0,0,-2), stream:[[-168.163,427.957],[-161.254,427.836],[-91.994,432.091],[-28.042,435.968],[172.442,455.708],[259.839,464.98],[417.006,504.03],[544.738,542.784],[574.13,543.259]].map(([x,z])=>({x,y:CHEONGGYE_LEVELS.water,z})) });
export interface ChannelSolid {id:string;rings:number[][][];height:number;minY:number;surface:'stone';color:string;render?:boolean;}
export function channelRect(u0:number,u1:number,v0:number,v1:number):number[][][]{const points=[[u0,v0],[u1,v0],[u1,v1],[u0,v1],[u0,v0]].map(([u,v])=>{const p=channelPoint(u,v);return[p.x,p.z];});return[points];}
function worldRect(cx:number,cz:number,width:number,span:number,angle:number):number[][][]{const c=Math.cos(angle),s=Math.sin(angle);return[[[-width/2,-span/2],[width/2,-span/2],[width/2,span/2],[-width/2,span/2],[-width/2,-span/2]].map(([u,v])=>[cx+u*c-v*s,cz+u*s+v*c])];}
export const CHEONGGYE_BRIDGES=Object.freeze([
 {id:'mojeon',x:-106.53,z:428.1205,width:27.5,span:19.5,angle:Math.atan2(1.410,24.295),kind:'arch' as const},
 {id:'gwangtong',x:47.318,z:443.253,width:14.4,span:23.8,angle:Math.atan2(1.322,26.904),kind:'stone' as const},
]);
export const channelSolids:ChannelSolid[]=[];
function solid(id:string,rings:number[][][],minY:number,height:number,color='#8b8e85'){channelSolids.push({id:'cheonggye:'+id,rings,minY,height,surface:'stone',color});}
// A thin, separately defined lining leaves the original water footprint intact.
for(const[pi,rs]of data.excavation.entries())for(const[ri,ring]of rs.entries())for(let i=1;i<ring.length;i++){
 const a=ring[i-1],b=ring[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.05)continue;
 const cx=(a[0]+b[0])/2,cz=(a[1]+b[1])/2;
 // Skip the headworks mouth where its pools and stairs meet the open plaza.
 const p=channelLocal(cx,cz);if(p.u<1&&Math.abs(p.v)<11)continue;
 solid(`wall:${pi}:${ri}:${i}`,worldRect(cx,cz,len,.14,Math.atan2(b[1]-a[1],b[0]-a[0])),CHEONGGYE_LEVELS.bed,0,'#92978e');
}
solid('middle-basin',channelRect(-8,0,-7.25,7.25),-4.3,-.97,'#545a54');
solid('upper-basin',channelRect(-28,-8,-7.25,7.25),-.48,-.12,'#5d625a');
for(const side of[-1,1]){
 solid(`upper-rim:${side}`,channelRect(-28.5,-8,side<0?-7.9:7.25,side<0?-7.25:7.9),-.45,.15,'#969b91');
 solid(`middle-rim:${side}`,channelRect(-8,0,side<0?-7.9:7.25,side<0?-7.25:7.9),-4.3,-.6,'#656c64');
 // Two real stair flights. Their exact number and width are reference-based estimates.
 for(let i=0;i<24;i++){const u=-8+i*.55,h=-(i+1)*3.72/24;solid(`entry-step:${side}:${i}`,channelRect(u,u+.55,side<0?-10.35:7.9,side<0?-7.9:10.35),-4.32,h,'#b6b4a7');}
}
solid('upper-back-rim',channelRect(-28.5,-28,-7.9,7.9),-.45,.15,'#969b91');
// Eight broad slabs along the two lower banks evoke Palseokdam without copied textures.
for(const side of[-1,1])for(let i=0;i<4;i++){const u=8+i*4.4;solid(`palseokdam:${side}:${i}`,channelRect(u,u+3.5,side<0?-9.4:7.1,side<0?-7.1:9.4),-4.32,-3.53,['#a9a28e','#949b8b','#b7ae99','#93968e'][i]);}
for(const b of CHEONGGYE_BRIDGES){
 solid(`${b.id}:deck`,worldRect(b.x,b.z,b.width,b.span,b.angle),-.55,0,'#aaa99b');
 // Parallel cross-stream slices give Mojeon a true open arch, not a painted hole.
 if(b.kind==='arch')for(let j=0;j<24;j++){
  const v=-b.span/2+(j+.5)*b.span/24,normal=v/(b.span/2),bottom=-.85-2.7*Math.pow(Math.abs(normal),2.2);
  for(const side of[-1,1]){const u=side*(b.width/2-.38),cx=b.x+u*Math.cos(b.angle)-v*Math.sin(b.angle),cz=b.z+u*Math.sin(b.angle)+v*Math.cos(b.angle);solid(`${b.id}:arch:${side}:${j}`,worldRect(cx,cz,.76,b.span/24+.015,b.angle),bottom,-.55,'#a19d8b');}
 }else for(const v of[-4,4]){const cx=b.x-v*Math.sin(b.angle),cz=b.z+v*Math.cos(b.angle);solid(`${b.id}:pier:${v}`,worldRect(cx,cz,b.width-1.2,.9,b.angle),-4.3,-.55,'#a9a48f');}
 for(const side of[-1,1])for(let j=0;j<=10;j++){const u=side*(b.width/2-.25),v=-b.span/2+j*b.span/10,cx=b.x+u*Math.cos(b.angle)-v*Math.sin(b.angle),cz=b.z+u*Math.sin(b.angle)+v*Math.cos(b.angle);solid(`${b.id}:rail-post:${side}:${j}`,worldRect(cx,cz,.28,.28,b.angle),0,1.0,'#c3c0ad');}
 for(const side of[-1,1]){const u=side*(b.width/2-.25),cx=b.x+u*Math.cos(b.angle),cz=b.z+u*Math.sin(b.angle);solid(`${b.id}:rail:${side}`,worldRect(cx,cz,.17,b.span,b.angle),.82,.99,'#b8b7aa');}
}
// The simplified shell has a closed conical core. Matching short tapered
// collision bands prevent flight through the sculpture without a giant AABB.
const springAt=channelPoint(-72,-1.5);
for(let i=0;i<40;i++){
 const y=i*.5,t=(y+.25)/20,r=.018+2.72*Math.pow(1-t,.8),ring=Array.from({length:33},(_,j)=>{const a=j/32*Math.PI*2,spiral=a-t*Math.PI*2*4.8,rib=.20*Math.pow(1-t,.6)*Math.sin(spiral);return[springAt.x+Math.cos(a)*(r+rib),springAt.z+Math.sin(a)*(r+rib)];});
 channelSolids.push({id:`cheonggye:spring-core:${i}`,rings:[ring],minY:y,height:y+.5,surface:'stone',color:'#c83340',render:false});
}
// Other source-mapped crossings keep their existing outline and grade, with a
// thin physical underside so the lowered channel remains open beneath them.
for(const r of realMapData.roads){
 if(!r.bridge||r.underground)continue;
 const b=footprintBounds(r.rings),cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
 if(cz<400||CHEONGGYE_BRIDGES.some(k=>Math.hypot(cx-k.x,cz-k.z)<k.width))continue;
 solid(`source-bridge:${r.id}`,r.rings,-.42,0,'#aab0ac');
}
export const channelWaterAreas=data.water.map((rings,i)=>({id:`cheonggye:water:${i}`,rings}));
export const channelTerraces=data.terraces.map((rings,i)=>({id:`cheonggye:promenade:${i}`,rings}));
export const channelExcavations=data.excavation.map((rings,i)=>({id:`cheonggye:excavation:${i}`,rings}));
export const channelTerrainReplacements=new Map(data.replacements.map(p=>[p.index,p.pieces]));
export const channelPools=[{id:'cheonggye:fountain',rings:channelRect(-28,-8,-7.25,7.25),y:0,bed:-.12},{id:'cheonggye:middle-pool',rings:channelRect(-8,0,-7.25,7.25),y:-.85,bed:-.97}];
const solidIndex=footprintIndex(channelSolids);
const bounds=channelExcavations.map(p=>({...p,...footprintBounds(p.rings)}));
export function inChannelExcavation(x:number,z:number){return bounds.some(p=>x>=p.minX&&x<=p.maxX&&z>=p.minZ&&z<=p.maxZ&&polygonContains(p.rings,x,z));}
export function channelTerrainAt(x:number,z:number):GroundSample|null{
 if(!inChannelExcavation(x,z))return null;
 if(channelWaterAreas.some(p=>polygonContains(p.rings,x,z)))return{y:CHEONGGYE_LEVELS.bed,surface:'water',walkable:false,zone:'riverbed'};
 return{y:CHEONGGYE_LEVELS.promenade,surface:'stone',walkable:true,zone:'promenade'};
}
export function channelGroundAt(x:number,z:number):GroundSample|null{
 let height=-Infinity;
 for(const s of solidIndex(x,z))if(polygonContains(s.rings,x,z))height=Math.max(height,s.height);
 if(Number.isFinite(height))return{y:height,surface:'stone',walkable:true,zone:'promenade'};
 return channelTerrainAt(x,z);
}
export function channelDryDisk(x:number,z:number,r:number){return channelTerraces.some(p=>diskInside(p.rings,x,z,r));}
