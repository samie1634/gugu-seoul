import {
  BufferGeometry, Float32BufferAttribute, Group, Mesh, ShaderMaterial,
  UniformsLib, UniformsUtils, Vector2, Vector4,
} from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { MapQuality, WaterConfig } from '../contracts.ts';
import { bands, riverFragment, riverVertex, RIPPLE_LIFETIME } from './surface.ts';

const TAU = 2 * Math.PI;
const MAX_COORDINATE = 16_384;
const MIN_SIZE = 0.02;
const MAX_CURRENT = 25;
const MIRROR_WIDTH = 512;
const MIRROR_HEIGHT = 256;

interface Impact { x: number; z: number; time: number; strength: number; order: number }

function checkConfig(w: WaterConfig) {
  const { minX, maxX, minZ, maxZ, y, bedY, flowX, flowZ, flowSpeed } = w;
  const coordinates = [minX, maxX, minZ, maxZ, y, bedY];
  if (coordinates.some(v => !Number.isFinite(v) || Math.abs(v) > MAX_COORDINATE)
    || maxX - minX < MIN_SIZE || maxZ - minZ < MIN_SIZE || y - bedY < MIN_SIZE) {
    throw new RangeError('Invalid river bounds or depth in metres');
  }
  const scale = Math.max(Math.abs(flowX), Math.abs(flowZ));
  if (!Number.isFinite(scale) || !Number.isFinite(flowSpeed)
    || flowSpeed < 0 || flowSpeed > MAX_CURRENT || (scale === 0 && flowSpeed > 0)) {
    throw new RangeError('Invalid river current in metres per second');
  }
  const sx = scale > 0 ? flowX / scale : 1;
  const sz = scale > 0 ? flowZ / scale : 0;
  const length = Math.hypot(sx, sz);
  const axis = new Vector2(sx / length, sz / length);
  return {
    minX, maxX, minZ, maxZ, y, depth: y - bedY, axis,
    flow: axis.clone().multiplyScalar(flowSpeed), speed: flowSpeed,
  };
}

/** Evaluate each periodic phase independently so large clocks never reach GLSL. */
function phaseAt(time: number, rate: number, seed: number): number {
  if (rate === 0) return seed;
  const angle = (seed + (time % (TAU / Math.abs(rate))) * rate) % TAU;
  return angle < 0 ? angle + TAU : angle;
}

