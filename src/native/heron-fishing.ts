import * as THREE from 'three';
import { defaultBuildRig } from '../species-core/assets.ts';
import type { BirdPoint, BirdObserver } from './bird-behavior.ts';
import type { MapLayout } from './ported/map/contracts.ts';
import { createMapQueries } from './ported/motion/locomotion/b2/map-queries.ts';
import type { NativeWorldQueries } from './ported/motion/locomotion/b2/contracts.ts';
import { createStreamHabitat } from './stream-habitat.ts';
import { createStreamFish, type StreamFish as Fish } from './stream-fish.ts';
import { createStreamHerons } from './stream-herons.ts';

/** Herons and fish own only their meshes; existing map/water geometry is read-only. */
export function createHeronFishing(parent: THREE.Scene, layout: MapLayout, sharedQueries?: NativeWorldQueries) {
  const root = new THREE.Group(); root.name = 'heron-fishing'; parent.add(root);
  const queries = sharedQueries ?? createMapQueries(layout);
  const habitat = createStreamHabitat(root, layout, queries), waterAt = habitat.supportAt;
  const home = habitat.supports[0];
  if (!home) return { count: 0, receivePeck(source: BirdObserver) { void source; return false; }, update(dt: number, player?: BirdObserver) { void dt; void player; }, snapshot: () => ({ available: false, reason: 'No verified shallow water', birds: [], fish: [], catches: 0 }), dispose() { habitat.dispose(); root.removeFromParent(); } };
  let disposed = false;
  const start = { ...home }, rig = defaultBuildRig({ species: 'heron', lod: 1 });
  rig.root.name = 'street-bird:heron:water'; rig.root.position.set(start.x, start.y, start.z); root.add(rig.root);
  const shadowMeshes: THREE.Mesh[] = []; rig.root.traverse(object => { if (object instanceof THREE.Mesh && object.castShadow) shadowMeshes.push(object); });
  const schools = createStreamFish(root, habitat), fish = schools.fish;
  const otherHerons = createStreamHerons(root, habitat.supports, queries, schools, habitat);
  const bill = rig.model.pivots.head.getObjectByName('upper-beak')!;
  const billTip = () => bill.localToWorld(new THREE.Vector3(0, .235 / 2, 0));
  let time = 0, steps = 0, heading = 0, cooldown = 1.8, strikeAge = Infinity, target: Fish | undefined, catches = 0;
  let action: 'idle' | 'walk' | 'fish' | 'flee' | 'return' = 'idle', escapeUntil = 0;
  let escapedFrom: BirdPoint | undefined;
  let nextFlight = 42;
  const events: { time: number; type: 'fish-caught' | 'fish-eaten'; targetId: string; distance: number }[] = [];
  const move = (goal: BirdPoint, speed: number, dt: number, flying: boolean) => {
    const p = rig.root.position, d = flying ? p.distanceTo(new THREE.Vector3(goal.x, goal.y, goal.z)) : Math.hypot(p.x - goal.x, p.z - goal.z);
    if (d < .005) return true;
    const f = Math.min(1, speed * dt / d), x = p.x + (goal.x - p.x) * f, z = p.z + (goal.z - p.z) * f;
    const water = waterAt(x, z); if (!flying && !water) return false;
    heading = Math.atan2(x - p.x, p.z - z); if (!flying) steps += Math.hypot(x - p.x, z - p.z);
    const y = flying ? p.y + (goal.y - p.y) * f : water!.y;
    if (flying && queries.sweepSphere({x:p.x,y:p.y+.65,z:p.z},{x,y:y+.65,z},.12) !== null) return false;
    p.set(x, y, z); return d <= speed * dt + .01;
  };
  const pose = (mode: 'rest' | 'walk' | 'flap') => {
    rig.root.rotation.y = -heading;
    rig.pose({ mode, time, steps, flapAge: time % .58, fishStrikeAge: strikeAge, fishStrikeHeight: target ? target.y - rig.root.position.y : start.surfaceY - start.y - .08 });
  };
  return {
    schools,
    get count() { return disposed ? 0 : 1 + otherHerons.count; },
    receivePeck(source: BirdObserver) {
      if (disposed) return false;
      if (rig.root.position.distanceTo(new THREE.Vector3(source.x, source.y, source.z)) > .65) return otherHerons.receivePeck(source);
      if (target?.caught && !target.eaten) { target.caught = false; target.mesh.scale.setScalar(1); }
      target = undefined; strikeAge = Infinity; escapedFrom = { ...source }; action = 'flee'; escapeUntil = time + 5; return true;
    },
    update(dt: number, player?: BirdObserver) {
      if (disposed || !Number.isFinite(dt) || dt <= 0 || dt > .1) return; time += dt;
      otherHerons.update(dt, player);
      const p = rig.root.position;
      const observerDistance = player ? Math.hypot(player.x - p.x, player.z - p.z) : 0;
      rig.root.visible = observerDistance < 180;
      for (const mesh of shadowMeshes) mesh.castShadow = observerDistance < 45;
      if (time >= nextFlight && action !== 'fish' && action !== 'flee' && action !== 'return') { escapedFrom = { x: p.x - 1, y: p.y, z: p.z }; action = 'flee'; escapeUntil = time + 2.6; nextFlight = time + 48; }
      if (player?.species === 'kestrel' && Math.hypot(p.x - player.x, p.y - player.y, p.z - player.z) < 20) {
        if (action !== 'flee') { if (target?.caught && !target.eaten) { target.caught = false; target.mesh.scale.setScalar(1); } target = undefined; strikeAge = Infinity; escapedFrom = { ...player }; }
        action = 'flee'; escapeUntil = time + 5;
      }
      if (action === 'flee') {
        const dx = p.x - (escapedFrom?.x ?? p.x - 1), dz = p.z - (escapedFrom?.z ?? p.z), d = Math.max(.01, Math.hypot(dx, dz));
        move({ x: p.x + dx / d * 6, y: start.y + 5, z: p.z + dz / d * 6 }, 2.8, dt, true); pose('flap');
        if (time > escapeUntil) action = 'return';
      } else if (action === 'return') {
        if (move(start, 2.4, dt, true)) { action = 'idle'; cooldown = 2; } pose('flap');
      } else {
        cooldown = Math.max(0, cooldown - dt);
        if (action !== 'fish') {
          target = fish.filter(f => f.prey && !f.caught && !f.eaten).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
          if (target) {
            heading = Math.atan2(target.x - p.x, p.z - target.z);
            // Calibrate aim from this rig's real bill tip at the water-contact pose.
            rig.root.rotation.y = 0; rig.pose({ mode: 'rest', time, steps, flapAge: 10, fishStrikeAge: 1.2, fishStrikeHeight: target.y - p.y });
            const tip = rig.root.worldToLocal(billTip()); const reach = Math.abs(tip.z);
            const goal = { x: target.x - Math.sin(heading) * reach, y: p.y, z: target.z + Math.cos(heading) * reach };
            const close = Math.hypot(p.x - goal.x, p.z - goal.z) < .025;
            if (!close) { action = 'walk'; const facing = heading; move(goal, .085, dt, false); heading = facing; }
            else if (cooldown === 0) { action = 'fish'; strikeAge = 0; }
            else action = 'idle';
          } else action = 'idle';
        }
        if (action === 'fish') strikeAge += dt;
        pose(action === 'walk' ? 'walk' : 'rest');
        if (target && action === 'fish') {
          const tip = billTip();
          if (!target.caught && strikeAge >= 1.15 && strikeAge <= 1.35) {
            const contact = tip.distanceTo(new THREE.Vector3(target.x, target.y, target.z));
            if (contact <= .11) { target.caught = true; events.push({ time, type: 'fish-caught', targetId: target.id, distance: contact }); }
          }
          if (target.caught) {
            target.mesh.position.copy(tip); target.mesh.rotation.z = .7;
            target.mesh.scale.setScalar(strikeAge > 2 ? Math.max(0, 1 - (strikeAge - 2) / .4) : 1);
            if (strikeAge >= 2.4 && !target.eaten) { target.eaten = true; target.eatenAt = time; catches++; events.push({ time, type: 'fish-eaten', targetId: target.id, distance: 0 }); }
          }
          if (strikeAge >= 2.6) { action = 'idle'; strikeAge = Infinity; cooldown = 3; target = undefined; }
        }
      }
      schools.update(dt, action === 'fish' ? target : undefined, player);
      if (events.length > 32) events.splice(0, events.length - 32);
    },
    snapshot() { return { available: true, sharedFishing: schools.snapshot(), catches, time, action, strikeAge, steps, birds: [{ id: rig.root.name, species: 'heron' as const, x: rig.root.position.x, y: rig.root.position.y, z: rig.root.position.z, heading, action, airborne: action === 'flee' || action === 'return', visible: rig.root.visible, support: start.kind, surfaceY: start.surfaceY }, ...otherHerons.snapshot()], stones: habitat.stoneCount, fish: fish.map(({ id, species, x, y, z, caught, eaten, distanceSwum, prey }) => ({ id, species, x, y, z, caught, eaten, distanceSwum, prey })), events: events.map(e => ({ ...e })) }; },
    dispose() { if (disposed) return; disposed = true; rig.dispose(); otherHerons.dispose(); schools.dispose(); habitat.dispose(); root.removeFromParent(); },
  };
}
