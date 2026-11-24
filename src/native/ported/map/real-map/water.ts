import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { MapQuality } from '../contracts.ts';
import { createReflectionEnvironment, REFLECTION_ENVIRONMENT_GLSL, type ReflectionEnvironment } from './reflection-environment.ts';
import { limitWaterReflection, WATER_MIRROR_BUDGET } from './water-reflection.ts';
import { WATER_DISTANCE_STYLE } from './water-distance.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bands, riverVertex, riverFragment, RIPPLE_LIFETIME } from '../water/surface.ts';
import { CHEONGGYE_LEVELS, channelWaterAreas } from './cheonggye-channel.ts';
import { polygonGeometry, diskInside, polygonContains, footprintBounds } from './geometry.ts';

const TAU = Math.PI * 2;
const BED_Y = CHEONGGYE_LEVELS.bed;
const WATER_Y = CHEONGGYE_LEVELS.water;
const waters = channelWaterAreas;
const areas = waters.map(s => ({ rings: s.rings, bounds: footprintBounds(s.rings) }));
const phaseAt = (time: number, rate: number, seed: number) =>
  ((seed + time % (TAU / Math.abs(rate)) * rate) % TAU + TAU) % TAU;
const isWet = (x: number, z: number) => areas.some(a => polygonContains(a.rings, x, z));

