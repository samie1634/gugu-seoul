import * as THREE from 'three';
import type { RealPolygon, RealRoad } from './types.ts';
export type Rings = number[][][];
type Footprint = Pick<RealPolygon,'rings'> | Pick<RealRoad,'rings'>;
export function segmentDistance(x:number,z:number,a:number[],b:number[]):number{
  const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
  const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length)):0;
  return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
}
function inRing(ring:number[][],x:number,z:number):boolean{
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    // Only points inside an edge's expanded bounds can be boundary contacts.
    // Keep the original distance calculation for those contacts, so tolerance
    // and ray-crossing semantics are unchanged away from the spatial index.
    if(x>=Math.min(a[0],b[0])-1e-7&&x<=Math.max(a[0],b[0])+1e-7
      &&z>=Math.min(a[1],b[1])-1e-7&&z<=Math.max(a[1],b[1])+1e-7
      &&segmentDistance(x,z,a,b)<1e-7)return true;
    if((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function polygonContains(rings:Rings,x:number,z:number):boolean{
  return !!rings.length&&inRing(rings[0],x,z)&&!rings.slice(1).some(r=>inRing(r,x,z));
}
export function polygonDistance(rings:Rings,x:number,z:number):number{
  let result=Infinity;
  for(const ring of rings)for(let i=1;i<ring.length;i++)result=Math.min(result,segmentDistance(x,z,ring[i-1],ring[i]));
  return result;
}
export function diskInside(rings:Rings,x:number,z:number,radius:number):boolean{return polygonContains(rings,x,z)&&polygonDistance(rings,x,z)>=radius-1e-7;}
export function diskIntersects(rings:Rings,x:number,z:number,radius:number):boolean{return polygonContains(rings,x,z)||polygonDistance(rings,x,z)<radius-1e-7;}
export function footprintBounds(rings:Rings){
  const points=rings[0];return{minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[1])),maxZ:Math.max(...points.map(p=>p[1]))};
}
export function footprintIndex<T extends Footprint>(features:T[]){
  type Entry={feature:T;bounds:ReturnType<typeof footprintBounds>};
  const cells=new Map<string,Entry[]>(),size=32;
  // Source footprints are static. Cache each bound once instead of sending all
  // occupants of a 32m cell to expensive exact polygon tests on every step.
  for(const feature of features){
    const bounds=footprintBounds(feature.rings),entry={feature,bounds};
    for(let x=Math.floor(bounds.minX/size);x<=Math.floor(bounds.maxX/size);x++)for(let z=Math.floor(bounds.minZ/size);z<=Math.floor(bounds.maxZ/size);z++){
      const key=`${x}:${z}`,list=cells.get(key)??[];list.push(entry);cells.set(key,list);
    }
  }
  return(x:number,z:number,radius=0):T[]=>{
    if(![x,z,radius].every(Number.isFinite)||radius<0)return[];
    // Retain the exact polygon routines' boundary tolerance, including across
    // cell boundaries. This is only broad-phase rejection, never a solid AABB.
    const reach=radius+1e-7,minX=x-reach,maxX=x+reach,minZ=z-reach,maxZ=z+reach;
    const result=new Set<T>();
    for(let i=Math.floor(minX/size);i<=Math.floor(maxX/size);i++)for(let j=Math.floor(minZ/size);j<=Math.floor(maxZ/size);j++){
      for(const {feature,bounds:b} of cells.get(`${i}:${j}`)??[]){
        if(b.maxX>=minX&&b.minX<=maxX&&b.maxZ>=minZ&&b.minZ<=maxZ)result.add(feature);
      }
    }
    return[...result];
  };
}
export function polygonShape(rings:Rings):THREE.Shape{
  const path=(points:number[][],p:THREE.Path)=>{p.moveTo(points[0][0],-points[0][1]);for(const v of points.slice(1))p.lineTo(v[0],-v[1]);p.closePath();return p;};
  const shape=new THREE.Shape();path(rings[0],shape);for(const ring of rings.slice(1))shape.holes.push(path(ring,new THREE.Path()));return shape;
}
export function polygonGeometry(rings:Rings,top:number,bottom?:number):THREE.BufferGeometry{
  const shape=polygonShape(rings);
  const geometry=bottom===undefined?new THREE.ShapeGeometry(shape):new THREE.ExtrudeGeometry(shape,{depth:top-bottom,bevelEnabled:false,steps:1});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,bottom??top,0);return geometry;
}
