import * as THREE from 'three';
import type { Rings } from './ported/map/real-map/geometry.ts';
import type { NativeSupport, NativeWorldQueries } from './ported/motion/locomotion/b2/contracts.ts';

interface CloudPuff { readonly x:number; readonly y:number; readonly z:number; readonly rx:number; readonly ry:number; readonly rz:number }
export interface CloudPlatform { readonly id: string; readonly x: number; readonly z: number; readonly height: number; readonly width: number; readonly depth: number; readonly thickness: number; readonly rings: Rings; readonly puffs:readonly CloudPuff[] }
const SEGMENTS = 24, LATITUDES = 12;
const UNIT = new THREE.SphereGeometry(1, SEGMENTS, LATITUDES);
const UNIT_POSITIONS = UNIT.getAttribute('position');
const UNIT_INDICES = UNIT.index!;
// Keep the actual upper triangles, not an approximate mathematical sphere. The
// support height and the visible surface therefore agree even between vertices.
const TOP_TRIANGLES = Array.from({length:UNIT_INDICES.count/3},(_,i)=>[0,1,2].map(j=>UNIT_INDICES.getX(i*3+j)))
  .filter(triangle=>triangle.every(index=>UNIT_POSITIONS.getY(index)>=-1e-7))
  .map(triangle=>triangle.map(index=>({x:UNIT_POSITIONS.getX(index),y:UNIT_POSITIONS.getY(index),z:UNIT_POSITIONS.getZ(index)})));

/** Fixed, rounded cumulus clusters; the high central crown retains the old height. */
export function makeCloudPlatforms(): readonly CloudPlatform[] {
  const placements = [
    [-355,-80,44,35,24,7], [-230,-170,68,48,29,9], [-95,-300,94,60,35,11],
    [90,-410,126,66,39,12], [275,-225,151,78,43,14], [440,-30,111,65,38,11],
    [320,170,168,54,32,10], [165,335,108,45,28,8], [-80,395,102,62,36,11],
    [-350,260,137,72,42,13], [-480,-440,116,58,35,11], [510,420,145,68,38,12],
  ];
  return placements.map(([x,z,height,width,depth,thickness], index) => {
    // Broad low billows, irregular shoulders and a taller crown. Overlapping
    // opaque lobes produce a scalloped silhouette without a flat tabletop.
    const shape = [
      [0,-1.10,0,.24,1.10,.34],[-.22,-1.19,-.06,.24,.84,.36],
      [.23,-1.22,.04,.25,.91,.36],[-.10,-1.40,.24,.26,.76,.29],
      [.10,-1.42,-.23,.27,.78,.30],[-.38,-1.40,.04,.18,.59,.27],
      [.40,-1.43,-.02,.16,.61,.25],[-.18,-.96,-.20,.18,.73,.23],
      [.18,-.94,.20,.18,.70,.23],
    ];
    const puffs = shape.map(([px,py,pz,rx,ry,rz],i)=>{
      const variation=i===0?1:1+.06*Math.sin(index*2.31+i*1.73);
      return {x:px*width,y:py*thickness,z:pz*depth,rx:rx*width*variation,ry:ry*thickness,rz:rz*depth*variation};
    });
    // A footprint outline remains useful to map-clearance tests. Each radial
    // ray exits the union of the overlapping elliptical billows.
    const ring = Array.from({length:96},(_,i)=>{
      const a=i/96*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a);let radius=0;
      for(const p of puffs){
        const A=(dx/p.rx)**2+(dz/p.rz)**2,B=-2*(dx*p.x/p.rx**2+dz*p.z/p.rz**2),C=(p.x/p.rx)**2+(p.z/p.rz)**2-1,disc=B*B-4*A*C;
        if(disc>=0)radius=Math.max(radius,(-B+Math.sqrt(disc))/(2*A));
      }
      return [x+dx*radius,z+dz*radius];
    });ring.push([...ring[0]]);
    return {id:`sky:cloud:${index+1}`,x,z,height,width,depth,thickness,rings:[ring],puffs};
  });
}

/** Height of the exact rendered upper triangles in one unit sphere. */
function puffSurface(x:number,z:number):{height:number;normal:{x:number;y:number;z:number}}|null {
  if(x*x+z*z>1+1e-8)return null;
  for(const [a,b,c] of TOP_TRIANGLES){
    const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if(Math.abs(den)<1e-12)continue;
    const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den;
    const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den,w=1-u-v;
    if(u< -1e-7||v< -1e-7||w< -1e-7)continue;
    const ab={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},ac={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};
    const normal={x:ab.y*ac.z-ab.z*ac.y,y:ab.z*ac.x-ab.x*ac.z,z:ab.x*ac.y-ab.y*ac.x};
    return {height:u*a.y+v*b.y+w*c.y,normal};
  }
  return null;
}

