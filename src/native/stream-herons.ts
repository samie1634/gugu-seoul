import * as THREE from 'three';
import { defaultBuildRig } from '../species-core/assets.ts';
import type { BirdObserver, BirdPoint } from './bird-behavior.ts';
import type { NativeWorldQueries } from './ported/motion/locomotion/b2/contracts.ts';
import { createWaterbirdFishing } from './waterbird-fishing.ts';
import type { StreamFishSchool } from './stream-fish.ts';
import type { createStreamHabitat, StreamSupport } from './stream-habitat.ts';

/** Additional independently paced herons. Flight takes off before crossing to another perch. */
export function createStreamHerons(parent: THREE.Object3D, supports: StreamSupport[], queries: NativeWorldQueries, schools?: StreamFishSchool, habitat?: ReturnType<typeof createStreamHabitat>) {
  const birds = supports.slice(1, 6).map((support, i) => {
    const rig = defaultBuildRig({ species: 'heron', lod: 2 }); rig.root.name = `street-bird:heron:stream:${i}`; rig.root.position.set(support.x, support.y, support.z); parent.add(rig.root);
    const shadowMeshes: THREE.Mesh[] = []; rig.root.traverse(object => { if (object instanceof THREE.Mesh && object.castShadow) shadowMeshes.push(object); });
    return { rig, shadowMeshes, support, goal: { ...support } as BirdPoint, destination: support, index: i, action: 'rest' as 'rest' | 'walk' | 'takeoff' | 'fly' | 'land', clock: 1 + i * 1.1, nextFlight: 12 + i * 4, steps: 0, heading: 0, distanceFlown: 0, visits: 0 };
  });
  let time = 0, disposed = false;
  const beginFlight = (bird: typeof birds[number]) => {
    const index = supports.indexOf(bird.support), destination = supports[(index + 1 + bird.visits % 2) % supports.length];
    bird.destination = destination; bird.action = 'takeoff'; bird.clock = 0;
    bird.goal = { x: bird.rig.root.position.x, y: Math.max(bird.support.surfaceY, destination.surfaceY) + 5.5, z: bird.rig.root.position.z };
  };
  const move = (bird: typeof birds[number], goal: BirdPoint, speed: number, dt: number) => {
    const p = bird.rig.root.position, distance = p.distanceTo(new THREE.Vector3(goal.x, goal.y, goal.z));
    if (distance < .015) return true;
    const f = Math.min(1, speed * dt / distance), next = { x: p.x + (goal.x - p.x) * f, y: p.y + (goal.y - p.y) * f, z: p.z + (goal.z - p.z) * f };
    if (queries.sweepSphere({ x: p.x, y: p.y + .65, z: p.z }, { ...next, y: next.y + .65 }, .16) !== null) return false;
    const horizontal = Math.hypot(next.x - p.x, next.z - p.z);
    if (horizontal > .0001) bird.heading = Math.atan2(next.x - p.x, p.z - next.z);
    if (bird.action === 'walk') bird.steps += horizontal; else bird.distanceFlown += distance * f;
    p.set(next.x, next.y, next.z); return f >= 1;
  };
  const fishing = birds.map(bird => schools && habitat ? createWaterbirdFishing(schools, bird.rig.root.name, 5 + bird.index * 2, {
    root: bird.rig.root,
    tip: () => bird.rig.model.pivots.head.getObjectByName('upper-beak')!.localToWorld(new THREE.Vector3(0, .235 / 2, 0)),
    pose(age, fish, walking) {
      bird.heading = -bird.rig.root.rotation.y;
      bird.rig.pose({ mode: walking ? 'walk' : 'rest', time, steps: bird.steps, flapAge: 10, fishStrikeAge: walking ? Infinity : age, fishStrikeHeight: fish.y - bird.rig.root.position.y });
    },
    standAt(x, z) {
      const support = habitat.supportAt(x, z);
      // Never stalk off a rock into empty space or across a riverbank.
      return support && Math.abs(support.y - bird.rig.root.position.y) < .04 ? support : null;
    },
    move(goal, dt) { const old = bird.action; bird.action = 'walk'; const p = bird.rig.root.position.clone(); move(bird, goal, .18, dt); bird.action = old; return p.distanceTo(bird.rig.root.position) > 0; },
    radius: 3, tolerance: .11,
  }) : undefined);
  return {
    get count() { return disposed ? 0 : birds.length; },
    receivePeck(source: BirdObserver) {
      const bird = birds.find(b => b.rig.root.position.distanceTo(new THREE.Vector3(source.x, source.y, source.z)) < .65);
      if (!bird || disposed) return false; fishing[bird.index]?.cancel(); beginFlight(bird); return true;
    },
    update(dt: number, observer?: BirdObserver) {
      if (disposed) return; time += dt;
      for (const bird of birds) {
        const p = bird.rig.root.position, distance = observer ? Math.hypot(observer.x - p.x, observer.z - p.z) : 0;
        bird.rig.root.visible = distance < 180; for (const mesh of bird.shadowMeshes) mesh.castShadow = distance < 45;
        const grounded = bird.action === 'walk' || bird.action === 'rest';
        const threatened = observer?.species === 'kestrel' && Math.hypot(observer.x - p.x, observer.y - p.y, observer.z - p.z) < 18;
        if (grounded && (time >= bird.nextFlight || threatened)) { fishing[bird.index]?.cancel(); beginFlight(bird); }
        if (fishing[bird.index]?.update(dt, grounded && !threatened && bird.action !== 'takeoff')) { bird.clock = 0; continue; }
        bird.clock += dt;
        if (bird.action === 'rest' && bird.clock > 2.5 + bird.index * .3) {
          const angle = time * .4 + bird.index * 1.7;
          bird.goal = { x: bird.support.x + Math.sin(angle) * .65, y: bird.support.y, z: bird.support.z + Math.cos(angle) * .42 }; bird.action = 'walk'; bird.clock = 0;
        } else if (bird.action === 'walk') {
          if (move(bird, bird.goal, .085, dt)) { bird.action = 'rest'; bird.clock = 0; }
        } else if (bird.action === 'takeoff') {
          if (move(bird, bird.goal, 1.9, dt)) { bird.action = 'fly'; bird.clock = 0; bird.goal = { ...bird.destination, y: bird.goal.y }; }
        } else if (bird.action === 'fly') {
          if (move(bird, bird.goal, 3.2, dt)) { bird.action = 'land'; bird.clock = 0; bird.goal = { ...bird.destination }; }
        } else if (bird.action === 'land' && move(bird, bird.goal, 1.4, dt)) {
          bird.support = bird.destination; bird.action = 'rest'; bird.clock = 0; bird.visits++; bird.nextFlight = time + 22 + bird.index * 3;
        }
        // A blocked segment is abandoned without teleportation; return via a clear vertical ascent.
        if (bird.clock > 25 && !grounded) { bird.destination = bird.support; bird.action = 'takeoff'; bird.clock = 0; bird.goal = { x: p.x, y: bird.support.surfaceY + 5.5, z: p.z }; }
        const airborne = bird.action === 'takeoff' || bird.action === 'fly' || bird.action === 'land';
        bird.rig.root.rotation.y = -bird.heading;
        bird.rig.pose({ mode: airborne ? 'flap' : bird.action === 'walk' ? 'walk' : 'rest', time: time + bird.index * 1.37, steps: bird.steps, flapAge: (time + bird.index * .2) % .72 });
      }
    },
    snapshot() { return disposed ? [] : birds.map(b => ({ id: b.rig.root.name, species: 'heron' as const, x: b.rig.root.position.x, y: b.rig.root.position.y, z: b.rig.root.position.z, heading: b.heading, action: fishing[b.index]?.active ? 'fish' : b.action, fishing: fishing[b.index]?.snapshot(), airborne: b.action !== 'rest' && b.action !== 'walk', visible: b.rig.root.visible, support: b.support.kind, surfaceY: b.support.surfaceY, steps: b.steps, distanceFlown: b.distanceFlown, visits: b.visits })); },
    dispose() { if (disposed) return; disposed = true; fishing.forEach(f => f?.cancel()); birds.forEach(b => { b.rig.root.removeFromParent(); b.rig.dispose(); }); },
  };
}