/** The root stays at the map origin. Times are absolute simulation seconds. */
export function createRiverWater(config: WaterConfig, quality: MapQuality = 'mobile') {
  const { minX, maxX, minZ, maxZ, y, depth, axis, flow, speed } = checkConfig(config);
  const desktop = quality === 'desktop';
  const capacity = desktop ? 8 : 4;
  const bandCount = desktop ? bands.length : 3;
  const phaseRates = bands.slice(0, bandCount).map(({ along, drift }) => drift - along * speed);
  const impacts: Impact[] = Array.from({ length: capacity }, () => ({ x: 0, z: 0, time: 0, strength: 0, order: 0 }));
  const program = {
    name: 'cheonggyecheon:surface',
    vertexShader: riverVertex(desktop),
    fragmentShader: riverFragment(desktop, bandCount, capacity),
    uniforms: {
      ...UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog]),
      uBounds: { value: new Vector4(minX, maxX, minZ, maxZ) },
      uDepth: { value: depth },
      uAxis: { value: axis },
      uFlow: { value: flow },
      uPhase: { value: new Float32Array(bandCount) },
      uImpact: { value: new Float32Array(capacity * 4) },
      uImpactCount: { value: 0 },
    },
  };

  // Reflector expects a local XY plane facing +Z. Rotate it onto the exact water level.
  const hw = (maxX - minX) * 0.5;
  const hd = (maxZ - minZ) * 0.5;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-hw, hd, 0, hw, hd, 0, -hw, -hd, 0, hw, -hd, 0], 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setIndex([0, 2, 1, 2, 3, 1]);
  geometry.computeBoundingSphere();

  const reflector = desktop ? new Reflector(geometry, {
    textureWidth: MIRROR_WIDTH, textureHeight: MIRROR_HEIGHT, multisample: 0, clipBias: 0.001,
    shader: {
      ...program,
      uniforms: {
        ...program.uniforms,
        tDiffuse: { value: null }, color: { value: null }, textureMatrix: { value: null },
        uMirrorActive: { value: 0 },
      },
    },
  }) : null;
  const mesh = reflector ?? new Mesh(geometry, new ShaderMaterial(program));
  const material = mesh.material as ShaderMaterial;
  material.lights = true;
  material.fog = true;
  const phases = material.uniforms.uPhase.value as Float32Array;
  const impactData = material.uniforms.uImpact.value as Float32Array;
  const impactCount = material.uniforms.uImpactCount as { value: number };
  if (reflector) {
    const renderMirror = reflector.onBeforeRender;
    const mirrorActive = material.uniforms.uMirrorActive;
    reflector.onBeforeRender = function (...args) {
      const [renderer, , camera] = args;
      // Half-float color attachments are optional. Too close to the plane, use the same
      // stable analytical reflection as mobile instead of an ill-conditioned clip plane.
      const above = camera.matrixWorld.elements[13] - y;
      const useMirror = Number.isFinite(above) && above > 0.06
        && renderer.extensions.has('EXT_color_buffer_float');
      if (useMirror) renderMirror.apply(this, args);
      mirrorActive.value = useMirror ? 1 : 0;
      material.uniformsNeedUpdate = true;
    };
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((minX + maxX) * 0.5, y, (minZ + maxZ) * 0.5);
  mesh.name = 'cheonggyecheon:water';
  mesh.receiveShadow = true;
  const root = new Group();
  root.name = 'cheonggyecheon:river';
  root.add(mesh);

  let lastTime = -1;
  let order = 0;
  let disposed = false;
  for (let i = 0; i < bandCount; i++) phases[i] = bands[i].seed;

  function uploadImpacts(now: number) {
    let next = 0;
    for (let i = 0; i < capacity; i++) {
      const impact = impacts[i];
      if (impact.strength <= 0) continue;
      const age = now - impact.time;
      if (age < 0) continue;
      if (age >= RIPPLE_LIFETIME) {
        impact.strength = 0;
        continue;
      }
      const offset = 4 * next++;
      impactData[offset] = impact.x;
      impactData[offset + 1] = impact.z;
      impactData[offset + 2] = age;
      impactData[offset + 3] = impact.strength;
    }
    if (next < impactCount.value) impactData.fill(0, next * 4, impactCount.value * 4);
    impactCount.value = next;
    material.uniformsNeedUpdate = true;
  }

  return {
    root,
    update(time: number) {
      if (disposed || !Number.isFinite(time) || time < 0 || time === lastTime) return;
      if (time < lastTime) {
        // A replay/reset must not bring contacts from the former timeline back.
        for (let i = 0; i < capacity; i++) impacts[i].strength = 0;
        order = 0;
      }
      lastTime = time;
      for (let i = 0; i < bandCount; i++) phases[i] = phaseAt(time, phaseRates[i], bands[i].seed);
      uploadImpacts(time);
    },
    addRipple(x: number, z: number, time: number, strength = 0.8) {
      if (disposed || !Number.isFinite(x) || !Number.isFinite(z)
        || x < minX || x > maxX || z < minZ || z > maxZ
        || !Number.isFinite(time) || time < 0 || lastTime - time >= RIPPLE_LIFETIME
        || !Number.isFinite(strength) || strength <= 0) return;

      // Reuse an empty slot, otherwise evict the earliest contact.
      let slot = impacts[0];
      for (let i = 0; i < capacity; i++) {
        const impact = impacts[i];
        if (impact.strength === 0) {
          slot = impact;
          break;
        }
        if (impact.time < slot.time || (impact.time === slot.time && impact.order < slot.order)) slot = impact;
      }
      if (slot.strength > 0 && time < slot.time) return;
      slot.x = x;
      slot.z = z;
      slot.time = time;
      slot.strength = Math.min(1, strength);
      slot.order = ++order;
      if (lastTime >= 0) uploadImpacts(lastTime);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      root.clear();
      impactCount.value = 0;
      impactData.fill(0);
      geometry.dispose();
      if (reflector) reflector.dispose();
      else material.dispose();
    },
  };
}