/** OSM outlines and bridge cutouts; depth and underwater art are illustrative, not surveyed. */
export function createPolygonWater(quality:MapQuality='mobile',providedEnvironment?:ReflectionEnvironment) {
  const environment=providedEnvironment??createReflectionEnvironment(quality);
  const planar=quality==='desktop';
  const root = new THREE.Group();
  root.name = 'cheonggyecheon:polygon-river';
  root.userData.depthStatus = 'visual_estimate_not_surveyed';
  root.userData.reflectionPasses = planar?1:0;
  root.userData.activeReflectionPasses=0;
  root.userData.reflectionBudget = planar?WATER_MIRROR_BUDGET:null;
  root.userData.reflectionDescription='Nearby desktop scene capture; distance-strengthened sky and cloud reflection across the map';
  root.userData.distantSkyReflection={...WATER_DISTANCE_STYLE,extraPasses:0};
  const combined = (y: number) => {
    const pieces = waters.map(s => polygonGeometry(s.rings, y));
    const result = mergeGeometries(pieces);
    pieces.forEach(g => g.dispose());
    if (!result) throw new Error('Cannot combine polygon water geometry');
    return result;
  };
  const phases = new Float32Array(3);
  const impactData = new Float32Array(16);
  const uniforms = {
    ...environment.uniforms,
    ...THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]),
    uBounds: { value: new THREE.Vector4(
      Math.min(...areas.map(a => a.bounds.minX)), Math.max(...areas.map(a => a.bounds.maxX)),
      Math.min(...areas.map(a => a.bounds.minZ)), Math.max(...areas.map(a => a.bounds.maxZ))) },
    uDepth: { value: WATER_Y - BED_Y },
    uAxis: { value: new THREE.Vector2(1, 0) },
    uFlow: { value: new THREE.Vector2(0.35, 0) },
    uPhase: { value: phases }, uImpact: { value: impactData }, uImpactCount: { value: 0 },
  };
  let fragment=riverFragment(planar,3,4);
  fragment=REFLECTION_ENVIRONMENT_GLSL+fragment;
  // Small distant water polygons must not become a brown riverbed or invented
  // bank reflection when the nearby desktop capture switches to its sky fallback.
  fragment=fragment.replace('vec2 p = vWaterWorld.xz;', `vec2 p = vWaterWorld.xz;
  float farWater = smoothstep(${WATER_DISTANCE_STYLE.start.toFixed(1)}, ${WATER_DISTANCE_STYLE.end.toFixed(1)}, distance(cameraPosition, vWaterWorld));`);
  fragment=fragment.replace('vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));',
    `slope *= mix(1.0, ${WATER_DISTANCE_STYLE.waveScale.toFixed(2)}, farWater);\n  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));`);
  fragment=fragment.replace('vec3 sky = mix(vec3(0.49, 0.54, 0.51), vec3(0.22, 0.31, 0.37), sqrt(clamp(ray.y, 0.0, 1.0)));','vec3 sky = sampleSeoulEnvironment(ray,vWaterWorld,.17);');
  fragment=fragment.replace('vec3 reflected = mix(sky, vec3(0.084, 0.108, 0.091) * (1.0 + 0.25 * stone), horizon * bankFacing);','vec3 reflected = mix(sky, vec3(0.084,0.108,0.091)*(1.0+0.25*stone)*mix(.12,1.,uReflectionDaylight),horizon*bankFacing*(1.0-farWater));');
  // The old surface attenuated sky once with Fresnel and again with alpha.
  // Keep the submerged bed visible, but composite the reflected energy only once.
  fragment=fragment.replace('float fresnel = 0.0204 + 0.9796 * pow(1.0 - incidence, 5.0);',
    `float fresnel = max(0.08 + 0.92 * pow(1.0 - incidence, 4.0), mix(0.08, ${WATER_DISTANCE_STYLE.skyWeight.toFixed(2)}, farWater));\n  float waterOpacity = mix(0.52, 1.0, fresnel);`);
  fragment=fragment.replace('vec3 colour = mix(through * mix(0.43, 1.0, lit), reflected, fresnel);',
    'vec3 colour = mix(through * mix(0.43,1.0,lit)*mix(.12,1.,uReflectionDaylight),reflected,fresnel / waterOpacity);');
  fragment=fragment.replace('gl_FragColor = vec4(colour, mix(0.34, 0.9, fresnel));','gl_FragColor = vec4(colour, waterOpacity);');
  // A shadow at the water is not a shadow on the reflected sky. Captured objects
  // are already lit, so neither analytical nor planar reflection needs it twice.
  fragment=fragment.replace('reflected *= mix(0.33, 1.0, lit);','');
  fragment=fragment.replace('mirror * mix(0.78, 1.0, lit)','mirror');
  fragment=fragment.replace('uMirrorActive > 0.5','uMirrorActive > 0.001');
  fragment=fragment.replace('tilt * vec2(0.058, 0.074)','tilt * vec2(0.018, 0.026)');
  fragment=fragment.replace('vec3 mirror = texture2D(tDiffuse, clamp(uvDistorted, 0.002, 0.998)).rgb;',`vec2 mirrorUv=clamp(uvDistorted,.004,.996);vec2 texel=vec2(1./256.,1./128.);
    vec3 mirror=texture2D(tDiffuse,mirrorUv).rgb*.6+texture2D(tDiffuse,clamp(mirrorUv+texel,.004,.996)).rgb*.2+texture2D(tDiffuse,clamp(mirrorUv-texel,.004,.996)).rgb*.2;`);
  fragment=fragment.replace('0.83 * coverage','0.9 * coverage * uMirrorActive');
  const program={name:'cheonggyecheon:polygon-surface',uniforms,vertexShader:riverVertex(planar),fragmentShader:fragment};
  const geometry=combined(WATER_Y);
  const center=new THREE.Vector3((uniforms.uBounds.value.x+uniforms.uBounds.value.y)/2,WATER_Y,(uniforms.uBounds.value.z+uniforms.uBounds.value.w)/2);
  if(planar){geometry.translate(-center.x,-center.y,-center.z);geometry.rotateX(Math.PI/2);}
  const reflector=planar?new Reflector(geometry,{textureWidth:WATER_MIRROR_BUDGET.width,textureHeight:WATER_MIRROR_BUDGET.height,multisample:0,clipBias:.001,shader:{...program,uniforms:{...uniforms,tDiffuse:{value:null},color:{value:null},textureMatrix:{value:null},uMirrorActive:{value:0}}}}):null;
  const surface=reflector??new THREE.Mesh(geometry,new THREE.ShaderMaterial(program));
  const material=surface.material as THREE.ShaderMaterial;
  // Reflector clones its uniforms. Rebind the shared clock/phase/impact references.
  Object.assign(material.uniforms,uniforms);material.lights=true;material.fog=true;material.transparent=true;material.depthWrite=false;
  if(reflector){surface.position.copy(center);surface.rotation.x=-Math.PI/2;}
  surface.name = 'cheonggyecheon:water';
  surface.receiveShadow = true;
  const bed = new THREE.Mesh(combined(BED_Y), new THREE.MeshStandardMaterial({ color: '#696452', roughness: 1 }));
  bed.name = 'cheonggyecheon:bed';
  bed.receiveShadow = true;
  root.add(surface, bed);

  // Each instance's complete horizontal bounding disk must fit one clipped polygon.
  // Halton samples avoid rows and remain reproducible without global random state.
  const halton = (n: number, base: number) => {
    let value = 0, f = 1;
    while (n > 0) { f /= base; value += f * (n % base); n = Math.floor(n / base); }
    return value;
  };
  const samples = (count: number, margin: number, offset: number) => {
    const result: { x: number; z: number; area: typeof areas[number] }[] = [];
    for (let n = 1; n <= count * 300 && result.length < count; n++) {
      const area = areas[n % areas.length], b = area.bounds;
      const x = b.minX + halton(n + offset, 2) * (b.maxX - b.minX);
      const z = b.minZ + halton(n + offset, 3) * (b.maxZ - b.minZ);
      if (diskInside(area.rings, x, z, margin)) result.push({ x, z, area });
    }
    return result;
  };
  const stoneSites = samples(144, 0.31, 0), plantSites = samples(96, 0.08, 1100);
  const fishSites = samples(20, 0.8, 2200);
  const stones = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#777e76', roughness: 0.96 }), stoneSites.length);
  const plants = new THREE.InstancedMesh(new THREE.ConeGeometry(0.035, 1, 5),
    new THREE.MeshStandardMaterial({ color: '#536f5e', roughness: 0.93 }), plantSites.length);
  const fish = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6),
    new THREE.MeshStandardMaterial({ color: '#7e8584', roughness: 0.58, metalness: 0.1 }), fishSites.length);
  stones.name = 'cheonggyecheon:stones'; plants.name = 'cheonggyecheon:plants'; fish.name = 'cheonggyecheon:fish';
  fish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const transform = new THREE.Object3D();
  stoneSites.forEach((p, i) => {
    const s = 0.08 + i % 4 * 0.035;
    transform.position.set(p.x, BED_Y + s * 0.55, p.z);
    transform.scale.set(s * 1.5, s * 0.55, s); transform.rotation.set(0, i * 0.61, 0);
    transform.updateMatrix(); stones.setMatrixAt(i, transform.matrix);
  });
  plantSites.forEach((p, i) => {
    transform.position.set(p.x, BED_Y + 0.10, p.z);
    transform.scale.set(1, 0.18, 1); transform.rotation.set(0, i, (i % 3 - 1) * 0.16);
    transform.updateMatrix(); plants.setMatrixAt(i, transform.matrix);
  });
  root.add(stones, plants, fish);
  const impacts: { x: number; z: number; time: number; strength: number }[] = [];
  let lastTime = -1, disposed = false;
  const upload = (time: number) => {
    for (let i = impacts.length - 1; i >= 0; i--) if (time - impacts[i].time >= RIPPLE_LIFETIME) impacts.splice(i, 1);
    impactData.fill(0);
    let count = 0;
    for (const p of impacts) if (p.time <= time) impactData.set([p.x, p.z, time - p.time, p.strength], count++ * 4);
    uniforms.uImpactCount.value = count;
  };
  const update = (time: number) => {
    if (disposed || !Number.isFinite(time) || time < 0 || time === lastTime) return;
    if (time < lastTime) impacts.length = 0;
    lastTime = time;
    environment.update(time);
    bands.slice(0, 3).forEach((b, i) => { phases[i] = phaseAt(time, b.drift - b.along * 0.35, b.seed); });
    fishSites.forEach((p, i) => {
      const angle = phaseAt(time, 0.24, i);
      const x = p.x + Math.sin(angle) * 0.5, z = p.z + Math.cos(angle) * 0.5;
      // Validate even though the anchor's 0.8 m disk already contains the orbit.
      const valid = diskInside(p.area.rings, x, z, 0.16);
      transform.position.set(valid ? x : p.x, BED_Y + 0.16, valid ? z : p.z);
      transform.rotation.set(0, angle, 0); transform.scale.set(0.14, 0.04, 0.055);
      transform.updateMatrix(); fish.setMatrixAt(i, transform.matrix);
    });
    fish.instanceMatrix.needsUpdate = true;
    fish.computeBoundingSphere();
    upload(time);
  };
  if(reflector)limitWaterReflection(reflector,root,areas,WATER_Y,()=>Math.max(0,lastTime),()=>environment.uniforms.seoulPhotoReady.value);
  update(0);
  return {
    root, update,
    addRipple(x: number, z: number, time: number, strength = 0.8) {
      if (disposed || ![x, z, time, strength].every(Number.isFinite) || time < 0 || strength <= 0
        || lastTime - time >= RIPPLE_LIFETIME || !isWet(x, z)) return;
      if (impacts.length === 4) {
        impacts.sort((a, b) => a.time - b.time);
        if (time < impacts[0].time) return;
        impacts.shift();
      }
      impacts.push({ x, z, time, strength: Math.min(1, strength) }); upload(lastTime);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of [surface, bed, stones, plants, fish]) {
        mesh.geometry.dispose(); if(mesh!==reflector){if(Array.isArray(mesh.material))mesh.material.forEach(m=>m.dispose());else mesh.material.dispose();}
      }
      if(!providedEnvironment)environment.dispose();
      reflector?.dispose(); stones.dispose(); plants.dispose(); fish.dispose();
      impacts.length = 0; impactData.fill(0); uniforms.uImpactCount.value = 0;
      root.removeFromParent(); root.clear();
    },
  };
}
