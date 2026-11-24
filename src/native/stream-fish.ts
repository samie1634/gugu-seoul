import * as THREE from 'three';
import type { BirdPoint, BirdObserver } from './bird-behavior.ts';
import type { createStreamHabitat } from './stream-habitat.ts';

// Occurrence only: Seoul Facilities Corporation's official Cheonggyecheon inventory.
// https://www.sisul.or.kr/open_content/cheonggye/intro/animals.jsp
// Sizes and colors below are deliberately simplified original game models, not a live census.
export const STREAM_FISH_SPECIES = [
  { id: 'pale-chub', name: '피라미', color: '#9dabb2', stripe: '#4d7f94', length: .17, girth: .026, speed: .38 },
  { id: 'korean-chub', name: '참갈겨니', color: '#c7bd7e', stripe: '#525c56', length: .19, girth: .027, speed: .34 },
  { id: 'dark-chub', name: '버들치', color: '#9c8c54', stripe: '#76704b', length: .13, girth: .024, speed: .25 },
  { id: 'striped-shiner', name: '돌고기', color: '#b3a787', stripe: '#2b302a', length: .15, girth: .029, speed: .23 },
  { id: 'common-carp', name: '잉어', color: '#a78b59', stripe: '#897343', length: .52, girth: .095, speed: .18 },
  { id: 'topmouth-gudgeon', name: '참붕어', color: '#b4bcad', stripe: '#575e54', length: .105, girth: .019, speed: .29 },
] as const;
export interface FishEnvelope { radius: number; minY: number; maxY: number }
export interface StreamFish extends BirdPoint { id: string; species: typeof STREAM_FISH_SPECIES[number]['id']; homeX: number; homeZ: number; phase: number; generation: number; reservedBy?: string; held: boolean; caught: boolean; eaten: boolean; mesh: THREE.Group; tail: THREE.Group; distanceSwum: number; heading: number; goal: BirdPoint; cooldown: number; speed: number; range: number; eatenAt: number; prey: boolean; envelope: FishEnvelope }
export function createStreamFish(parent: THREE.Object3D, habitat: ReturnType<typeof createStreamHabitat>) {
  const root = new THREE.Group(); root.name = 'cheonggye-fish-schools'; parent.add(root);
  const sphere = new THREE.SphereGeometry(1, 8, 5), fin = new THREE.ConeGeometry(1, 1, 3);
  const materials: THREE.Material[] = [], fish: StreamFish[] = [];
  const palettes = STREAM_FISH_SPECIES.map(s => {
    const body = new THREE.MeshStandardMaterial({ color: s.color, roughness: .46, metalness: .06 });
    const stripe = new THREE.MeshStandardMaterial({ color: s.stripe, roughness: .62 }); materials.push(body, stripe); return { body, stripe };
  });
  // A heading-independent envelope includes the full animated tail, not just the centre.
  const offsets = Array.from({ length: 16 }, (_, i) => [Math.sin(i * Math.PI / 8), Math.cos(i * Math.PI / 8)]);
  const clear = (x: number, z: number, envelope: FishEnvelope) => {
    const centre = habitat.waterAt(x, z); if (!centre) return null;
    let lowest = -Infinity, highest = Infinity;
    for (const [dx, dz] of [[0, 0], ...offsets]) {
      const px = x + dx * envelope.radius, pz = z + dz * envelope.radius;
      const water = habitat.waterAt(px, pz), support = habitat.stoneAt(px, pz);
      if (!water || Math.abs(water.surfaceY - centre.surfaceY) > .01 || support?.kind === 'rock') return null;
      const floor = Math.max(water.y, support?.y ?? -Infinity);
      lowest = Math.max(lowest, floor + .008 - envelope.minY);
      highest = Math.min(highest, water.surfaceY - .012 - envelope.maxY);
    }
    return lowest <= highest ? { ...centre, y: (lowest + highest) / 2 } : null;
  };
  const add = (x: number, z: number, kind: number, prey = false) => {
    const water = habitat.waterAt(x, z); if (!water || habitat.stoneAt(x, z)?.kind === 'rock') return;
    const s = STREAM_FISH_SPECIES[kind], m = palettes[kind], mesh = new THREE.Group(), tail = new THREE.Group(), id = `stream-fish:${s.id}:${fish.length}`;
    mesh.name = id; mesh.userData.species = s.name;
    const body = new THREE.Mesh(sphere, m.body); body.scale.set(s.girth, s.girth * .8, s.length * .40); mesh.add(body);
    const stripe = new THREE.Mesh(sphere, m.stripe); stripe.scale.set(s.girth * 1.02, s.girth * .18, s.length * .36); mesh.add(stripe);
    const dorsal = new THREE.Mesh(fin, m.stripe); dorsal.position.set(0, s.girth * .8, 0); dorsal.scale.set(.006, s.girth * .9, s.length * .17); mesh.add(dorsal);
    tail.position.z = s.length * .39; mesh.add(tail);
    const tailFin = new THREE.Mesh(fin, m.stripe); tailFin.rotation.x = Math.PI / 2; tailFin.position.z = s.length * .065; tailFin.scale.set(s.girth * .8, s.length * .17, s.girth * 1.5); tail.add(tailFin);
    const bounds = new THREE.Box3();
    for (const turn of [-.32, 0, .32]) { tail.rotation.y = turn; mesh.updateMatrixWorld(true); bounds.union(new THREE.Box3().setFromObject(mesh)); }
    tail.rotation.y = 0;
    const envelope = { radius: Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))) / Math.cos(Math.PI / 16) + .012, minY: bounds.min.y, maxY: bounds.max.y };
    const placement = clear(x, z, envelope); if (!placement) return;
    mesh.position.set(x, placement.y, z); root.add(mesh);
    fish.push({ id, species: s.id, x, y: placement.y, z, homeX: x, homeZ: z, phase: fish.length * .91, generation: 0, held: false, caught: false, eaten: false, mesh, tail, distanceSwum: 0, heading: 0, goal: { x, y: placement.y, z }, cooldown: 0, speed: prey ? .025 : s.speed, range: prey ? .26 : 5, eatenAt: Infinity, prey, envelope });
  };
  const first = habitat.supports[0];
  if (first) for (let i = 0; i < 5; i++) add(first.x + (i % 3 - 1) * .42, first.z - .58 - Math.floor(i / 3) * .35, i % 4, true);
  // Six visible species, bounded population, six fish per species in separate schools.
  STREAM_FISH_SPECIES.forEach((_, kind) => {
    const origin = habitat.supports[Math.min(habitat.supports.length - 1, kind * 2)] ?? habitat.candidates[kind];
    if (!origin) return;
    for (let i = 0; i < 6; i++) {
      // A few of the same school members rest in verified shallow shoals, within bill reach.
      if (i < 2 && kind !== 4) { const before = fish.length; add(origin.x + (i ? .42 : -.42), origin.z - .58, kind); if (fish.length > before) continue; }
      for (let n = 0; n < 20; n++) {
        const angle = (i + n * 7) * 2.399963, r = 2.5 + n * .25;
        const x = origin.x + Math.sin(angle) * r, z = origin.z + Math.cos(angle) * r;
        if (habitat.waterAt(x, z) && !habitat.stoneAt(x, z, .3)) { const before = fish.length; add(x, z, kind); if (fish.length > before) break; }
      }
    }
  });
  let time = 0, disposed = false, renewals = 0;
  const events: { time: number; birdId: string; type: 'fish-caught' | 'fish-eaten' | 'fish-returned'; targetId: string; generation: number; distance: number }[] = [];
  const record = (birdId: string, f: StreamFish, type: 'fish-caught' | 'fish-eaten' | 'fish-returned', distance: number) => {
    events.push({ time, birdId, type, targetId: f.id, generation: f.generation, distance }); if (events.length > 64) events.shift();
  };
  return { fish,
    // One population shared by all waterbirds. Protect primary prey and a breeding reserve.
    claim(birdId: string, at: BirdPoint, radius: number, accept: (f: StreamFish) => boolean = () => true) {
      if (disposed || fish.filter(f => !f.prey && !f.eaten && !f.reservedBy).length <= 12) return undefined;
      const f = fish.filter(f => !f.prey && f.species !== 'common-carp' && !f.caught && !f.eaten && !f.reservedBy && Math.hypot(f.x - at.x, f.z - at.z) < radius && fish.filter(other => !other.prey && other.species === f.species && !other.eaten && !other.reservedBy).length > 2 && accept(f))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
      if (f) f.reservedBy = birdId; return f;
    },
    release(birdId: string, f?: StreamFish) {
      if (!f || f.reservedBy !== birdId) return;
      f.reservedBy = undefined; f.held = false;
      if (!f.eaten) { f.caught = false; f.mesh.scale.setScalar(1); f.mesh.position.set(f.x, f.y, f.z); }
    },
    contact(birdId: string, f: StreamFish, tip: THREE.Vector3, tolerance: number) {
      if (disposed || f.reservedBy !== birdId || f.eaten || f.caught) return false;
      const distance = tip.distanceTo(new THREE.Vector3(f.x, f.y, f.z));
      if (distance > tolerance) return false;
      f.caught = true; record(birdId, f, 'fish-caught', distance); return true;
    },
    eat(birdId: string, f: StreamFish) {
      if (disposed || f.reservedBy !== birdId || !f.caught || f.eaten) return false;
      f.eaten = true; f.eatenAt = time; f.mesh.visible = false; record(birdId, f, 'fish-eaten', 0); return true;
    },
    snapshot() { return { renewals, remaining: fish.filter(f => !f.eaten).length, protectedSchoolReserve: 12, protectedPerSpecies: 2, events: events.map(e => ({ ...e })) }; },
    update(dt: number, paused?: StreamFish, observer?: BirdObserver) {
      if (disposed) return; time += dt;
      for (const f of fish) {
        if (f.eaten) {
          f.mesh.visible = false;
          // Reuse a consumed school slot for an off-screen newcomer, never primary prey.
          // The existing full body/tail envelope must still fit at its original home.
          const returnDelay = 90 + Math.floor(f.phase * 11) % 61;
          if (f.prey || f.reservedBy || time - f.eatenAt < returnDelay ||
              (observer && Math.hypot(f.homeX - observer.x, f.homeZ - observer.z) <= 70 + f.envelope.radius)) continue;
          const home = clear(f.homeX, f.homeZ, f.envelope);
          if (!home) continue;
          f.x = home.x; f.y = home.y; f.z = home.z; f.goal = { x: home.x, y: home.y, z: home.z };
          f.eaten = false; f.caught = false; f.held = false; f.eatenAt = Infinity; f.cooldown = 0; f.heading = 0;
          f.generation++; renewals++; f.mesh.scale.setScalar(1); f.mesh.rotation.set(0, 0, 0);
          record('stream-school', f, 'fish-returned', 0);
        }
        f.mesh.visible = !observer || Math.hypot(f.x - observer.x, f.z - observer.z) < (f.caught ? 180 : 70);
        if (f.caught) continue;
        f.mesh.rotation.z = 0;
        if (f !== paused && !f.held) {
          f.cooldown -= dt;
          if (f.cooldown <= 0 || Math.hypot(f.goal.x - f.x, f.goal.z - f.z) < .04) {
            f.cooldown = 2 + f.phase % 3;
            const angle = time * .38 + f.phase;
            const x = f.homeX + Math.sin(angle) * f.range, z = f.homeZ + Math.cos(angle * .73) * f.range * .32;
            if (clear(x, z, f.envelope)) f.goal = { x, y: f.y, z };
          }
          const dx = f.goal.x - f.x, dz = f.goal.z - f.z, d = Math.hypot(dx, dz), step = Math.min(d, dt * f.speed);
          if (d > .001) {
            const x = f.x + dx / d * step, z = f.z + dz / d * step;
            const placement = clear(x, z, f.envelope);
            if (placement) { f.x = x; f.y = placement.y; f.z = z; f.distanceSwum += step; f.heading = Math.atan2(dx, -dz); } else f.cooldown = 0;
          }
        }
        f.mesh.position.set(f.x, f.y, f.z); f.mesh.rotation.y = -f.heading; f.tail.rotation.y = Math.sin(time * (f.prey ? 8 : 12) + f.phase) * .32;
      }
    },
    dispose() { if (disposed) return; disposed = true; root.removeFromParent(); sphere.dispose(); fin.dispose(); materials.forEach(m => m.dispose()); root.clear(); },
  };
}

export type StreamFishSchool = ReturnType<typeof createStreamFish>;
