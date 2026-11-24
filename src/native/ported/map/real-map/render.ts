import { createGwanghwamun, isReplacedGwanghwamun } from './gwanghwamun.ts';
import { createCheonggyeLandmarks } from './cheonggye-landmarks.ts';
import { channelTerrainReplacements, CHEONGGYE_LEVELS } from './cheonggye-channel.ts';
import * as THREE from 'three';
import { Painter } from '../../../../geometry.ts';
import type { MapActor, MapOptions, MapSurfaceEvent } from '../contracts.ts';
import type { MapCandidate } from '../candidate.ts';
import { makeRealMapLayout, realGround, realWater } from './layout.ts';
import { diskInside, polygonGeometry, footprintBounds, footprintIndex } from './geometry.ts';
import { createBuildingLods } from './buildings.ts';
import { realSurfaces } from './surfaces.ts';
import { createPolygonWater } from './water.ts';
import { createReflectionEnvironment } from './reflection-environment.ts';
import { createTerrainDetailMaterial, withTerrainDetail } from './ground-detail.ts';
import { createMappedTreeLods } from './trees.ts';
/** Geometry-first experimental layer. No surveyed heights or façade detail are claimed. */
export function createRealMapCandidate(options:MapOptions={}):MapCandidate{
  const layout=makeRealMapLayout(options),data=layout.realMap!,root=new THREE.Group();root.name='OSM Seoul metric map';
  const painters=new Map<string,Painter>(),materials:THREE.Material[]=[];
  const terrainMaterial=createTerrainDetailMaterial(layout.quality);materials.push(terrainMaterial);
  const surfaceColors={ground:'#b8c2a9',road:'#59666b',path:'#d1c3a6',bridge:'#aab0ac',water:'#668a89'};
  // Disjoint polygons, not millimetre-offset decals: no hidden ground/road overlap.
  for(const[index,original]of realSurfaces.entries()){
   for(const rings of channelTerrainReplacements.get(index)??[original.rings]){
    const surface={...original,rings};
    if(surface.kind==='water')continue;
    const b=footprintBounds(surface.rings),key=`${Math.floor((b.minX+b.maxX)/2/250)}:${Math.floor((b.minZ+b.maxZ)/2/250)}`;
    let painter=painters.get(key);if(!painter){painter=new Painter();painters.set(key,painter);}
    painter.add(withTerrainDetail(polygonGeometry(surface.rings,surface.y),surface.kind),surfaceColors[surface.kind],new THREE.Vector3());
  }
   }
  for(const[key,p]of painters){
    const [ix,iz]=key.split(':').map(Number),x=(ix+.5)*250,z=(iz+.5)*250;
    const geometry=p.geometry();geometry.translate(-x,0,-z);geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,terrainMaterial);mesh.name=`osm:terrain-cell:${key}`;mesh.position.set(x,0,z);mesh.receiveShadow=true;root.add(mesh);
  }
  const environment=createReflectionEnvironment(layout.quality);
  const buildings=createBuildingLods(data.buildings,layout.quality,environment);root.add(buildings.root);
  const gwanghwamun=createGwanghwamun(layout.quality);root.add(gwanghwamun.root);
  const nearbyBuildings=footprintIndex(data.buildings.filter(b=>!isReplacedGwanghwamun(b)));
  const water=createPolygonWater(layout.quality,environment);root.add(water.root);
  const landmarks=createCheonggyeLandmarks();root.add(landmarks.root);
  const trees=createMappedTreeLods(layout,layout.quality);root.add(trees.root);
  root.updateMatrixWorld(true);let allocatedTriangles=0,allocatedMeshes=0;root.traverse(o=>{if(o instanceof THREE.Mesh){allocatedMeshes++;allocatedTriangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o instanceof THREE.InstancedMesh?o.count:1);}});
  const stats={meshes:allocatedMeshes-buildings.chunks-trees.budget.chunks-gwanghwamun.farDrawCalls,triangles:allocatedTriangles-buildings.farTriangles-trees.budget.farTriangles-gwanghwamun.farTriangles,colliders:layout.colliders.length,landingSurfaces:data.buildings.length,reflectionSize:layout.quality==='desktop'?256:0,extraReflectionPasses:layout.quality==='desktop'?1:0};
  root.userData.renderBudget={buildingChunks:buildings.chunks,nearBuildingTriangles:buildings.nearTriangles,farBuildingTriangles:buildings.farTriangles,allocatedMeshes,allocatedTriangles,terrainChunks:painters.size,trees:trees.budget,gwanghwamun:{drawCalls:gwanghwamun.drawCalls,triangles:gwanghwamun.triangles,farTriangles:gwanghwamun.farTriangles,farDrawCalls:gwanghwamun.farDrawCalls}};
  const sessionId=options.eventSessionId??crypto.randomUUID();let sequence=0,disposed=false;
  const actors=new Map<string,{water:string;surface:string;time:number}>();
  return{root,layout,obstacles:layout.colliders,landingSurfaces:layout.landingSurfaces,stats,
    update(time,delta){if(disposed||!Number.isFinite(time)||!Number.isFinite(delta)||delta<=0)return;environment.update(time);water.update(time);landmarks.update(time,environment.uniforms.uReflectionDaylight.value);},
    observeActor(actor:MapActor,time:number){
      if(disposed||![actor.x,actor.y,actor.z,time,actor.radius].every(Number.isFinite)||actor.radius<0)return[];
      const old=actors.get(actor.id);if(old&&time<=old.time)return[];
      const feet=actor.y-(actor.centreToSole??actor.radius),nearWater=realWater(layout,actor.x,feet,actor.z),wet=nearWater&&feet<=nearWater.y+.000002?nearWater:null,ground=realGround(layout,actor.x,actor.z);
      const roof=actor.grounded?nearbyBuildings(actor.x,actor.z).find(b=>Math.abs(b.height-feet)<.015&&diskInside(b.rings,actor.x,actor.z,actor.footRadius??actor.radius)):undefined;
      const target=roof?.id??(actor.grounded&&Math.abs(feet-ground.y)<.015?`ground:${ground.zone}`:'');
      const events:MapSurfaceEvent[]=[];
      const emit=(type:MapSurfaceEvent['type'],targetId:string,surface:MapSurfaceEvent['surface'],y=feet)=>{const seq=++sequence;events.push({type,producer:'map',sessionId,sequence:seq,eventId:`${sessionId}:map:${seq}`,actorId:actor.id,targetId,x:actor.x,y,z:actor.z,surface,strength:.3,time});};
      if(wet&&!old?.water){emit('water-enter',wet.id,'water',wet.y);water.addRipple(actor.x,actor.z,time,.7);}if(!wet&&old?.water)emit('water-exit',old.water,'water',CHEONGGYE_LEVELS.water);
      if(target&&target!==old?.surface)emit('surface-contact',target,roof?.surface??ground.surface);
      actors.set(actor.id,{water:wet?.id??'',surface:target,time});if(actors.size>256)actors.delete(actors.keys().next().value!);return events;
    },
    forgetActor(id){actors.delete(id);},
    dispose(){if(disposed)return;disposed=true;actors.clear();trees.dispose();gwanghwamun.dispose();landmarks.dispose();buildings.dispose();water.dispose();environment.dispose();root.removeFromParent();root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});materials.forEach(m=>m.dispose());root.clear();},
  };
}
