import * as THREE from 'three';
import type { Vec3 } from './ported/motion/locomotion/b2/contracts.ts';

const BURSTS = 4, DROPS = 16, LIFE = 0.8;

/** One bounded draw call, shared buffers, and no textures or per-frame allocation. */
export function createWaterSplash(parent: THREE.Object3D) {
  const positions = new Float32Array(BURSTS * DROPS * 3);
  const alphas = new Float32Array(BURSTS * DROPS);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `attribute float alpha; varying float vAlpha;
      void main() {
        vAlpha = alpha;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(30.0 / max(0.5, -viewPosition.z), 2.0, 7.0);
      }`,
    fragmentShader: `varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5 || vAlpha <= 0.0) discard;
        gl_FragColor = vec4(0.72, 0.91, 1.0, vAlpha * (1.0 - smoothstep(0.3, 0.5, radius)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'player-water-splash'; points.frustumCulled = false; points.visible = false; parent.add(points);
  const bursts = Array.from({ length: BURSTS }, () => ({ x: 0, y: 0, z: 0, time: -Infinity, strength: 0 }));
  let next = 0, spawned = 0, lastTime = -Infinity, disposed = false;
  function clear() {
    for (const burst of bursts) burst.time = -Infinity;
    alphas.fill(0); geometry.attributes.alpha.needsUpdate = true; points.visible = false;
  }
  return {
    add(at: Vec3, time: number, strength = 0.7): boolean {
      if (disposed || ![at.x, at.y, at.z, time, strength].every(Number.isFinite) || time < 0) return false;
      const burst = bursts[next++ % BURSTS];
      burst.x = at.x; burst.y = at.y; burst.z = at.z; burst.time = time;
      burst.strength = Math.max(0.2, Math.min(1, strength)); spawned++;
      this.update(time); return true;
    },
    update(time: number) {
      if (disposed || !Number.isFinite(time) || time < 0) return;
      if (time < lastTime) clear();
      lastTime = time; let visible = false;
      for (let b = 0; b < BURSTS; b++) {
        const burst = bursts[b], age = time - burst.time;
        for (let i = 0; i < DROPS; i++) {
          const index = b * DROPS + i, offset = index * 3;
          const angle = i * (Math.PI * 2 / DROPS) + b * 0.6;
          const speed = (0.42 + (i % 4) * 0.16) * burst.strength;
          const height = (1.1 + (i % 3) * 0.3) * age - 3.4 * age * age;
          const active = age >= 0 && age < LIFE && height >= 0;
          alphas[index] = active ? 0.85 * (1 - age / LIFE) : 0;
          if (!active) continue;
          positions[offset] = burst.x + Math.sin(angle) * speed * age;
          positions[offset + 1] = burst.y + 0.015 + height;
          positions[offset + 2] = burst.z + Math.cos(angle) * speed * age;
          visible = true;
        }
      }
      geometry.attributes.position.needsUpdate = true; geometry.attributes.alpha.needsUpdate = true;
      points.visible = visible;
    },
    clear,
    snapshot() { return { spawned, visible: points.visible, maxParticles: BURSTS * DROPS, activeParticles: alphas.reduce((n, a) => n + (a > 0 ? 1 : 0), 0) }; },
    dispose() { if (disposed) return; disposed = true; clear(); points.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
