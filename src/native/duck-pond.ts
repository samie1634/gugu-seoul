import * as THREE from 'three';
import { createCallDuckModel, createCallDuckResources } from './call-duck-model.ts';
import { createDuckModel, createDuckResources, type DuckPlumage, type WildDuckSpecies } from './duck-model.ts';
import type { BirdPoint, BirdObserver } from './bird-behavior.ts';
import type { MapLayout } from './ported/map/contracts.ts';
import type { NativeWorldQueries } from './ported/motion/locomotion/b2/contracts.ts';
import { sampleGround, sampleWater } from './ported/map/layout.ts';
import { footprintBounds } from './ported/map/real-map/geometry.ts';
import { createMapQueries } from './ported/motion/locomotion/b2/map-queries.ts';
import { streamStoneAt } from './stream-habitat.ts';
import { feedingOrigin } from './feeding-ground.ts';

import { createWaterbirdFishing } from './waterbird-fishing.ts';
import type { StreamFish, StreamFishSchool } from './stream-fish.ts';

type DuckAction = 'swim' | 'dabble' | 'rest' | 'preen' | 'escape';
interface Duck extends BirdPoint {
  id: string; breed: WildDuckSpecies | 'call-duck'; plumage: DuckPlumage | 'duckling'; parentId?: string; followClock: number; broodSlot: number; heading: number; phase: number; action: DuckAction;
  actionAge: number; actionDuration: number; goal: BirdPoint; home: BirdPoint; speed: number;
  distanceSwum: number; decision: number; escapeUntil: number;
  model: ReturnType<typeof createDuckModel>; wake: THREE.Mesh;
}
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
/** Small, bounded water-only flock. This does not alter map geometry or playable species. */
export function createDuckPond(parent: THREE.Scene, layout: MapLayout, sharedQueries?: NativeWorldQueries, schools?: StreamFishSchool) {
  const root = new THREE.Group(); root.name = 'duck-pond'; parent.add(root);
  const queries = sharedQueries ?? createMapQueries(layout), resources = createDuckResources(), extraResources = createDuckResources(8), callResources = createCallDuckResources();
  const ducks: Duck[] = [];
  let disposed = false, time = 0;
  const sample = (x: number, z: number): BirdPoint | null => {
    if (streamStoneAt(layout, x, z, .32)?.kind === 'rock') return null;
    const ground = sampleGround(layout, x, z), water = sampleWater(layout, x, ground.y, z);
    return water && water.depth >= .16 ? { x, y: water.y, z } : null;
  };
  const waterAt = (x: number, z: number): BirdPoint | null => {
    const point = sample(x, z); if (!point) return null;
    for (const [dx, dz] of [[-.31, 0], [.31, 0], [0, -.31], [0, .31]]) {
      const edge = sample(x + dx, z + dz); if (!edge || Math.abs(edge.y - point.y) > .03) return null;
    }
    return queries.sphereClear({ x, y: point.y + .16, z }, .14) === true ? point : null;
  };
  const pathClear = (from: BirdPoint, to: BirdPoint) => {
    const distance = Math.hypot(to.x - from.x, to.z - from.z), steps = Math.max(1, Math.ceil(distance / .25));
    if (queries.sweepSphere({ ...from, y: from.y + .16 }, { ...to, y: to.y + .16 }, .14) !== null) return false;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps, point = waterAt(from.x + (to.x - from.x) * f, from.z + (to.z - from.z) * f);
      if (!point || Math.abs(point.y - from.y) > .03) return false;
    }
    return true;
  };
  const origin = feedingOrigin(layout);
  const bounds = layout.realMap ? layout.realMap.water.map(w => footprintBounds(w.rings)) : [{ minX: layout.water.minX, maxX: layout.water.maxX, minZ: layout.water.minZ, maxZ: layout.water.maxZ }];
  const candidates: BirdPoint[] = [];
  for (const boundsEntry of bounds) {
    const sx = Math.max(1.1, (boundsEntry.maxX - boundsEntry.minX) / 28), sz = Math.max(1.1, (boundsEntry.maxZ - boundsEntry.minZ) / 20);
    for (let x = boundsEntry.minX + .6; x < boundsEntry.maxX - .6; x += sx) for (let z = boundsEntry.minZ + .6; z < boundsEntry.maxZ - .6; z += sz) {
      const point = sample(x, z); if (point) candidates.push(point);
    }
  }
  candidates.sort((a, b) => Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z));
  const anchor = candidates.find(p => waterAt(p.x, p.z));
  if (anchor) {
    for (const point of candidates) {
      if (ducks.length >= 4) break;
      if (Math.hypot(point.x - anchor.x, point.z - anchor.z) > 12 || ducks.some(d => Math.hypot(d.x - point.x, d.z - point.z) < 1.1) || !waterAt(point.x, point.z) || !pathClear(anchor, point)) continue;
      const i = ducks.length, plumage: DuckPlumage = i % 2 ? 'hen' : 'drake', model = createDuckModel(plumage, resources);
      const id = `street-bird:duck:${i}`; model.root.name = id; model.root.position.set(point.x, point.y, point.z); model.root.rotation.y = -i * .7; root.add(model.root);
      const wake = new THREE.Mesh(resources.wake, resources.wakeMaterial); wake.rotation.x = -Math.PI / 2; wake.name = `duck-wake:${i}`; wake.visible = false; root.add(wake);
      ducks.push({ ...point, id, breed: 'mallard', plumage, followClock: 0, broodSlot: 0, heading: i * .7, phase: i * 1.7, action: 'rest', actionAge: 0, actionDuration: 1 + i * .6, goal: { ...point }, home: { ...point }, speed: 0, distanceSwum: 0, decision: i, escapeUntil: 0, model, wake });
    }
  }
  // Keep the existing four mallards and their starts. The call-duck family is separate.
  const addCallDuck = (point: BirdPoint, plumage: DuckPlumage | 'duckling', familyIndex: number, parentId?: string, breed: 'mallard' | 'call-duck' = 'call-duck') => {
    const model = createCallDuckModel(plumage === 'duckling' ? 'duckling' : 'adult', callResources, breed === 'mallard'), id = `street-bird:duck:${breed === 'mallard' ? 'mallard-young' : 'call'}:${familyIndex}`;
    model.root.name = id; model.root.position.set(point.x, point.y, point.z); root.add(model.root);
    const wake = new THREE.Mesh(resources.wake, resources.wakeMaterial); wake.rotation.x = -Math.PI / 2; wake.name = `call-duck-wake:${familyIndex}`; wake.visible = false; root.add(wake);
    ducks.push({ ...point, id, breed, plumage, parentId, broodSlot: breed === 'mallard' ? familyIndex : familyIndex - 2, followClock: familyIndex * .12, heading: 0, phase: familyIndex * 1.4, action: 'rest', actionAge: 0, actionDuration: 1.2 + familyIndex * .4, goal: { ...point }, home: { ...point }, speed: 0, distanceSwum: 0, decision: familyIndex, escapeUntil: 0, model, wake });
  };
  if (anchor) {
    const familyPoints = candidates.filter(point => Math.hypot(point.x - anchor.x, point.z - anchor.z) <= 12);
    for (const plumage of ['drake', 'hen'] as const) {
      const point = familyPoints.find(p => ducks.every(d => Math.hypot(d.x - p.x, d.z - p.z) >= .85) && waterAt(p.x, p.z) && pathClear(anchor, p));
      if (point) addCallDuck(point, plumage, plumage === 'drake' ? 0 : 1);
    }
    const mother = ducks.find(d => d.breed === 'call-duck' && d.plumage === 'hen');
    if (mother) {
      for (let child = 0; child < 3; child++) {
        for (let attempt = 0; attempt < 48; attempt++) {
          const angle = attempt * 2.399963, radius = .7 + Math.floor(attempt / 12) * .45;
          const point = waterAt(mother.x + Math.sin(angle) * radius, mother.z + Math.cos(angle) * radius);
          if (!point || ducks.some(d => Math.hypot(point.x - d.x, point.z - d.z) < .48) || !pathClear(mother, point)) continue;
          addCallDuck(point, 'duckling', child + 2, mother.id); break;
        }
      }
    }
  }

  const mallardMother = ducks.find(d => d.breed === 'mallard' && d.plumage === 'hen');
  if (mallardMother) {
    for (let child = 0; child < 3; child++) {
      for (let attempt = 0; attempt < 48; attempt++) {
        const angle = attempt * 2.399963, radius = .7 + Math.floor(attempt / 12) * .45;
        const point = waterAt(mallardMother.x + Math.sin(angle) * radius, mallardMother.z + Math.cos(angle) * radius);
        if (!point || ducks.some(d => Math.hypot(point.x - d.x, point.z - d.z) < .48) || !pathClear(mallardMother, point)) continue;
        addCallDuck(point, 'duckling', child, mallardMother.id, 'mallard'); break;
      }
    }
  }
  // Extra distinct flocks are spread along verified water, never stacked at the family spawn.
  // Call ducks are domestic game characters; wild-teal/spotbill occurrence is not an upper-stream census.
  const extraFlocks = [
    { breed: 'mallard', count: 2 }, { breed: 'call-duck', count: 2 },
    { breed: 'spot-billed-duck', count: 4 }, { breed: 'eurasian-teal', count: 4 },
  ] as const;
  const extraCandidates: BirdPoint[] = [];
  for (const b of bounds) for (let x = b.minX + 1; x < b.maxX - 1; x += 3) for (let z = b.minZ + 1; z < b.maxZ - 1; z += 1.5) {
    const p = sample(x, z); if (p) extraCandidates.push(p);
  }
  if (anchor) extraCandidates.sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z));
  for (const [group, spec] of extraFlocks.entries()) {
    const cluster = extraCandidates.find(p => (!anchor || Math.hypot(p.x - anchor.x, p.z - anchor.z) >= 18 + group * 17) && waterAt(p.x, p.z));
    if (!cluster) continue;
    for (let i = 0; i < spec.count; i++) {
      const point = extraCandidates.find(p => Math.hypot(p.x - cluster.x, p.z - cluster.z) < 9 && ducks.every(d => Math.hypot(d.x - p.x, d.z - p.z) > 1.2) && waterAt(p.x, p.z) && pathClear(cluster, p));
      if (!point) continue;
      const plumage = i % 2 ? 'hen' : 'drake', id = `street-bird:duck:${spec.breed}:flock:${i}`;
      const model = spec.breed === 'call-duck' ? createCallDuckModel('adult', callResources) : createDuckModel(plumage, extraResources, spec.breed);
      model.root.name = id; model.root.position.set(point.x, point.y, point.z); root.add(model.root);
      const wake = new THREE.Mesh(resources.wake, resources.wakeMaterial); wake.rotation.x = -Math.PI / 2; wake.name = `duck-wake:${spec.breed}:${i}`; wake.visible = false; root.add(wake);
      ducks.push({ ...point, id, breed: spec.breed, plumage, followClock: 0, broodSlot: 0, heading: group + i * .7, phase: group * 2 + i * 1.7, action: 'rest', actionAge: 0, actionDuration: 1 + i * .6, goal: { ...point }, home: { ...point }, speed: 0, distanceSwum: 0, decision: i, escapeUntil: 0, model, wake });
    }
  }
  const chooseGoal = (duck: Duck, awayFrom?: BirdPoint) => {
    const preferred = awayFrom ? Math.atan2(duck.x - awayFrom.x, awayFrom.z - duck.z) : duck.decision * 2.399963 + duck.phase;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = preferred + (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * .42;
      const radius = awayFrom ? 1.6 : 1.2 + ((duck.decision + attempt) % 4) * .55;
      const point = waterAt(duck.x + Math.sin(angle) * radius, duck.z - Math.cos(angle) * radius);
      if (!point || Math.hypot(point.x - duck.home.x, point.z - duck.home.z) > (duck.plumage === 'duckling' ? 10 : 7) || ducks.some(other => other !== duck && Math.hypot(other.x - point.x, other.z - point.z) < .7) || !pathClear(duck, point)) continue;
      duck.goal = point; return true;
    }
    duck.goal = { x: duck.x, y: duck.y, z: duck.z }; return false;
  };
  const fishers = new Map(ducks.filter(d => d.plumage !== 'duckling').map((duck, index) => {
    const tipMesh = duck.model.root.getObjectByName('duck-bill-tip') ?? duck.model.root.getObjectByName('call-duck-bill-nail')!;
    const tip = () => tipMesh.getWorldPosition(new THREE.Vector3());
    let dipTarget: StreamFish | undefined, bestDip = 0;
    const fisher = schools ? createWaterbirdFishing(schools, duck.id, 8 + index * 1.3, {
      root: duck.model.root, tip,
      pose(age, fish, walking) {
        duck.heading = -duck.model.root.rotation.y; duck.speed = walking ? .27 : 0;
        // Calibrate this breed's real dip depth to the selected fish, including teal scale.
        let error = Infinity;
        if (dipTarget !== fish) for (let i = 0; i <= 16; i++) {
          const dip = i / 10; duck.model.pose(time, duck.phase, 0, dip, 0);
          const distance = Math.abs(tip().y - fish.y); if (distance < error) { error = distance; bestDip = dip; }
        }
        dipTarget = fish;
        const dip = walking ? 0 : bestDip * Math.min(1, age / 1.15) * (age > 1.4 ? Math.max(0, 1 - (age - 1.4) / .5) : 1);
        duck.model.pose(time, duck.phase, walking ? .27 : 0, dip, 0);
      },
      standAt(x, z) { const point = waterAt(x, z); return point && Math.hypot(x - duck.home.x, z - duck.home.z) <= 7 && pathClear(duck, point) ? point : null; },
      move(goal, dt) {
        const distance = Math.hypot(goal.x - duck.x, goal.z - duck.z), f = Math.min(1, .27 * dt / distance);
        const x = duck.x + (goal.x - duck.x) * f, z = duck.z + (goal.z - duck.z) * f, point = waterAt(x, z);
        if (!point || ducks.some(other => other !== duck && Math.hypot(other.x - x, other.z - z) < (other.plumage === 'duckling' ? .43 : .62))) return false;
        duck.distanceSwum += Math.hypot(x - duck.x, z - duck.z); duck.x = x; duck.y = point.y; duck.z = z; duck.speed = .27;
        duck.model.root.position.set(x, point.y, z); return true;
      },
      radius: 4, tolerance: .075,
    }) : undefined;
    return [duck.id, fisher] as const;
  }));
  const escape = (duck: Duck, source: BirdPoint) => {
    fishers.get(duck.id)?.cancel();
    duck.action = 'escape'; duck.actionAge = 0; duck.actionDuration = 2.5; duck.escapeUntil = time + 2.5; duck.decision++; chooseGoal(duck, source);
  };
  return {
    get count() { return disposed ? 0 : ducks.length; },
    receivePeck(id: string, source: BirdObserver) {
      const duck = ducks.find(d => d.id === id);
      if (disposed || !duck || Math.hypot(duck.x - source.x, duck.z - source.z) > .65 || Math.abs(duck.y - source.y) > .4) return false;
      escape(duck, source); return true;
    },
    update(dt: number, observer?: BirdObserver) {
      if (disposed || !Number.isFinite(dt) || dt <= 0 || dt > .1) return; time += dt;
      for (const duck of ducks) {
        const threat = observer && Math.abs(observer.y - duck.y) < 2 && Math.hypot(observer.x - duck.x, observer.z - duck.z) < (observer.species === 'kestrel' ? 6 : 1.1);
        if (threat && duck.escapeUntil <= time) escape(duck, observer);
        const fisher = fishers.get(duck.id);
        const waitsForBrood = ducks.some(child => child.parentId === duck.id && Math.hypot(child.x - duck.x, child.z - duck.z) > 2.6);
        if (fisher?.update(dt, !threat && duck.escapeUntil <= time && !waitsForBrood)) {
          duck.action = 'dabble'; duck.actionAge = 0; duck.actionDuration = 2.8;
          duck.model.root.visible = !observer || Math.hypot(observer.x - duck.x, observer.z - duck.z) < 180;
          duck.wake.visible = false; continue;
        }
        duck.actionAge += dt;
        if (duck.actionAge >= duck.actionDuration) {
          duck.decision++; duck.actionAge = 0;
          const cycle = duck.decision % 6;
          duck.action = cycle === 2 ? 'dabble' : cycle === 4 ? 'preen' : cycle === 0 ? 'rest' : 'swim';
          duck.actionDuration = duck.action === 'swim' ? 7 : duck.action === 'dabble' ? 2.8 : 3.8;
          if (duck.action === 'swim' && !chooseGoal(duck)) duck.action = 'rest';
        }
        if (duck.parentId) {
          duck.followClock -= dt;
          const mother = ducks.find(d => d.id === duck.parentId);
          if (mother && duck.followClock <= 0) {
            duck.followClock = .7;
            const slot = duck.broodSlot, distanceToMother = Math.hypot(duck.x - mother.x, duck.z - mother.z);
            if (distanceToMother > .85 || mother.speed > .08) {
              const behind = .62 + Math.floor(slot / 2) * .5, lateral = slot < 2 ? (slot % 2 ? -.36 : .36) : 0;
              const point = waterAt(mother.x - Math.sin(mother.heading) * behind + Math.cos(mother.heading) * lateral, mother.z + Math.cos(mother.heading) * behind + Math.sin(mother.heading) * lateral) ?? waterAt(mother.x, mother.z);
              if (point && Math.hypot(point.x - duck.x, point.z - duck.z) > .18 && pathClear(duck, point)) {
                duck.goal = point; duck.action = mother.action === 'escape' ? 'escape' : 'swim'; duck.actionAge = 0; duck.actionDuration = 3;
              }
            }
          }
        }
        let distanceMoved = 0;
        if (duck.action === 'swim' || duck.action === 'escape') {
          const dx = duck.goal.x - duck.x, dz = duck.goal.z - duck.z, distance = Math.hypot(dx, dz);
          if (distance > .03) {
            const desired = Math.atan2(dx, -dz), turn = wrapAngle(desired - duck.heading);
            duck.heading += Math.max(-dt * 1.5, Math.min(dt * 1.5, turn));
            const waitsForBrood = duck.action !== 'escape' && ducks.some(child => child.parentId === duck.id && Math.hypot(child.x - duck.x, child.z - duck.z) > 2.6);
            const speed = (waitsForBrood ? 0 : 1) * (duck.action === 'escape' ? duck.plumage === 'duckling' ? .95 : .8 : duck.plumage === 'duckling' ? .38 : .27) * Math.max(.1, 1 - Math.abs(turn) / Math.PI);
            const fraction = Math.min(1, speed * dt / distance), x = duck.x + dx * fraction, z = duck.z + dz * fraction;
            const point = sample(x, z);
            if (point && !ducks.some(other => other !== duck && Math.hypot(other.x - x, other.z - z) < (duck.plumage === 'duckling' && other.plumage === 'duckling' ? .27 : duck.plumage === 'duckling' || other.plumage === 'duckling' ? .43 : .62))) {
              distanceMoved = Math.hypot(x - duck.x, z - duck.z); duck.x = x; duck.y = point.y; duck.z = z; duck.distanceSwum += distanceMoved;
            } else duck.actionDuration = duck.actionAge;
          } else duck.actionDuration = duck.actionAge;
        }
        duck.speed += (distanceMoved / dt - duck.speed) * Math.min(1, dt * 7);
        const progress = Math.min(1, duck.actionAge / duck.actionDuration), dip = duck.action === 'dabble' ? Math.sin(progress * Math.PI) ** 2 : 0;
        const preen = duck.action === 'preen' ? Math.sin(progress * Math.PI) ** 2 : 0;
        duck.model.root.visible = !observer || Math.hypot(observer.x - duck.x, observer.z - duck.z) < 180;
        duck.model.root.position.set(duck.x, duck.y, duck.z); duck.model.root.rotation.y = -duck.heading;
        duck.model.pose(time, duck.phase, duck.speed, dip, preen);
        const ripple = (time * .7 + duck.phase) % 1;
        duck.wake.position.set(duck.x - Math.sin(duck.heading) * .23, duck.y + .009, duck.z + Math.cos(duck.heading) * .23);
        const wakeSize = duck.plumage === 'duckling' ? .55 : 1;
        duck.wake.rotation.z = duck.heading; duck.wake.scale.set((.16 + ripple * .14) * wakeSize, (.27 + ripple * .2) * wakeSize, 1); duck.wake.visible = duck.model.root.visible && duck.speed > .035;
      }
    },
    snapshot() {
      return { available: !disposed && ducks.length > 0, time, birds: disposed ? [] : ducks.map(d => ({ id: d.id, species: 'duck' as const, breed: d.breed, plumage: d.plumage, parentId: d.parentId, x: d.x, y: d.y, z: d.z, heading: d.heading, action: fishers.get(d.id)?.active ? 'fish' : d.action, fishing: fishers.get(d.id)?.snapshot(), visible: d.model.root.visible, airborne: false, distanceSwum: d.distanceSwum })) };
    },
    dispose() { if (disposed) return; disposed = true; fishers.forEach(f => f?.cancel()); root.removeFromParent(); ducks.forEach(duck => duck.model.dispose()); resources.dispose(); extraResources.dispose(); callResources.dispose(); ducks.length = 0; },
  };
}
