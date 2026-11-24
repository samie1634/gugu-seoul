import * as THREE from 'three';

export interface VehicleFeatherHit {
  readonly id: string;
  /** Committed simulation time in seconds, never wall-clock time. */
  readonly time: number;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly velocity: Readonly<{ x: number; y: number; z: number }>;
  readonly groundY: number;
}
export interface VehicleFeatherOptions {
  readonly quality: 'mobile' | 'desktop';
  readonly reducedMotion?: boolean;
}

const BURSTS = 4, HISTORY = 128, DRAG = 2.2, TERMINAL = 1.15;
const palette = ['#dddeda', '#b8bfbd', '#889394', '#e6e5df'];
type Feather = {
  burst: number; born: number; life: number; landAt: number; size: number; phase: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number; ground: number;
  px: number; py: number; pz: number; alpha: number; settled: boolean;
};
const travel = (time: number) => -Math.expm1(-DRAG * time) / DRAG;
const height = (feather: Feather, time: number) => feather.y + (feather.vy + TERMINAL) * travel(time) - TERMINAL * time;

/** A notched vane, pale central quill and fine barbs, all in one shared geometry. */
function featherGeometry() {
  const positions: number[] = [], colors: number[] = [];
  const add = (x: number, y: number, z: number, shade: number) => { positions.push(x, y, z); colors.push(shade, shade, shade); };
  const edge = [[0, -.34], [-.09, -.24], [-.06, -.23], [-.145, -.07], [-.095, -.09], [-.16, .09], [-.11, .07], [-.14, .26], [-.085, .23], [-.07, .39], [0, .5], [.09, .38], [.1, .24], [.16, .27], [.125, .09], [.18, .12], [.12, -.06], [.16, -.04], [.07, -.23], [.11, -.21]];
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i], b = edge[(i + 1) % edge.length];
    add(0, 0, 0, .92); add(a[0], a[1], 0, .76); add(b[0], b[1], 0, .8);
  }
  for (const [x, y] of [[-.008, -.62], [.008, -.62], [.005, .45], [-.008, -.62], [.005, .45], [-.005, .45]]) add(x, y, .003, 1);
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const y = -.17 + i * .13, width = i === 3 ? .07 : .11;
    add(0, y - .006, .004, .98); add(side * width, y + .08, .004, .88); add(0, y + .006, .004, .98);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function prefersReducedMotion() {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** One draw call and fixed-size pools. Call burst only after the collision frame commits. */
export function createVehicleFeathers(parent: THREE.Object3D, options: VehicleFeatherOptions) {
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();
  const perBurst = reducedMotion ? 6 : options.quality === 'mobile' ? 24 : 40;
  const capacity = BURSTS * perBurst, geometry = featherGeometry();
  const alphas = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('featherAlpha', alphas);
  const material = new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute float featherAlpha;
      varying vec3 featherColor; varying float featherOpacity;
      void main() {
        featherColor = color * instanceColor;
        featherOpacity = featherAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 featherColor; varying float featherOpacity;
      void main() {
        if (featherOpacity <= 0.0) discard;
        gl_FragColor = vec4(featherColor, featherOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const root = new THREE.InstancedMesh(geometry, material, capacity);
  root.name = 'player-vehicle-feathers'; root.frustumCulled = false; root.visible = false;
  root.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const transform = new THREE.Object3D(), landing = new THREE.Quaternion(), color = new THREE.Color();
  const landingRotation = new THREE.Euler();
  const feathers: Feather[] = Array.from({ length: capacity }, (_, index) => {
    root.setColorAt(index, color.set(palette[index % palette.length]));
    return { burst: Math.floor(index / perBurst), born: -Infinity, life: 0, landAt: 0, size: 0, phase: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ground: 0, px: 0, py: 0, pz: 0, alpha: 0, settled: false };
  });
  parent.add(root);
  const ids = Array.from({ length: BURSTS }, () => '');
  const recent = new Map<string, number>();
  let next = 0, spawned = 0, lastTime = -Infinity, retiredTime = -Infinity, disposed = false;

  function clear() {
    for (const feather of feathers) { feather.born = -Infinity; feather.alpha = 0; feather.settled = false; }
    ids.fill(''); recent.clear(); next = 0; lastTime = -Infinity; retiredTime = -Infinity;
    alphas.array.fill(0); alphas.needsUpdate = true; root.visible = false;
  }
  function update(time: number) {
    if (disposed || !Number.isFinite(time) || time < 0 || time === lastTime) return;
    if (time < lastTime) clear();
    lastTime = time;
    let visible = false, changed = false;
    for (let i = 0; i < capacity; i++) {
      const feather = feathers[i], age = time - feather.born;
      if (age < 0 || age >= feather.life || !Number.isFinite(age)) {
        if (feather.alpha !== 0) { feather.alpha = 0; alphas.setX(i, 0); changed = true; }
        continue;
      }
      // Settled feathers stay on the floor for this session, until the oldest
      // bounded burst slot is reused. Their matrices need no per-frame upload.
      if (feather.settled) { visible = true; continue; }
      changed = true;
      const t = Math.min(age, feather.landAt), sway = reducedMotion ? 0 : Math.sin(t * 4 + feather.phase) * Math.sin(Math.min(1, t) * Math.PI / 2) * .055;
      feather.px = feather.x + feather.vx * travel(t) + sway;
      feather.py = Math.max(feather.ground, height(feather, t));
      feather.pz = feather.z + feather.vz * travel(t) + sway * .6;
      feather.settled = age >= feather.landAt;
      feather.alpha = 1;
      transform.position.set(feather.px, feather.py, feather.pz);
      landing.setFromEuler(landingRotation.set(Math.PI / 2, 0, feather.phase));
      if (reducedMotion) transform.quaternion.copy(landing);
      else {
        transform.rotation.set(.3 + Math.sin(t * 4.2 + feather.phase) * .8, feather.phase + t * .7, feather.phase + Math.sin(t * 3) * .6);
        transform.quaternion.slerp(landing, THREE.MathUtils.clamp(1 - (feather.landAt - age) / .24, 0, 1));
      }
      transform.scale.setScalar(feather.size); transform.updateMatrix(); root.setMatrixAt(i, transform.matrix);
      alphas.setX(i, feather.alpha); visible = true;
    }
    if (changed) { root.instanceMatrix.needsUpdate = true; alphas.needsUpdate = true; }
    root.visible = visible;
  }
  function burst(hit: VehicleFeatherHit): boolean {
    if (disposed || !hit || typeof hit.id !== 'string' || !hit.id.length || hit.id.length > 256 || recent.has(hit.id)
      || ![hit.time, hit.position?.x, hit.position?.y, hit.position?.z, hit.velocity?.x, hit.velocity?.y, hit.velocity?.z, hit.groundY].every(Number.isFinite)
      || hit.time < 0 || hit.time < lastTime || hit.time <= retiredTime
      || [hit.position.x, hit.position.y, hit.position.z, hit.groundY].some(value => Math.abs(value) > 1e6)
      || [hit.velocity.x, hit.velocity.y, hit.velocity.z].some(value => Math.abs(value) > 1e4)
      || hit.groundY > hit.position.y || hit.position.y - hit.groundY > 100) return false;
    const slot = next++ % BURSTS;
    ids[slot] = hit.id; recent.set(hit.id, hit.time);
    if (recent.size > HISTORY) {
      const oldest = recent.entries().next().value!;
      retiredTime = Math.max(retiredTime, oldest[1]); recent.delete(oldest[0]);
    }
    const velocityScale = Math.min(1, 24 / Math.max(1, Math.hypot(hit.velocity.x, hit.velocity.y, hit.velocity.z)));
    const inherited = (reducedMotion ? .06 : .25) * velocityScale;
    for (let i = 0; i < perBurst; i++) {
      const feather = feathers[slot * perBurst + i], phase = i * 2.3999632297 + slot * .71;
      feather.born = hit.time; feather.life = Infinity; feather.phase = phase; feather.settled = false;
      feather.size = .105 + (i % 5) * .014;
      feather.x = hit.position.x; feather.y = Math.max(hit.groundY + .012, hit.position.y); feather.z = hit.position.z;
      feather.ground = hit.groundY + .012;
      const scatter = reducedMotion ? .12 : .35 + (i % 4) * .14;
      feather.vx = hit.velocity.x * inherited + Math.sin(phase) * scatter;
      feather.vy = Math.max(0, hit.velocity.y * inherited) + (reducedMotion ? .15 : 1.05 + (i % 4) * .22);
      feather.vz = hit.velocity.z * inherited + Math.cos(phase) * scatter;
      let low = 0, high = (feather.y - feather.ground + (feather.vy + TERMINAL) / DRAG) / TERMINAL + 1;
      if (height(feather, high) > feather.ground) feather.landAt = high;
      else {
        for (let step = 0; step < 24; step++) { const middle = (low + high) / 2; if (height(feather, middle) > feather.ground) low = middle; else high = middle; }
        feather.landAt = high;
      }
    }
    spawned++;
    // A new burst can share a committed timestamp with a preceding burst.
    lastTime = -Infinity; update(hit.time); return true;
  }
  return {
    root, burst, update, clear,
    snapshot() {
      return { spawned, visible: root.visible, maxParticles: capacity, activeParticles: feathers.filter(feather => feather.alpha > 0).length,
        reducedMotion, rememberedIds: recent.size,
        particles: feathers.filter(feather => feather.alpha > 0).map(feather => ({ id: ids[feather.burst], x: feather.px, y: feather.py, z: feather.pz,
          alpha: feather.alpha, settled: feather.settled, age: lastTime - feather.born, life: feather.life })) };
    },
    dispose() { if (disposed) return; disposed = true; clear(); root.removeFromParent(); root.dispose(); geometry.dispose(); material.dispose(); },
  };
}