/** The entire foot disk must fit inside a visible lobe, away from the wispy rim. */
export function cloudSurfaceAt(cloud:CloudPlatform,x:number,z:number,footRadius=0) {
  const localX=x-cloud.x,localZ=z-cloud.z;
  if(Math.abs(localX)>cloud.width*.65||Math.abs(localZ)>cloud.depth*.65)return null;
  let inside=false,top:{height:number;normal:{x:number;y:number;z:number}}|null=null;
  for(const p of cloud.puffs){
    const nx=(localX-p.x)/p.rx,nz=(localZ-p.z)/p.rz;
    // The inscribed regular polygon bound is conservative at every azimuth,
    // unlike a handful of sampled foot points at a concave cloud boundary.
    if(Math.hypot(nx,nz)+footRadius/Math.min(p.rx,p.rz)<Math.cos(Math.PI/SEGMENTS)-1e-8)inside=true;
    const surface=puffSurface(nx,nz);if(!surface)continue;
    const height=cloud.height+p.y+surface.height*p.ry;
    if(top&&height<=top.height)continue;
    const n={x:surface.normal.x/p.rx,y:surface.normal.y/p.ry,z:surface.normal.z/p.rz},length=Math.hypot(n.x,n.y,n.z);
    top={height,normal:{x:n.x/length,y:n.y/length,z:n.z/length}};
  }
  return inside?top:null;
}

/** One-way, soft clouds allow upward flight, stable rest and an ordinary takeoff. */
export function withCloudSupport<T extends NativeWorldQueries>(world:T,clouds:readonly CloudPlatform[]):T {
  return {...world,supportAt(probe){
    const base=world.supportAt(probe);if(base===undefined)return undefined;
    let best:NativeSupport|null=base;
    const low=Math.min(probe.previousFeetY,probe.at.y)-probe.maxDropM,high=probe.previousFeetY+probe.maxRiseM;
    for(const cloud of clouds){
      if(cloud.height<low-1e-7||cloud.height-cloud.thickness*2.1>high+1e-7)continue;
      const surface=cloudSurfaceAt(cloud,probe.at.x,probe.at.z,probe.footRadiusM);
      if(!surface||surface.height<low-1e-7||surface.height>high+1e-7||(best&&surface.height<=best.height))continue;
      best={id:cloud.id,layerId:cloud.id,height:surface.height,normal:surface.normal,surface:'cloud',walkable:true,landable:true};
    }
    return best;
  }};
}

function cloudGeometry(cloud:CloudPlatform):THREE.BufferGeometry {
  const vertices:number[]=[],normals:number[]=[],colors:number[]=[],indices:number[]=[];
  for(const p of cloud.puffs){
    const offset=vertices.length/3;
    for(let i=0;i<UNIT_POSITIONS.count;i++){
      const x=UNIT_POSITIONS.getX(i),y=UNIT_POSITIONS.getY(i),z=UNIT_POSITIONS.getZ(i);
      vertices.push(p.x+x*p.rx,p.y+y*p.ry,p.z+z*p.rz);
      const nx=x/p.rx,ny=y/p.ry,nz=z/p.rz,length=Math.hypot(nx,ny,nz);normals.push(nx/length,ny/length,nz/length);
      const shade=.86+.14*Math.sqrt(Math.max(0,(y+1)/2));colors.push(shade*.985,shade*.993,shade);
    }
    for(let i=0;i<UNIT_INDICES.count;i++)indices.push(offset+UNIT_INDICES.getX(i));
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}

export function createCloudLayer(parent:THREE.Scene){
  const platforms=makeCloudPlatforms(),root=new THREE.Group();root.name='seoul:cloud-perches';
  const material=new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:1,metalness:0,alphaHash:true,depthWrite:true});
  // Normal clouds are opaque, so overlapping billows never show ghosted inner
  // spheres. Only the camera's immediate vicinity fades using depth-safe dithering.
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 cloudPosition;\nvarying vec3 cloudWorldPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\ncloudPosition=position;cloudWorldPosition=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 cloudPosition;\nvarying vec3 cloudWorldPosition;').replace('#include <color_fragment>',`#include <color_fragment>\nfloat fluff=sin(cloudPosition.x*.43+cloudPosition.y*.31)*sin(cloudPosition.z*.39)+sin(cloudPosition.x*.19+cloudPosition.z*.23);diffuseColor.rgb*=.99+fluff*.008;diffuseColor.a*=smoothstep(.5,2.4,distance(cameraPosition,cloudWorldPosition));`);
  };
  for(const platform of platforms){const mesh=new THREE.Mesh(cloudGeometry(platform),material);mesh.position.set(platform.x,platform.height,platform.z);mesh.name=platform.id;root.add(mesh);}
  parent.add(root);let disposed=false;
  return {root,platforms,dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});material.dispose();}};
}
