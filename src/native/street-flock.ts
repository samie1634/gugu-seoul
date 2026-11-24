import { isUrbanForager, urbanFlockPoseTime } from './ported/birds/urban/ground-motion.ts';
import type { NpcStimulus } from './ported/npcs/src/contracts.ts';
import * as THREE from 'three';
import { makePigeonCrown, updatePigeonCrown } from './pigeon-crown.ts';
import { createHeronFishing } from './heron-fishing.ts';
import { createDuckPond } from './duck-pond.ts';
import { defaultBuildRig } from '../species-core/assets.ts';
import type { BirdRig } from './ported/birds/rig-core/rig.ts';
import type { SpeciesId } from './ported/birds/rig-core/contract.ts';
import type { MapLayout } from './ported/map/contracts.ts';
import { sampleGround } from './ported/map/layout.ts';
import { createMapQueries } from './ported/motion/locomotion/b2/map-queries.ts';
import { diskInside } from './ported/map/real-map/geometry.ts';
import { createBirdBehavior, makeFlockBird, type BirdPoint, type BirdCrumb, type BirdPerch, type BirdObserver } from './bird-behavior.ts';

import { createHumanFeeding, type HumanFeeder } from './human-feeding.ts';
import { feedingOrigin, feedingGroundAt, clearFeedingPath } from './feeding-ground.ts';

