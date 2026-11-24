import { isReplacedGwanghwamun } from './gwanghwamun.ts';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapQuality } from '../contracts.ts';
import type { RealPolygon } from './types.ts';
import { footprintBounds, polygonGeometry } from './geometry.ts';
import { buildingVisuals } from './visual-data.ts';
import { createReflectionEnvironment, REFLECTION_ENVIRONMENT_GLSL, type ReflectionEnvironment } from './reflection-environment.ts';
const PALETTE=['#d8bfa2','#c8c7bd','#c49177','#9daeb4','#c7b899','#b3bca8','#c9b5ab','#aeb7bc'];
export const BUILDING_LOD_METRES={desktop:240,mobile:170} as const;
export const BUILDING_CELL_METRES=128;
export function buildingPalette(b:RealPolygon){
  const source=buildingVisuals[b.id];let hash=2166136261;
  for(const c of b.sourceId)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  const valid=(value:string|null|undefined)=>!!value&&(/^#[\da-f]{6}$/i.test(value)||value.toLowerCase() in THREE.Color.NAMES);
  const wall=new THREE.Color(valid(source?.wallColor)?source.wallColor!:PALETTE[hash%PALETTE.length]);
  const roof=valid(source?.roofColor)?new THREE.Color(source.roofColor!):b.heightStatus.startsWith('unconfirmed')?wall.clone().multiplyScalar(.88):new THREE.Color(['#6e8584','#758a98','#8c8273','#6e7872'][hash%4]);
  return{wall,roof,trim:wall.clone().multiplyScalar(.77),glass:new THREE.Color('#547b88'),status:valid(source?.wallColor)||valid(source?.roofColor)?'osm_tag_unverified':'illustrative_palette_not_measured',wallStatus:valid(source?.wallColor)?'osm_tag_unverified':'illustrative_palette_not_measured',roofStatus:valid(source?.roofColor)?'osm_tag_unverified':'illustrative_palette_not_measured'};
}
function solidGeometry(b:RealPolygon,rings:number[][][],distant=false):THREE.BufferGeometry{
  // A 12cm unknown-height marker has no legible vertical detail at the far LOD.
  const marker=distant&&b.heightStatus.startsWith('unconfirmed');
  const geometry=polygonGeometry(rings,b.height,marker?undefined:b.minY),g=geometry.index?geometry.toNonIndexed():geometry;
  if(g!==geometry)geometry.dispose();g.deleteAttribute('uv');
  const p=g.getAttribute('position'),n=g.getAttribute('normal'),colors=new Float32Array(p.count*3),palette=buildingPalette(b);
  for(let i=0;i<p.count;i++){
    const roof=n.getY(i)>.6;
    const color=roof?palette.roof:n.getY(i)<-.6?palette.trim:palette.wall;
    // Subtle orientation contrast, not photogrammetry or measured façade colouring.
    const shade=roof?1:Math.abs(n.getX(i))>.7?.92:1;
    colors[i*3]=color.r*shade;colors[i*3+1]=color.g*shade;colors[i*3+2]=color.b*shade;
  }
  g.setAttribute('color',new THREE.BufferAttribute(colors,3));
  return g;
}

function merged(pieces:THREE.BufferGeometry[],x:number,z:number):THREE.BufferGeometry{
  const g=mergeGeometries(pieces)!;pieces.forEach(p=>p.dispose());g.translate(-x,0,-z);g.computeBoundingSphere();g.computeBoundingBox();return g;
}
/** Chunk LODs allow frustum culling. Far meshes omit façade shading and tiny marker walls, and use topology-preserving outlines. */
export function createBuildingLods(buildings:RealPolygon[],quality:MapQuality,providedEnvironment?:ReflectionEnvironment) {
  const environment=providedEnvironment??createReflectionEnvironment(quality);
  const root=new THREE.Group();root.name='osm:buildings';root.userData.colorProvenance='OSM tags where present (unverified); otherwise illustrative, not measured';
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82,side:THREE.DoubleSide});
  const nearMaterial=material.clone();
  // Opaque shader approximation: tinted recesses suggest interior depth, not reconstructed
  // interiors or real transparent holes. No new geometry, refraction pass or sorted glass.
  root.userData.glassProvenance='Illustrative opaque glass shader; interior depth is an approximation, not reconstructed interiors or transparent holes';
  nearMaterial.onBeforeCompile=shader=>{
    shader.uniforms={...shader.uniforms,...environment.uniforms};
    shader.vertexShader='varying vec3 vBuildingWorld; varying vec3 vBuildingNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBuildingWorld=(modelMatrix*vec4(position,1.0)).xyz; vBuildingNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader=`varying vec3 vBuildingWorld; varying vec3 vBuildingNormal;
      ${REFLECTION_ENVIRONMENT_GLSL}
      float facadeHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float glassPane=0.0; float glassVariation=0.0; vec2 glassLocal=vec2(0.5);
      vec3 glassNormal=normalize(vBuildingNormal); vec3 glassTangent=vec3(1.0,0.0,0.0);
      if(abs(glassNormal.y)<0.25){
        vec2 tangent=normalize(vec2(-glassNormal.z,glassNormal.x));
        glassTangent=vec3(tangent.x,0.0,tangent.y);
        vec2 uv=vec2(dot(vBuildingWorld.xz,tangent)/4.4,vBuildingWorld.y/3.8);
        vec2 footprint=fwidth(uv); vec2 local=fract(uv);
        vec2 aa=max(footprint,vec2(0.001));
        float detailFade=1.0-smoothstep(.18,.5,max(footprint.x,footprint.y));
        vec2 a=smoothstep(vec2(.20),vec2(.20)+aa,local);
        vec2 b=1.0-smoothstep(vec2(.70)-aa,vec2(.70),local);
        glassPane=a.x*b.x*a.y*b.y*detailFade;
        vec2 outerA=smoothstep(vec2(.17),vec2(.17)+aa,local);
        vec2 outerB=1.0-smoothstep(vec2(.73)-aa,vec2(.73),local);
        float frame=max(0.0,outerA.x*outerB.x*outerA.y*outerB.y*detailFade-glassPane);
        // Recess top shadow and bottom bevel are analytic shading, not added geometry.
        float bevel=mix(.40,.70,smoothstep(.2,.7,local.y));
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*bevel,frame);
        glassVariation=facadeHash(floor(uv)+glassNormal.xz*17.0);
        glassLocal=(local-vec2(.20))/.50;
        vec3 paneTint=mix(vec3(.048,.094,.110),vec3(.075,.135,.148),glassVariation);
        diffuseColor.rgb=mix(diffuseColor.rgb,paneTint,glassPane);
      }`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=mix(roughnessFactor,mix(.13,.22,glassVariation),glassPane);`);
    // outgoingLight only exists after the lighting chunks; keep tone mapping/fog downstream.
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      if(glassPane>0.001){
        vec3 viewDelta=cameraPosition-vBuildingWorld;
        vec3 viewDir=viewDelta/max(length(viewDelta),0.0001);
        vec3 worldNormal=glassNormal;
        if(dot(worldNormal,viewDir)<0.0)worldNormal=-worldNormal;
        float facing=clamp(dot(worldNormal,viewDir),0.0,1.0);
        float fresnel=.04+.96*pow(1.0-facing,5.0);
        float roughness=mix(.13,.22,glassVariation);
        vec3 reflected=sampleSeoulEnvironment(reflect(-viewDir, worldNormal),vBuildingWorld,roughness);
        // Bounded view-dependent recess offset mimics a shallow dark room behind tinted glass.
        vec2 parallax=vec2(dot(viewDir,glassTangent),viewDir.y)/max(facing,.22)*.12;
        vec2 interiorUV=glassLocal-parallax;
        vec2 recess=smoothstep(vec2(.04),vec2(.20),interiorUV)*(1.0-smoothstep(vec2(.80),vec2(.96),interiorUV));
        float depth=recess.x*recess.y;
        float daylight=clamp(uReflectionDaylight,0.0,1.0);
        vec3 interior=mix(vec3(.006,.012,.017),vec3(.025,.049,.055),depth)*(0.25+daylight*.75);
        float warmRoom=step(.86,glassVariation)*(1.0-daylight)*depth;
        interior+=vec3(.16,.095,.038)*warmRoom;
        vec3 glassEnergy=interior*(1.0-fresnel)+reflected*fresnel;
        outgoingLight=mix(outgoingLight,glassEnergy+outgoingLight*.08*(1.0-fresnel),glassPane);
      }
      #include <opaque_fragment>`);
  };
  nearMaterial.customProgramCacheKey=()=> 'osm-illustrative-glass-v2';
  const chunks=new Map<string,RealPolygon[]>();
  for(const b of buildings){if(isReplacedGwanghwamun(b))continue;const a=footprintBounds(b.rings),key=`${Math.floor((a.minX+a.maxX)/2/BUILDING_CELL_METRES)}:${Math.floor((a.minZ+a.maxZ)/2/BUILDING_CELL_METRES)}`;const list=chunks.get(key)??[];list.push(b);chunks.set(key,list);}
  let nearTriangles=0,farTriangles=0;
  for(const[key,list]of chunks){
    const [ix,iz]=key.split(':').map(Number),x=(ix+.5)*BUILDING_CELL_METRES,z=(iz+.5)*BUILDING_CELL_METRES;
    const near=merged(list.map(b=>solidGeometry(b,b.rings)),x,z);
    const far=merged(list.map(b=>solidGeometry(b,buildingVisuals[b.id]?.rings??b.rings,true)),x,z);
    nearTriangles+=near.getAttribute('position').count/3;farTriangles+=far.getAttribute('position').count/3;
    const lod=new THREE.LOD();lod.name=`osm:building-cell:${key}`;lod.position.set(x,0,z);
    const close=new THREE.Mesh(near,nearMaterial);close.name=lod.name+':near';close.castShadow=true;close.receiveShadow=true;
    const distant=new THREE.Mesh(far,material);distant.name=lod.name+':far';distant.castShadow=false;distant.receiveShadow=false;
    lod.addLevel(close,0);lod.addLevel(distant,BUILDING_LOD_METRES[quality],.12);root.add(lod);
  }
  return{root,nearTriangles,farTriangles,chunks:chunks.size,dispose(){if(!providedEnvironment)environment.dispose();root.removeFromParent();root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});nearMaterial.dispose();material.dispose();root.clear();}};
}
