import * as THREE from 'three';
import type { MapLayout } from '../contracts.ts';

export type TerrainKind = 'ground' | 'road' | 'path' | 'bridge';
export const TERRAIN_DETAIL_CODES: Readonly<Record<TerrainKind, number>> = Object.freeze({
  ground: 0, road: 1, path: 2, bridge: 3,
});

/** Add only a per-vertex material selector. Coordinates, triangles and normals stay intact. */
export function withTerrainDetail(geometry: THREE.BufferGeometry, kind: TerrainKind): THREE.BufferGeometry {
  const values = new Uint8Array(geometry.getAttribute('position').count);
  values.fill(TERRAIN_DETAIL_CODES[kind]);
  geometry.setAttribute('terrainKind', new THREE.BufferAttribute(values, 1));
  return geometry;
}

// Original shader artwork only. These are material-scale patterns, not surveyed
// paving joints, road markings, land-cover boundaries, or imagery-derived features.
const groundFunctions = `
varying vec2 vTerrainWorld;
varying float vTerrainKind;
float terrainHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float terrainNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), f.x),
    mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0)), f.x), f.y);
}
float terrainResolve(float footprint, float size) {
  return 1.0 - smoothstep(size * 0.25, size * 0.8, footprint);
}
`;

function surfaceShader(quality: MapLayout['quality']): string {
  return `
    vec2 terrainP = vTerrainWorld;
    // Derivatives are evaluated before material branches. Each triangle has one
    // selector, and oblique/far surfaces fade before details become sub-pixel.
    float terrainPixel = max(max(length(dFdx(terrainP)), length(dFdy(terrainP))), 0.00001);
    float terrainFine = terrainResolve(terrainPixel, 0.045);
    float terrainMedium = terrainResolve(terrainPixel, 0.25);
    float terrainLarge = terrainResolve(terrainPixel, 1.2);
    float terrainRoughness = 0.94;
    if (terrainLarge > 0.001) {
      float mottling = terrainNoise(terrainP * 0.8) - 0.5;
      diffuseColor.rgb *= 1.0 + mottling * 0.045 * terrainLarge;
    }
    if (vTerrainKind > 0.5 && vTerrainKind < 1.5) {
      // Asphalt aggregate: centimetre-scale stones, not invented lane paint.
      if (terrainMedium > 0.001) {
        float aggregate = terrainHash(floor(terrainP * 13.0)) - 0.5;
        diffuseColor.rgb *= 1.0 + aggregate * 0.12 * terrainMedium;
      }
      if (terrainFine > 0.001) {
        float grit = terrainHash(floor(terrainP * 56.0));
        diffuseColor.rgb *= 1.0 + (grit - 0.5) * 0.22 * terrainFine;
      }
      terrainRoughness = 0.96;
    } else if (vTerrainKind > 1.5) {
      // 60 x 40 cm staggered paving, with filtered 9 mm joints. Bridge deck
      // blocks are larger. Both use the existing polygon's original colour.
      vec2 slabSize = vTerrainKind > 2.5 ? vec2(1.2, 0.8) : vec2(0.6, 0.4);
      float slabFade = terrainResolve(terrainPixel, slabSize.y);
      if (slabFade > 0.001) {
        vec2 cell = terrainP / slabSize;
        cell.x += mod(floor(cell.y), 2.0) * 0.5;
        vec2 edge = min(fract(cell), 1.0 - fract(cell)) * slabSize;
        float joint = 1.0 - smoothstep(0.0045, 0.0045 + terrainPixel, min(edge.x, edge.y));
        float stone = terrainHash(floor(cell)) - 0.5;
        diffuseColor.rgb *= 1.0 + (stone * 0.09 - joint * 0.21) * slabFade;
      }
      if (terrainFine > 0.001) {
        diffuseColor.rgb *= 1.0 + (terrainHash(floor(terrainP * 43.0)) - 0.5) * 0.08 * terrainFine;
      }
      terrainRoughness = 0.89;
    } else {
      // Preserve the existing generic green/earth ground. No new grass plots
      // or plant positions are inferred where the source has no land cover.
      if (terrainMedium > 0.001) {
        float earth = terrainHash(floor(terrainP * 10.0)) - 0.5;
        diffuseColor.rgb *= 1.0 + earth * 0.10 * terrainMedium;
      }
      if (terrainFine > 0.001) {
        float grit = terrainHash(floor(terrainP * 38.0)) - 0.5;
        diffuseColor.rgb *= 1.0 + grit * 0.12 * terrainFine;
        ${quality === 'desktop' ? `
        vec2 bladeCell = terrainP * vec2(17.0, 7.0);
        float tilt = terrainHash(floor(bladeCell)) - 0.5;
        vec2 blade = fract(bladeCell) - 0.5;
        float strand = (1.0 - smoothstep(0.035, 0.17, abs(blade.x + blade.y * tilt)))
          * (1.0 - smoothstep(0.18, 0.48, abs(blade.y)));
        diffuseColor.rgb *= 1.0 + (strand - 0.13) * 0.13 * terrainFine;
        ` : ''}
      }
      terrainRoughness = 0.98;
    }
  `;
}

/** One material, no image textures, no new passes, no displacement or extra meshes. */
export function createTerrainDetailMaterial(quality: MapLayout['quality']): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, side: THREE.FrontSide });
  material.name = 'osm:original-ground-detail';
  material.userData.detailBudget = {
    textureBytes: 0, addedDrawCalls: 0, addedTriangles: 0,
    selectorBytesPerVertex: 1, grassStrands: quality === 'desktop',
  };
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float terrainKind;\nvarying vec2 vTerrainWorld;\nvarying float vTerrainKind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xz;\nvTerrainKind = terrainKind;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${groundFunctions}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${surfaceShader(quality)}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = terrainRoughness;');
  };
  material.customProgramCacheKey = () => `osm-original-ground-detail-v1-${quality}`;
  return material;
}
