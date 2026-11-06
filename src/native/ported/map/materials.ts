import * as THREE from 'three';
import type { MapLayout } from './contracts.ts';
import { sejongRoad } from './layout.ts';

export type MaterialKey = 'paving' | 'masonry' | 'concrete' | 'wood' | 'roof' | 'metal' | 'glass' | 'foliage';
const rgb=(hex:string)=>{const c=new THREE.Color(hex);return `vec3(${c.r.toFixed(7)},${c.g.toFixed(7)},${c.b.toFixed(7)})`;};

/** Paint roads into the single terrain surface: no coplanar road/plaza/decal meshes. */
function pavingShader(layout?:MapLayout):string{
  const reference=layout?.proportions!=='legacy-compressed';
  const avenue=layout?sejongRoad(layout):{minX:19,maxX:49,laneCentres:[22.625,25.875,29.125,32.375,35.625,38.875,42.125,45.375]};
  const plazaMin=reference?-59:-94;
  return `
    if(abs(vMapWorld.y)<0.002){
      vec2 q=vMapWorld.xz;
      bool plaza=q.x>=${plazaMin.toFixed(1)} && q.x<=1.0 && q.y>=-372.0 && q.y<=185.0;
      bool court=q.x>=470.0 && q.x<=570.0 && q.y>=258.0 && q.y<=335.0;
      bool woldae=${reference?'true':'false'} && abs(q.x+12.0)<=14.85 && q.y>=-424.65 && q.y<=-375.95;
      bool avenue=q.x>=${avenue.minX.toFixed(3)} && q.x<=${avenue.maxX.toFixed(3)} && q.y>=${reference?'-380.0':'-530.0'} && q.y<=395.0;
      bool jongno=q.x>=-591.0 && q.x<=659.0 && abs(q.y-225.0)<=20.0;
      bool sajik=q.x>=-281.0 && q.x<=349.0 && abs(q.y+395.0)<=15.0 && !woldae;
      if(plaza || court || woldae){
        diffuseColor.rgb=${rgb('#cbc8bd')};
        vec2 cell=abs(fract((q+vec2(59.0,372.0))/5.5+0.5)-0.5)*5.5;
        float edge=min(cell.x,cell.y);
        float seam=1.0-smoothstep(0.012,0.012+max(fwidth(q.x),fwidth(q.y)),edge);
        diffuseColor.rgb*=1.0-seam*0.12;
      }
      if(avenue || jongno || sajik){
        diffuseColor.rgb=${rgb('#454d4f')};
        float paint=0.0;
        if(avenue){
          ${avenue.laneCentres.slice(1).map((x,i)=>(x+avenue.laneCentres[i])/2).filter(x=>Math.abs(x-34)>0.5).map(x=>`paint=max(paint,(1.0-smoothstep(0.105,0.105+fwidth(q.x),abs(q.x-${x.toFixed(4)})))*step(mod(q.y+530.0,16.0),6.8));`).join('\n')}
          float crossing=max(1.0-step(4.0,abs(q.y-193.0)),max(1.0-step(4.0,abs(q.y-253.0)),1.0-step(4.0,abs(q.y+376.0))));
          paint=max(paint,crossing*(1.0-step(2.2,mod(q.x-${avenue.minX.toFixed(3)},4.0))));
        }
        if(jongno){paint=max(paint,(1.0-smoothstep(0.14,0.14+fwidth(q.y),abs(q.y-225.0)))*step(mod(q.x+591.0,16.0),6.8));}
        diffuseColor.rgb=mix(diffuseColor.rgb,${rgb('#d4d2c8')},paint);
      }
    }
  `;
}

/** All grain, mortar and roof striations are original world-space procedural patterns. */
export function createMapMaterials(layout?:MapLayout): Record<MaterialKey, THREE.MeshStandardMaterial> {
  const material = (name: MaterialKey, roughness: number, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
    m.name = `map:${name}`;
    if(name==='roof')m.side=THREE.DoubleSide;
    if (name !== 'glass' && name !== 'metal' && name !== 'foliage') {
      m.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMapWorld;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMapWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMapWorld;\nfloat mapHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}')
          .replace('#include <color_fragment>', `#include <color_fragment>
            ${name==='paving'?pavingShader(layout):''}
            float grain = mapHash(floor(vMapWorld * 9.0));
            float grainFade = 1.0-smoothstep(0.08,0.35,max(length(dFdx(vMapWorld)),length(dFdy(vMapWorld))));
            diffuseColor.rgb *= 1.0 + (grain-0.5) * 0.07 * grainFade;
            ${name === 'masonry' ? `
              float course = abs(fract(vMapWorld.y / 0.55) - 0.5);
              float joint = smoothstep(0.475, 0.495, course);
              vec3 worldNormal = normalize(cross(dFdx(vMapWorld),dFdy(vMapWorld)));
              float upright = 1.0 - abs(worldNormal.y);
              diffuseColor.rgb *= 1.0 - joint * upright * 0.09;
            ` : name === 'roof' ? `
              float tileFade = 1.0-smoothstep(0.25,1.5,fwidth(vMapWorld.x)*13.5);
              float tiles = sin(vMapWorld.x * 13.5)*tileFade;
              diffuseColor.rgb *= 0.985 + tiles * 0.045;
            ` : name === 'wood' ? `
              diffuseColor.rgb *= 0.97 + 0.025 * sin(vMapWorld.x * 8.0 + sin(vMapWorld.y * 2.0));
            ` : ''}`);
      };
      m.customProgramCacheKey = () => `gugu-map-original-${name}-${layout?.proportions??'reference-scale'}-v3`;
    }
    return m;
  };
  return {
    paving: material('paving',0.94), masonry: material('masonry', 0.89), concrete: material('concrete', 0.91), wood: material('wood', 0.76),
    roof: material('roof', 0.74), metal: material('metal', 0.35, 0.65), glass: material('glass', 0.19, 0.32), foliage: material('foliage', 0.94),
  };
}
