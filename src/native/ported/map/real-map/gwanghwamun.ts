import * as THREE from 'three';
import { buildSojangGwanghwamun, applySojangGateTextures } from './sojang-gwanghwamun.js';
import type { MapQuality, SurfaceKind } from '../contracts.ts';
import type { RealPolygon } from './types.ts';

/** The existing Sojang model uses physical metre dimensions. Only its local
 * origin and palace-axis orientation change; no new labels or UI are added. */
export const GWANGHWAMUN_PLACEMENT = Object.freeze({
  x: -325.4276037661184, z: -325.4900262764422, yaw: -0.053563019071857905,
  sourceZ: 145, scale: 1,
  source: 'sojang-culture/public/walk/heritage.js', sourceVersion: 203,
  sourceCommit: '4e708a53ea7b33481a6177f7268f569fe8d19a12',
  sourceSha256: '18067b4582fbcf525a2f2b507552a52553ac5f1a6de3323ff69ddc632626d4fa',
});
// Existing OSM fragments of this gate only. Neighbouring palace walls and
// guard houses retain their original geometry and collisions.
const replacedSources = new Set([
  'way/170199440', ...[1170008834,1170008836,1170008837,1170008838,1170008839,1170008840,
    1415432340,1415432341,1415432342,1415432343,1415432344,1415432345,1415432346,1415432347].map(id=>`way/${id}`),
  ...[19361791,19361792,19361793,19361794,19361978,19361979,19361980,19361981,19361982,19362286].map(id=>`relation/${id}`),
]);
export const isReplacedGwanghwamun = (p: Pick<RealPolygon,'sourceId'>): boolean => replacedSources.has(p.sourceId);
export const nearGwanghwamun=(x:number,z:number,pad=0):boolean=>Math.abs(x-GWANGHWAMUN_PLACEMENT.x)<32+pad&&z-GWANGHWAMUN_PLACEMENT.z> -24-pad&&z-GWANGHWAMUN_PLACEMENT.z<68+pad;
export function gateWorld(x:number,z:number,y=0):THREE.Vector3 {
  return new THREE.Vector3(x,y,z-GWANGHWAMUN_PLACEMENT.sourceZ)
    .applyAxisAngle(new THREE.Vector3(0,1,0),GWANGHWAMUN_PLACEMENT.yaw)
    .add(new THREE.Vector3(GWANGHWAMUN_PLACEMENT.x,0,GWANGHWAMUN_PLACEMENT.z));
}
type Point = [number,number,number];
type Materials = Record<string,THREE.MeshStandardMaterial>;
export interface SojangGateKit {
  T: typeof THREE; m: Materials; lowDetail:boolean; group:THREE.Group;
  colliders:{x:number;z:number;w:number;d:number}[];
  mesh:(g:THREE.BufferGeometry,m:THREE.Material,x?:number,y?:number,z?:number)=>THREE.Mesh;
  box:(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material,solid?:boolean)=>void;
  column:(x:number,y:number,z:number,h:number,radius:number,m?:THREE.Material,solid?:boolean)=>void;
  beam:(a:Point,b:Point,w:number,d:number,m:THREE.Material,round?:boolean)=>void;
  orb:(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material)=>void;
}
export interface GateSolid {id:string;rings:number[][][];minY:number;height:number;surface:SurfaceKind}
export interface GateSurface {id:string;triangles:Point[][];surface:string}
const COLORS:Record<string,string>={stone:'#e4e1d8',masonry:'#e3e0d5',paving:'#c3c2b8',roof:'#4e5557',ridge:'#9c9e97',red:'#844333',green:'#355e4e',blue:'#49716b',gold:'#bfa772',wood:'#5e392c',paper:'#929f8b',dark:'#222c2d',cream:'#e0dfd7',dancheong:'#35554a'};
function createModel(lowDetail:boolean,recordCollision=false,distant=false){
  const root=new THREE.Group();root.name='sojang:gwanghwamun';
  root.position.set(GWANGHWAMUN_PLACEMENT.x,0,GWANGHWAMUN_PLACEMENT.z);
  root.rotation.y=GWANGHWAMUN_PLACEMENT.yaw;
  const local=new THREE.Group();local.position.z=-145;root.add(local);
  const m=Object.fromEntries(Object.entries(COLORS).map(([key,color])=>[key,new THREE.MeshStandardMaterial({color,roughness:key==='roof'?.74:.85,side:key==='roof'?THREE.DoubleSide:THREE.FrontSide})]));
  if(!recordCollision)applySojangGateTextures(THREE,m);
  const cube=new THREE.BoxGeometry(1,1,1),cylinder=new THREE.CylinderGeometry(1,1,1,lowDetail?6:16),sphere=new THREE.SphereGeometry(1,distant?6:10,distant?4:8),beamCylinder=new THREE.CylinderGeometry(1,1,1,lowDetail?6:8);
  const timberColumn=new THREE.LatheGeometry([new THREE.Vector2(.92,-.5),new THREE.Vector2(1,-.34),new THREE.Vector2(1.025,-.12),new THREE.Vector2(.96,.25),new THREE.Vector2(.86,.5)],lowDetail?8:16);
  const batches=new Map<string,{g:THREE.BufferGeometry;m:THREE.Material;matrices:THREE.Matrix4[]}>();
  const dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),solids:GateSolid[]=[],surfaces:GateSurface[]=[];
  const addSolid=(x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material)=>{
    if(!recordCollision||w<.22||d<.22||h<.04)return;
    // Tiny trim and brackets are visual detail, not invisible broad boxes.
    if(w*d<.5&&h<1.2)return;
    const rings=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]].map(([dx,dz])=>{const p=gateWorld(x+dx,z+dz);return[p.x,p.z];});
    solids.push({id:`sojang:gwanghwamun:solid:${solids.length}`,rings:[rings],minY:y,height:y+h,surface:material===m.roof?'roof-tile':'stone'});
  };
  const instance=(g:THREE.BufferGeometry,material:THREE.Material,position:Point,scale:Point,q?:THREE.Quaternion)=>{
    const key=g.uuid+material.uuid;let batch=batches.get(key);if(!batch){batch={g,m:material,matrices:[]};batches.set(key,batch);}
    dummy.position.fromArray(position);dummy.scale.fromArray(scale);dummy.quaternion.copy(q??new THREE.Quaternion());dummy.updateMatrix();batch.matrices.push(dummy.matrix.clone());
  };
  const kit:SojangGateKit={T:THREE,m,lowDetail,group:local,colliders:[],
    box(x,y,z,w,h,d,material){instance(cube,material,[x,y+h/2,z],[w,h,d]);addSolid(x,y,z,w,h,d,material);},
    column(x,y,z,h,radius,material=m.red){instance(material===m.red?timberColumn:cylinder,material,[x,y+h/2,z],[radius,h,radius]);addSolid(x,y,z,radius*2,h,radius*2,material);},
    orb(x,y,z,w,h,d,material){instance(sphere,material,[x,y,z],[w,h,d]);},
    beam(a,b,w,d,material,round=false){const direction=new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a)),length=direction.length();const q=new THREE.Quaternion().setFromUnitVectors(up,direction.normalize());instance(round?beamCylinder:cube,material,[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],[w,length,d],q);},
    mesh(g,material,x=0,y=0,z=0){const mesh=new THREE.Mesh(g,material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;local.add(mesh);return mesh;},
  };
  buildSojangGwanghwamun(kit);
  root.updateMatrixWorld(true);
  if(recordCollision){
    for(const mesh of local.children){
      if(!(mesh instanceof THREE.Mesh)||!(mesh.userData.heritagePart==='roof'||mesh.material===m.masonry))continue;
      const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry,p=g.getAttribute('position'),triangles:Point[][]=[];
      for(let i=0;i<p.count;i+=3){const triangle:Point[]=[];for(let j=0;j<3;j++){const v=new THREE.Vector3().fromBufferAttribute(p,i+j).applyMatrix4(mesh.matrixWorld);triangle.push(v.toArray() as Point);}triangles.push(triangle);}
      surfaces.push({id:`sojang:gwanghwamun:${mesh.userData.heritagePart==='roof'?'roof':'arch'}:${surfaces.length}`,triangles,surface:mesh.userData.heritagePart==='roof'?'roof-tile':'stone'});
      if(g!==mesh.geometry)g.dispose();
    }
    // Interior containment for the masonry piers. Curved arch soffits use the
    // imported mesh triangles, so all three portals stay open.
    for(const[x,r]of[[-10,2.45],[0,2.95],[10,2.45]])addSolid(x,.8,145,r*2,.05,8,m.stone);
    for(const[a,b]of[[-19,-12.45],[-7.55,-2.95],[2.95,7.55],[12.45,19]])addSolid((a+b)/2,.8,145,b-a,7.2,8,m.masonry);
  }
  for(const batch of batches.values()){
    const mesh=new THREE.InstancedMesh(batch.g,batch.m,batch.matrices.length);batch.matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.castShadow=true;mesh.receiveShadow=true;local.add(mesh);
  }
  let triangles=0,drawCalls=0;root.traverse(o=>{if(o instanceof THREE.Mesh){drawCalls++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o instanceof THREE.InstancedMesh?o.count:1);}});
  root.userData.provenance=GWANGHWAMUN_PLACEMENT;root.userData.renderBudget={triangles,drawCalls};
  return{root,solids,surfaces,triangles,drawCalls,dispose(){
    const geometries=new Set<THREE.BufferGeometry>([cube,cylinder,sphere,beamCylinder,timberColumn]),materials=new Set<THREE.Material>(Object.values(m));
    root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:[o.material])materials.add(material);if(o instanceof THREE.InstancedMesh)o.dispose();}});
    geometries.forEach(g=>g.dispose());materials.forEach(material=>{if(material instanceof THREE.MeshStandardMaterial)material.map?.dispose();material.dispose();});root.removeFromParent();root.clear();
  }};
}
let collision: {solids:GateSolid[];surfaces:GateSurface[]}|undefined;
export function gwanghwamunCollision(){
  if(!collision){const model=createModel(true,true);collision={solids:model.solids,surfaces:model.surfaces};model.dispose();}
  return collision;
}
export function createGwanghwamun(quality:MapQuality){
  const near=createModel(quality==='mobile'),far=createModel(true,false,true),root=new THREE.LOD();
  root.name='sojang:gwanghwamun';root.position.set(GWANGHWAMUN_PLACEMENT.x,0,GWANGHWAMUN_PLACEMENT.z);
  near.root.position.set(0,0,0);far.root.position.set(0,0,0);
  near.root.name='sojang:gwanghwamun:near';far.root.name='sojang:gwanghwamun:far';
  root.addLevel(near.root,0);root.addLevel(far.root,quality==='desktop'?120:80,.12);
  root.userData.provenance=GWANGHWAMUN_PLACEMENT;
  return{root,triangles:near.triangles,drawCalls:near.drawCalls,farTriangles:far.triangles,farDrawCalls:far.drawCalls,
    dispose(){near.dispose();far.dispose();root.removeFromParent();root.clear();}};
}