type StreetBird = { rig: BirdRig; whiteFeathers: THREE.Group };
export interface FlockAnimal extends HumanFeeder { id: string; kind: 'rat' | 'cat' | 'dog' | 'human' }
export interface StreetFlockOptions { captureRat?(id: string, at: BirdPoint): boolean; onAnimalPeck?(id: string, at: BirdPoint): boolean }
/** Small street flocks share the committed game clock and the map's verified geometry. */
export function createStreetFlock(parent: THREE.Scene, layout: MapLayout, options: StreetFlockOptions = {}) {
  const visual = new Map<string, StreetBird>();
  const origin = feedingOrigin(layout);
  const queries = createMapQueries(layout);
  const extras = new THREE.Group(); extras.name = 'street-flock:food-and-perches'; parent.add(extras);
  const resources: (THREE.BufferGeometry | THREE.Material)[] = [];
  const perches: BirdPerch[] = [];
  const birds: ReturnType<typeof makeFlockBird>[] = [];
  const crumbs: BirdCrumb[] = [];
  const crumbMeshes: THREE.Mesh[] = [];
  const own = <T extends THREE.BufferGeometry | THREE.Material>(resource: T): T => { resources.push(resource); return resource; };
  const groundAt = (x: number, z: number) => feedingGroundAt(layout, x, z);
  const canMove = (from: BirdPoint, to: BirdPoint, flying: boolean) => {
    const a = { ...from, y: from.y + .16 }, b = { ...to, y: to.y + .16 };
    return queries.sweepSphere(a, b, .10) === null && (flying || groundAt(to.x, to.z) !== null);
  };
  // These are authored game perches, not surveyed utility-line locations.
  for (const dz of [-4, -6, 4, 6]) {
    const a = { x: origin.x - 4, y: 0, z: origin.z + dz }, b = { x: origin.x + 4, y: 0, z: origin.z + dz };
    const ay = groundAt(a.x, a.z), by = groundAt(b.x, b.z);
    if (ay === null || by === null) continue;
    const y = Math.max(ay, by) + 4.2;
    if (queries.sweepSphere({ ...a, y }, { ...b, y }, .18) !== null) continue;
    const material = own(new THREE.MeshStandardMaterial({ color: '#393b3d', roughness: .85 }));
    const poleGeometry = own(new THREE.CylinderGeometry(.035, .045, y - Math.min(ay, by), 6));
    for (const p of [a, b]) { const pole = new THREE.Mesh(poleGeometry, material); pole.position.set(p.x, (y + Math.min(ay, by)) / 2, p.z); extras.add(pole); }
    const wire = new THREE.Mesh(own(new THREE.CylinderGeometry(.009, .009, 8, 6)), material);
    wire.rotation.z = Math.PI / 2; wire.position.set(origin.x, y, a.z); wire.name = 'street-flock:authored-perch-wire'; extras.add(wire);
    for (let slot = 0; slot < 8; slot++) perches.push({ id: `wire:${slot}`, kind: 'wire', x: origin.x - 2.8 + slot * .8, y: y + .009, z: a.z });
    break;
  }
  const roofPoints: BirdPoint[] = [];
  if (layout.realMap) {
    const sorted = [...layout.realMap.buildings].sort((a, b) => Math.hypot(a.rings[0][0][0] - origin.x, a.rings[0][0][1] - origin.z) - Math.hypot(b.rings[0][0][0] - origin.x, b.rings[0][0][1] - origin.z));
    for (const building of sorted.filter(b => b.height >= 3).slice(0, 12)) {
      const ring = building.rings[0];
      const center = { x: ring.reduce((v, p) => v + p[0], 0) / ring.length, z: ring.reduce((v, p) => v + p[1], 0) / ring.length };
      for (const corner of ring.slice(0, -1)) {
        const d = Math.hypot(center.x - corner[0], center.z - corner[1]);
        if (d < .5) continue;
        const dx = (center.x - corner[0]) / d, dz = (center.z - corner[1]) / d;
        // Adjacent slots keep the flock together at one supported roof corner.
        for (let row = 0; row < 3; row++) for (let col = -1; col <= 1; col++) {
          const x = corner[0] + dx * (.65 + row * .65) - dz * col * .65;
          const z = corner[1] + dz * (.65 + row * .65) + dx * col * .65;
          if (diskInside(building.rings, x, z, .16)) roofPoints.push({ x, y: building.height, z });
        }
      }
    }
  } else {
    for (const surface of layout.landingSurfaces.filter(s => s.id.includes('roof') && s.approximation === 0)) {
      roofPoints.push({ x: surface.x - surface.width / 2 + .4, y: surface.y, z: surface.z - surface.depth / 2 + .4 });
    }
    for (const roof of layout.roofs) roofPoints.push({ x: roof.x, y: roof.y + roof.rise + .32, z: roof.z });
  }
  roofPoints.sort((a, b) => Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z));
  for (const point of roofPoints) {
    const support = queries.supportAt({ at: point, previousFeetY: point.y, footRadiusM: .1, heightM: .6, maxRiseM: .03, maxDropM: .05 });
    if (support?.landable && queries.sphereClear({ ...point, y: support.height + .16 }, .1) === true) {
      perches.push({ ...point, y: support.height, id: `roof:${perches.length}`, kind: 'roof' });
      if (perches.filter(p => p.kind === 'roof').length >= 8) break;
    }
  }
  const species: SpeciesId[] = ['pigeon', 'pigeon', 'pigeon', 'pigeon', 'pigeon', 'pigeon', 'sparrow', 'sparrow', 'sparrow', 'sparrow', 'crow', 'crow', 'crow', 'magpie', 'magpie', 'magpie', 'tawny-owl', 'eagle-owl', 'kestrel'];
  const featherGeometry = own(new THREE.SphereGeometry(1, 6, 4));
  const featherMaterial = own(new THREE.MeshStandardMaterial({ color: '#f4f2e9', roughness: .95 }));
  const crumbGeometry = own(new THREE.IcosahedronGeometry(.015, 0));
  const crumbMaterial = own(new THREE.MeshStandardMaterial({ color: '#d8b577', roughness: 1 }));
  for (let i = 0; i < species.length; i++) {
    const s = species[i];
    const isRaptor = s === 'kestrel' || s === 'tawny-owl' || s === 'eagle-owl';
    let placement: BirdPoint | undefined;
    // Distinct deterministic starts, all connected to the central food by dry ground.
    for (let attempt = 0; attempt < 48 && !placement; attempt++) {
      const angle = i * 2.3999632297 + attempt * .31;
      const radius = isRaptor ? 20 + (i - 16) * 2 : 5 + (i % 4) * 1.8 + Math.floor(attempt / 12);
      const x = origin.x + Math.sin(angle) * radius, z = origin.z + Math.cos(angle) * radius;
      const y = groundAt(x, z);
      if (y === null || birds.some(b => Math.hypot(b.x - x, b.z - z) < 1) ||
          !clearFeedingPath(layout, { x, y, z }, origin)) continue;
      placement = { x, y, z };
    }
    if (!placement) continue;
    const { x, y, z } = placement;
    const id = `street-bird:${s}:${i}`, rig = defaultBuildRig({ species: s, lod: 1 });
    const bird = makeFlockBird(id, s, { x, y, z }, i * .73);
    // Owls start on verified ground; only a flying kestrel may begin above it.
    if (s === 'kestrel') { bird.visible = false; bird.home = { x: origin.x, y, z: origin.z }; }
    rig.root.name = id; rig.root.position.set(bird.x, bird.y, bird.z); rig.root.visible = bird.visible; parent.add(rig.root);
    const whiteFeathers = s === 'pigeon' ? makePigeonCrown(featherGeometry, featherMaterial) : new THREE.Group();
    if (s === 'pigeon') rig.model.pivots.head.add(whiteFeathers);
    birds.push(bird); visual.set(id, { rig, whiteFeathers });
  }
  // The first crumb is within the player's ground-peck reach. The rest form one
  // small, visible pile around that start rather than following each animal.
  for (let c = 0; c < 64; c++) {
    const radius = c === 0 ? .12 : .3 + Math.sqrt(c / 63) * 1.65, angle = c * 2.3999632297;
    const x = origin.x + Math.sin(angle) * radius, z = origin.z - Math.cos(angle) * radius;
    const y = groundAt(x, z);
    if (y === null) continue;
    const crumb = { id: `crumb:start:${c}`, x, y, z, eaten: false };
    crumbs.push(crumb); const mesh = new THREE.Mesh(crumbGeometry, crumbMaterial);
    mesh.position.set(x, y + .008, z); mesh.name = crumb.id; extras.add(mesh); crumbMeshes.push(mesh);
  }
  const humanFeeding = createHumanFeeding(crumbs, groundAt);
  const fishing = createHeronFishing(parent, layout, queries);
  const ducks = createDuckPond(parent, layout, queries, fishing.schools);
  const behavior = createBirdBehavior(birds, { groundAt, canMove, perches, crumbs, feedingGround: origin, captureRat: options.captureRat });
  let flightSignals: NpcStimulus[] = [];
  let pigeonFlockTakeoffSequence = 0;
  const groundedPigeons = new Set<string>();
  let disposed = false, previousPlayerPeckAge = Infinity, pendingPlayerTarget: string | null = null, floorContact = .21, playerHits = 0, playerEaten = 0;
  const forwardTarget = (player: BirdObserver, animals: readonly FlockAnimal[]) => {
    const reach = player.species === 'heron' ? .65 : .30, heading = player.heading ?? 0;
    return [...birds.filter(b => b.visible), ...fishing.snapshot().birds, ...ducks.snapshot().birds, ...animals]
      .filter(target => {
        const dx = target.x - player.x, dz = target.z - player.z, d = Math.hypot(dx, dz);
        return d <= reach && Math.abs(target.y - player.y) < .3 && d > .001 && (dx * Math.sin(heading) - dz * Math.cos(heading)) / d > .65;
      }).sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
  };
  const playerPeckKind = (player: BirdObserver, animals: readonly FlockAnimal[] = []) => {
    const age = player.peckAge ?? Infinity;
    if (!Number.isFinite(age) || age >= .5) return 'ground';
    return age >= previousPlayerPeckAge ? pendingPlayerTarget ? 'opponent' : 'ground' : forwardTarget(player, animals) ? 'opponent' : 'ground';
  };
  return {
    playerPeckKind,
    flightStimuli() { return flightSignals.map(s => ({ ...s, position: { ...s.position }, birdFlight: s.birdFlight && { ...s.birdFlight, velocity: { ...s.birdFlight.velocity } } })); },
    get playerEaten() { return playerEaten; },
    get pigeonFlockTakeoffSequence() { return pigeonFlockTakeoffSequence; },
    update(dt: number, player: { x: number; z: number; y?: number; species?: SpeciesId; heading?: number; peckAge?: number; floorContactAge?: number }, animals: readonly FlockAnimal[] = []) {
      if (disposed || !Number.isFinite(dt) || dt <= 0 || dt > .1) return;
      humanFeeding.update(dt, animals);
      const kestrel = birds.find(b => b.species === 'kestrel');
      if (kestrel) {
        const visible = behavior.time % 75 >= 48 && behavior.time % 75 < 61;
        if (visible && !kestrel.visible) { kestrel.x = origin.x + 8; kestrel.z = origin.z + 8; kestrel.y = kestrel.home.y + 5; }
        kestrel.visible = visible;
      }
      const observer: BirdObserver = { ...player, y: player.y ?? sampleGround(layout, player.x, player.z).y };
      const age = player.peckAge ?? Infinity, newPeck = age < previousPlayerPeckAge;
      if (newPeck) {
        pendingPlayerTarget = forwardTarget(observer, animals)?.id ?? null;
        // Freeze one contact clock at acceptance: loading mid-peck must not
        // create a second crossing of a later threshold.
        floorContact = player.floorContactAge ?? .21;
      }
      const before = newPeck ? 0 : previousPlayerPeckAge;
      if (pendingPlayerTarget && before < .15 && age >= .15 && age < .5) {
        const target = forwardTarget(observer, animals);
        if (target?.id === pendingPlayerTarget) {
          const hit = target.id.startsWith('street-bird:heron:') ? fishing.receivePeck(observer)
            : target.id.startsWith('street-bird:duck:') ? ducks.receivePeck(target.id, observer)
            : birds.some(b => b.id === target.id) ? behavior.receivePeck(target.id, observer) : options.onAnimalPeck?.(target.id, observer) === true;
          if (hit) playerHits++;
        }
      } else if (!pendingPlayerTarget && before < floorContact && age >= floorContact && age < .5) {
        const crumb = crumbs.find(c => !c.eaten && Math.hypot(c.x - observer.x, c.z - observer.z) <= .25 && Math.abs(c.y - observer.y) < .08);
        if (crumb && behavior.consumeCrumb(crumb.id, observer)) playerEaten++;
      }
      previousPlayerPeckAge = age;
      fishing.update(dt, { ...player, y: player.y ?? sampleGround(layout, player.x, player.z).y });
      ducks.update(dt, observer);
      groundedPigeons.clear();
      for (const bird of birds) if (bird.visible && bird.species === 'pigeon' && !bird.airborne) groundedPigeons.add(bird.id);
      behavior.update(dt, { ...player, y: player.y ?? sampleGround(layout, player.x, player.z).y } as BirdObserver, animals.filter(a => a.kind === 'rat').map(a => ({ ...a, kind: 'rat' as const })));
      let nearbyPigeonTakeoffs = 0;
      for (const bird of birds) {
        if (groundedPigeons.has(bird.id) && bird.visible && bird.airborne && Math.hypot(bird.x - observer.x, bird.y - observer.y, bird.z - observer.z) <= 35) nearbyPigeonTakeoffs++;
      }
      if (nearbyPigeonTakeoffs >= 2) pigeonFlockTakeoffSequence++;
      flightSignals = [];
      for (const bird of birds) {
        const entry = visual.get(bird.id)!;
        if (bird.visible && bird.species === 'pigeon' && bird.airborne) flightSignals.push({ id: bird.id, type: 'flap', position: { x: bird.x, y: bird.y + .12, z: bird.z }, radius: .17, halfHeight: .12, birdFlight: { species: 'pigeon', airborne: true, velocity: { x: (bird.x - entry.rig.root.position.x) / dt, y: (bird.y - entry.rig.root.position.y) / dt, z: (bird.z - entry.rig.root.position.z) / dt } } });
        entry.rig.root.visible = bird.visible;
        entry.rig.root.position.set(bird.x, bird.y, bird.z); entry.rig.root.rotation.y = -bird.heading;
        updatePigeonCrown(entry.whiteFeathers, bird.peckHits);
        const walking = ['walk', 'approach', 'retreat'].includes(bird.action);
        const flapSeconds = bird.species === 'sparrow' ? .23 : bird.species === 'kestrel' ? .26 : bird.species === 'magpie' ? .29 : bird.species === 'pigeon' ? .33 : .39;
        const foodPeckAge = bird.action === 'feed' && !bird.airborne && isUrbanForager(bird.species)
          ? urbanFlockPoseTime(bird.species, bird.peckAge) : undefined;
        entry.rig.pose({ mode: bird.airborne ? 'flap' : walking ? 'walk' : 'rest', time: behavior.time, flapAge: (behavior.time + bird.phase) % flapSeconds, steps: bird.steps, foodPeckAge, peckAge: foodPeckAge === undefined && bird.peckKind === 'ground' ? bird.peckAge : Infinity, opponentPeckAge: bird.peckKind === 'opponent' ? bird.peckAge : Infinity });
      }
      crumbs.forEach((crumb, i) => {
        const mesh = crumbMeshes[i] ?? new THREE.Mesh(crumbGeometry, crumbMaterial);
        if (!crumbMeshes[i]) { crumbMeshes.push(mesh); extras.add(mesh); }
        const airborne = humanFeeding.visual(i), at = airborne ?? crumb;
        mesh.name = crumb.id; mesh.position.set(at.x, at.y + .008, at.z); mesh.visible = !!airborne || !crumb.eaten;
      });
    },
    snapshot() { const base = behavior.snapshot(), water = fishing.snapshot(); return { ...base, birds: [...base.birds, ...water.birds, ...ducks.snapshot().birds], fishing: water, ducks: ducks.snapshot(), humanFeeding: humanFeeding.snapshot(), playerInteractions: { hits: playerHits, eaten: playerEaten }, feedingGround: { ...origin }, crumbs: crumbs.map(c => ({ ...c })), perches: perches.map(p => ({ ...p })) }; },
    get count() { return disposed ? 0 : birds.length + fishing.count + ducks.count; },
    dispose() {
      if (disposed) return; disposed = true;
      for (const entry of visual.values()) { parent.remove(entry.rig.root); entry.rig.dispose(); }
      humanFeeding.dispose(); fishing.dispose(); ducks.dispose(); visual.clear(); birds.length = 0; extras.removeFromParent();
      for (const resource of resources) resource.dispose();
    },
  };
}
