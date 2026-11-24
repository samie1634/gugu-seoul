import { flockFoodContactSeconds, isUrbanForager, urbanFoodPeckSeconds } from './ported/birds/urban/ground-motion.ts';
import type { SpeciesId } from './ported/birds/rig-core/contract.ts';

export interface BirdPoint { x: number; y: number; z: number }
export interface BirdPerch extends BirdPoint { id: string; kind: 'wire' | 'roof' }
export interface BirdCrumb extends BirdPoint { id: string; eaten: boolean }
export interface BirdPrey extends BirdPoint { id: string; kind: 'rat' }
export interface BirdObserver extends BirdPoint { species?: SpeciesId; heading?: number; peckAge?: number }
export type FlockAction = 'idle' | 'walk' | 'feed' | 'approach' | 'attack' | 'retreat' | 'flee' | 'fly-to-perch' | 'perch' | 'hunt' | 'return';
export interface FlockBird extends BirdPoint {
  id: string; species: SpeciesId; home: BirdPoint; heading: number; phase: number;
  action: FlockAction; steps: number; peckAge: number; peckKind: 'ground' | 'opponent';
  peckHits: number; crowPeckHits: number; whiteFeathers: boolean; visible: boolean; cooldown: number;
  until: number; targetId: string | null; destination: BirdPoint | null;
  airborne: boolean; eaten: number; caught: number;
}
export type BirdBehaviorEvent = { type: 'peck' | 'eat' | 'catch' | 'escape' | 'perch'; actorId: string; targetId: string; time: number; distance: number };
export interface BirdBehaviorWorld {
  groundAt(x: number, z: number): number | null;
  canMove(from: BirdPoint, to: BirdPoint, flying: boolean): boolean;
  perches: readonly BirdPerch[];
  crumbs: BirdCrumb[];
  feedingGround?: BirdPoint;
  captureRat?(id: string, at: BirdPoint): boolean;
}
export const OPPONENT_PECK_DISTANCE = 0.30;
export const HUNT_CONTACT_DISTANCE = 0.25;
export const KESTREL_ALARM_DISTANCE = 20;
const corvid = (s: SpeciesId) => s === 'crow' || s === 'magpie';
const owl = (s: SpeciesId) => s === 'tawny-owl' || s === 'eagle-owl';
const feeder = (s: SpeciesId) => s === 'pigeon' || s === 'sparrow' || corvid(s);
const distance = (a: BirdPoint, b: BirdPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const planar = (a: BirdPoint, b: BirdPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p: BirdPoint): BirdPoint => ({ x: p.x, y: p.y, z: p.z });
interface FlightPlan { destination: BirdPoint; waypoints: BirdPoint[]; perchId: string | null }
interface Refuge {
  origin: BirdPoint; returnTo: BirdPoint; threat: BirdPoint; reason: 'kestrel' | 'owl' | 'peck';
  phase: 'escape' | 'wait' | 'return'; retryAt: number;
}
// All searches are bounded and run only when a trip starts or a route is obstructed.
const MAX_PERCH_CANDIDATES = 16;
const ESCAPE_ANGLES = [0, .55, -.55, 1.1, -1.1, Math.PI / 2, -Math.PI / 2, Math.PI];
export function makeFlockBird(id: string, species: SpeciesId, at: BirdPoint, phase = 0): FlockBird {
  return { ...at, id, species, home: { ...at }, heading: phase, phase, action: 'idle', steps: 0,
    peckAge: Infinity, peckKind: 'ground', peckHits: 0, crowPeckHits: 0, whiteFeathers: false, visible: true,
    cooldown: 1 + phase % 2, until: 0, targetId: null, destination: null, airborne: false, eaten: 0, caught: 0 };
}
/** Species rules are independent of rendering; every attack is rechecked at bill-contact time. */
export function createBirdBehavior(birds: FlockBird[], world: BirdBehaviorWorld) {
  let time = 0;
  const events: BirdBehaviorEvent[] = [];
  const flights = new Map<FlockBird, FlightPlan>();
  const refuges = new Map<FlockBird, Refuge>();
  const flightRetries = new Map<FlockBird, number>();
  const emit = (type: BirdBehaviorEvent['type'], bird: FlockBird, targetId: string, d = 0) => {
    events.push({ type, actorId: bird.id, targetId, time, distance: d });
    if (events.length > 96) events.shift();
  };
  function move(bird: FlockBird, to: BirdPoint, speed: number, dt: number, flying: boolean) {
    const d = flying ? distance(bird, to) : planar(bird, to);
    if (d === 0) return true;
    const fraction = Math.min(1, speed * dt / d);
    const next = { x: bird.x + (to.x - bird.x) * fraction, y: bird.y + (to.y - bird.y) * fraction, z: bird.z + (to.z - bird.z) * fraction };
    if (!flying) {
      const y = world.groundAt(next.x, next.z);
      if (y === null || Math.abs(y - bird.y) > .12) return false;
      next.y = y;
    }
    if (!world.canMove(bird, next, flying)) return false;
    const dx = next.x - bird.x, dz = next.z - bird.z;
    if (Math.hypot(dx, dz) > .00001) bird.heading = Math.atan2(dx, -dz);
    if (!flying) bird.steps += Math.hypot(dx, dz);
    bird.x = next.x; bird.y = next.y; bird.z = next.z; bird.airborne = flying;
    return fraction === 1;
  }
  function nearest<T extends BirdPoint>(bird: BirdPoint, choices: readonly T[], limit: number): T | undefined {
    let best: T | undefined, d = limit;
    for (const other of choices) { const next = distance(bird, other); if (next < d) { d = next; best = other; } }
    return best;
  }
  function ground(x: number, z: number): BirdPoint | null {
    const y = world.groundAt(x, z);
    if (y === null || !Number.isFinite(y)) return null;
    const at = { x, y, z };
    return world.canMove(at, at, false) ? at : null;
  }
  function supported(at: BirdPoint, perchId: string | null) {
    if (perchId) return world.perches.some(p => p.id === perchId && distance(p, at) < .025) && world.canMove(at, at, true);
    const y = world.groundAt(at.x, at.z);
    return y !== null && Number.isFinite(y) && Math.abs(y - at.y) < .025 && world.canMove(at, at, false);
  }
  function planFlight(from: BirdPoint, destination: BirdPoint, perchId: string | null = null): FlightPlan | null {
    if (!supported(destination, perchId)) return null;
    const span = planar(from, destination);
    if (distance(from, destination) < .025) return world.canMove(from, destination, true)
      ? { destination: point(destination), waypoints: [point(destination)], perchId } : null;
    // A short diagonal takeoff and approach replace the old vertical climb/hover fallback.
    // Never assume the space above a wall or a roof edge is clear.
    for (const clearance of [1.4, 3.2, 6]) {
      const height = Math.max(from.y, destination.y) + clearance;
      let waypoints: BirdPoint[];
      if (span > .35) {
        const start = Math.min(.25, .65 / span), end = 1 - Math.min(.25, .45 / span);
        waypoints = [
          { x: from.x + (destination.x - from.x) * start, y: height, z: from.z + (destination.z - from.z) * start },
          { x: from.x + (destination.x - from.x) * end, y: height, z: from.z + (destination.z - from.z) * end },
          destination,
        ];
      } else {
        // Even a return to a point directly below uses a checked side approach.
        waypoints = [{ x: from.x + .6, y: height, z: from.z }, { x: destination.x + .45, y: height, z: destination.z + .35 }, destination];
      }
      let previous = from;
      if (waypoints.every(next => { const clear = world.canMove(previous, next, true); previous = next; return clear; }))
        return { destination: point(destination), waypoints: waypoints.map(point), perchId };
    }
    return null;
  }
  function followFlight(bird: FlockBird, dt: number, speed: number): 'flying' | 'landed' | 'blocked' {
    const route = flights.get(bird);
    if (!route) return 'blocked';
    const next = route.waypoints[0];
    if (next) {
      const before = point(bird);
      if (move(bird, next, speed, dt, true)) route.waypoints.shift();
      else if (distance(before, bird) < .000001) { flights.delete(bird); return 'blocked'; }
    }
    if (route.waypoints.length) return 'flying';
    if (!supported(route.destination, route.perchId)) { flights.delete(bird); return 'blocked'; }
    bird.x = route.destination.x; bird.y = route.destination.y; bird.z = route.destination.z;
    bird.destination = point(route.destination); bird.airborne = false;
    if (route.perchId) { bird.targetId = route.perchId; emit('perch', bird, route.perchId); }
    flights.delete(bird);
    return 'landed';
  }
  function groundEscape(bird: FlockBird, threat: BirdPoint): FlightPlan | null {
    const angle = planar(bird, threat) > .02 ? Math.atan2(bird.z - threat.z, bird.x - threat.x) : bird.phase + 1;
    for (const radius of [5, 3, 1.5]) for (const turn of ESCAPE_ANGLES) {
      const target = ground(bird.x + Math.cos(angle + turn) * radius, bird.z + Math.sin(angle + turn) * radius);
      if (!target || planar(target, threat) < Math.min(2.5, planar(bird, threat) + .5)) continue;
      const route = planFlight(bird, target);
      if (route) return route;
    }
    return null;
  }
  function escapePlan(bird: FlockBird, threat: BirdPoint): FlightPlan | null {
    if (corvid(bird.species)) {
      const occupied = new Set(birds.filter(b => b !== bird && b.visible).map(b => b.targetId));
      const perches = world.perches.slice(0, MAX_PERCH_CANDIDATES).filter(p => p.y > (world.groundAt(p.x, p.z) ?? bird.home.y) + 1.5)
        .sort((a, b) => Number(occupied.has(a.id)) - Number(occupied.has(b.id)) || distance(bird, a) - distance(bird, b));
      for (const perch of perches) { const route = planFlight(bird, perch, perch.id); if (route) return route; }
    }
    // If no authored high seat is reachable, use real ground rather than inventing an airborne perch.
    return groundEscape(bird, threat);
  }
  function flee(bird: FlockBird, threat: BirdPoint, duration: number, reason: Refuge['reason'] = 'peck') {
    const crumb = world.crumbs.find(c => c.id === bird.targetId && !c.eaten);
    const returnTo = crumb ?? (feeder(bird.species) ? world.feedingGround : undefined) ?? bird;
    const refuge: Refuge = { origin: point(bird), returnTo: point(returnTo), threat, reason, phase: 'escape', retryAt: 0 };
    refuges.set(bird, refuge); flights.delete(bird);
    bird.until = time + duration; bird.peckAge = Infinity; bird.targetId = null;
    const route = escapePlan(bird, threat);
    if (route) {
      flights.set(bird, route); bird.action = 'flee'; bird.airborne = true; bird.destination = point(route.destination);
      if (route.perchId) bird.targetId = route.perchId;
      emit('escape', bird, 'threat');
    } else {
      // A completely enclosed bird must not climb in place or step onto unverified ground.
      const seat = world.perches.find(p => distance(p, bird) < .000001);
      const floor = world.groundAt(bird.x, bird.z);
      if ((seat && supported(bird, seat.id)) || (floor !== null && floor === bird.y && supported(bird, null))) bird.airborne = false;
      bird.action = bird.airborne ? 'flee' : 'idle';
      refuge.phase = bird.airborne ? 'escape' : 'wait'; refuge.retryAt = time + 1;
    }
  }
  function dangerNear(bird: FlockBird, refuge: Refuge, kestrels: readonly BirdPoint[], observer?: BirdObserver): BirdPoint | undefined {
    const choices = refuge.reason === 'kestrel' ? kestrels : refuge.reason === 'owl'
      ? birds.filter(b => b.visible && owl(b.species) && b.action === 'hunt')
      : birds.filter(b => b === refuge.threat && b.visible);
    const radius = refuge.reason === 'kestrel' ? KESTREL_ALARM_DISTANCE : refuge.reason === 'owl' ? 3.5 : 2.5;
    const player = refuge.reason === 'peck' && observer && observer.species === 'crow' ? [observer] : [];
    return [...choices, ...player].find(t => distance(bird, t) < radius || distance(refuge.origin, t) < radius || distance(refuge.returnTo, t) < radius);
  }
  function returnPlan(bird: FlockBird, at: BirdPoint): FlightPlan | null {
    const target = ground(at.x, at.z);
    if (target) { const route = planFlight(bird, target); if (route) return route; }
    // Keep retries local and bounded when the original food point is no longer landable.
    for (const radius of [.65, 1.3]) for (const angle of ESCAPE_ANGLES) {
      const nearby = ground(at.x + Math.cos(angle) * radius, at.z + Math.sin(angle) * radius);
      if (nearby) { const route = planFlight(bird, nearby); if (route) return route; }
    }
    return null;
  }
  function updateRefuge(bird: FlockBird, refuge: Refuge, dt: number, kestrels: readonly BirdPoint[], observer?: BirdObserver) {
    const threat = dangerNear(bird, refuge, kestrels, observer) ?? nearest(bird, kestrels, KESTREL_ALARM_DISTANCE);
    if (threat && kestrels.includes(threat)) refuge.reason = 'kestrel';
    if (threat && refuge.phase === 'return') {
      refuge.phase = 'escape'; refuge.threat = threat; refuge.retryAt = 0; flights.delete(bird);
    }
    if (refuge.phase === 'wait') {
      if (corvid(bird.species)) bird.heading = Math.atan2(refuge.origin.x - bird.x, bird.z - refuge.origin.z);
      if (threat || time < bird.until) return;
      refuge.phase = 'return'; refuge.retryAt = 0;
    }
    if (!flights.has(bird)) {
      if (time < refuge.retryAt) return;
      const route = refuge.phase === 'escape' ? escapePlan(bird, threat ?? refuge.threat) : returnPlan(bird, refuge.returnTo);
      refuge.retryAt = time + 1;
      if (!route) {
        // A blocked takeoff stays on its current support. Mid-flight blockage tries a verified landing nearby.
        if (bird.airborne) {
          const emergency = groundEscape(bird, threat ?? refuge.threat);
          if (emergency) { flights.set(bird, emergency); refuge.phase = 'escape'; }
        }
        return;
      }
      flights.set(bird, route); bird.destination = point(route.destination);
      bird.targetId = route.perchId; bird.action = refuge.phase === 'return' ? 'return' : 'flee'; bird.airborne = true;
    }
    const route = flights.get(bird);
    const result = followFlight(bird, dt, refuge.phase === 'return' ? 3.2 : 5.4);
    if (result === 'blocked') { refuge.retryAt = time; return; }
    if (result !== 'landed') return;
    bird.action = route?.perchId ? 'perch' : 'idle';
    if (refuge.phase === 'return') {
      refuges.delete(bird); bird.targetId = null; bird.cooldown = 0;
    } else {
      refuge.phase = 'wait';
      if (corvid(bird.species)) bird.heading = Math.atan2(refuge.origin.x - bird.x, bird.z - refuge.origin.z);
    }
  }
  function struck(victim: FlockBird, attacker: FlockBird) {
    if (victim.species === 'pigeon') {
      victim.peckHits++; victim.whiteFeathers = true;
      if (attacker.species === 'crow') victim.crowPeckHits++;
      // Pigeon pecks always cause a walking retreat, including the fifth hit.
      // The separately requested fifth-crow-hit flight uses its own counter.
      if (attacker.species === 'crow' && victim.crowPeckHits >= 5) { flee(victim, attacker, 7); return; }
    }
    refuges.delete(victim); flights.delete(victim);
    const d = planar(victim, attacker);
    const dx = d > .001 ? (victim.x - attacker.x) / d : Math.sin(attacker.heading + Math.PI);
    const dz = d > .001 ? (victim.z - attacker.z) / d : -Math.cos(attacker.heading + Math.PI);
    victim.airborne = false;
    victim.action = 'retreat'; victim.until = time + .65;
    victim.destination = { x: victim.x + dx * .65, y: victim.y, z: victim.z + dz * .65 };
    victim.peckAge = Infinity; victim.targetId = null;
  }
  function update(dt: number, observer?: BirdObserver, rats: readonly BirdPrey[] = []) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > .1) return;
    time += dt;
    const kestrels: BirdPoint[] = birds.filter(b => b.visible && b.species === 'kestrel');
    if (observer?.species === 'kestrel') kestrels.push(observer);
    for (const bird of birds) {
      if (!bird.visible) continue;
      bird.cooldown = Math.max(0, bird.cooldown - dt);
      const threat = bird.species !== 'kestrel' ? nearest(bird, kestrels, KESTREL_ALARM_DISTANCE) : undefined;
      if (threat && !refuges.has(bird)) flee(bird, threat, 5, 'kestrel');
      const refuge = refuges.get(bird);
      if (refuge) { updateRefuge(bird, refuge, dt, kestrels, observer); continue; }
      if (bird.action === 'return') {
        if (!flights.has(bird) && time >= (flightRetries.get(bird) ?? 0)) {
          const homePerch = world.perches.find(p => distance(p, bird.home) < .025);
          const route = homePerch ? planFlight(bird, homePerch, homePerch.id) : returnPlan(bird, bird.home);
          if (route) flights.set(bird, route);
          flightRetries.set(bird, time + 1);
        }
        if (flights.has(bird) && followFlight(bird, dt, 3.2) === 'landed') {
          bird.action = 'idle'; bird.airborne = false; bird.cooldown = 2; flightRetries.delete(bird);
        }
        continue;
      }
      if (bird.action === 'retreat') {
        if (bird.destination) move(bird, bird.destination, 1, dt, false);
        if (time >= bird.until) { bird.action = 'idle'; bird.cooldown = .3; }
        continue;
      }
      if (bird.action === 'attack') {
        const previous = bird.peckAge; bird.peckAge += dt;
        const victim = birds.find(b => b.id === bird.targetId && b.visible);
        if (victim) bird.heading = Math.atan2(victim.x - bird.x, bird.z - victim.z);
        if (previous < .15 && bird.peckAge >= .15 && victim && !victim.airborne && !bird.airborne && distance(bird, victim) <= OPPONENT_PECK_DISTANCE) {
          emit('peck', bird, victim.id, distance(bird, victim)); struck(victim, bird);
        }
        if (bird.peckAge >= .36) { bird.action = 'idle'; bird.peckAge = Infinity; bird.cooldown = .6; }
        continue;
      }
      if (owl(bird.species)) {
        const prey = nearest(bird, [...birds.filter(b => b.visible && b.species === 'sparrow'), ...rats], 35);
        if (prey) {
          bird.action = 'hunt'; bird.targetId = prey.id;
          // Claws descend only once over the prey rather than cutting through the floor.
          const goal = planar(bird, prey) > .5 ? { ...prey, y: Math.max(prey.y + 1, bird.y) } : prey;
          move(bird, goal, 3.8, dt, true);
          if (distance(bird, prey) <= HUNT_CONTACT_DISTANCE) {
            const sparrow = birds.find(b => b.id === prey.id && b.species === 'sparrow');
            const caught = sparrow ? (sparrow.visible = false, true) : world.captureRat?.(prey.id, bird) === true;
            if (caught) { bird.caught++; emit('catch', bird, prey.id, distance(bird, prey)); bird.action = 'return'; bird.destination = bird.home; }
          }
          continue;
        }
        if (bird.airborne) bird.action = 'return';
        else {
          const cycle = (time + bird.phase) % 8;
          if (cycle < 1.8) { bird.action = 'walk'; move(bird, { x: bird.home.x + Math.sin(bird.phase + Math.floor(time / 8)) * .5, y: bird.home.y, z: bird.home.z + Math.cos(bird.phase + Math.floor(time / 8)) * .5 }, .12, dt, false); }
          else { bird.action = 'idle'; bird.peckKind = 'ground'; bird.peckAge = cycle >= 3 && cycle < 3.5 ? cycle - 3 : Infinity; }
        }
        continue;
      }
      if (bird.species === 'kestrel') {
        if (time % 75 >= 55) {
          if (bird.airborne || Math.abs(bird.y - bird.home.y) > .05) {
            bird.action = 'return'; bird.airborne = true;
            if (move(bird, bird.home, 4.5, dt, true)) { bird.airborne = false; bird.action = 'idle'; }
          } else {
            const cycle = (time + bird.phase) % 3;
            bird.action = cycle < .8 ? 'walk' : 'idle';
            if (bird.action === 'walk') move(bird, { x: bird.home.x + .4, y: bird.home.y, z: bird.home.z }, .18, dt, false);
            bird.peckKind = 'ground'; bird.peckAge = cycle >= 1 && cycle < 1.5 ? cycle - 1 : Infinity;
          }
          continue;
        }
        bird.action = 'hunt'; bird.airborne = true;
        move(bird, { x: bird.home.x + Math.sin(time * .18) * 9, y: bird.home.y + 5, z: bird.home.z + Math.cos(time * .18) * 9 }, 4.5, dt, true);
        continue;
      }
      // A sparrow flees an owl, but pigeons and sparrows do not alarm one another.
      if (bird.species === 'sparrow') {
        const predator = nearest(bird, birds.filter(b => b.visible && owl(b.species) && b.action === 'hunt'), 3.5);
        if (predator) { flee(bird, predator, 4, 'owl'); continue; }
      }
      if (bird.action === 'feed') {
        const previous = bird.peckAge; bird.peckAge += dt;
        const crumb = world.crumbs.find(c => c.id === bird.targetId && !c.eaten);
        if (previous < flockFoodContactSeconds && bird.peckAge >= flockFoodContactSeconds && crumb && planar(bird, crumb) <= .2 && Math.abs(bird.y - crumb.y) < .08) {
          crumb.eaten = true; bird.eaten++; emit('eat', bird, crumb.id, planar(bird, crumb));
        }
        const boutSeconds = isUrbanForager(bird.species) ? urbanFoodPeckSeconds[bird.species] : .5;
        if (bird.peckAge >= boutSeconds) { bird.action = 'idle'; bird.peckAge = Infinity; bird.cooldown = 1.2 + bird.phase % 2; }
        continue;
      }
      // Pigeons jab only another pigeon already at bill contact, not sparrows.
      // They do not chase after the retreating bird or attack from a distance.
      if (bird.species === 'pigeon' && !bird.airborne && bird.cooldown === 0) {
        const opponent = nearest(bird, birds.filter(b => b !== bird && b.visible && !b.airborne && b.species === 'pigeon' && b.action !== 'retreat'), OPPONENT_PECK_DISTANCE);
        if (opponent) {
          bird.targetId = opponent.id; bird.action = 'attack'; bird.peckKind = 'opponent'; bird.peckAge = 0;
          bird.heading = Math.atan2(opponent.x - bird.x, bird.z - opponent.z);
          continue;
        }
      }
      if (corvid(bird.species)) {
        const enemy = nearest(bird, birds.filter(b => b.visible && !b.airborne && corvid(b.species) && b.species !== bird.species), 2.5);
        const pigeon = bird.species === 'crow' ? nearest(bird, birds.filter(b => b.visible && !b.airborne && b.species === 'pigeon'), 2) : undefined;
        const foraging = time % 12 < 3 && world.crumbs.some(c => !c.eaten && distance(bird, c) < 1.7);
        const opponent = foraging ? undefined : enemy ?? pigeon;
        if (opponent && !bird.airborne && bird.action !== 'perch' && bird.cooldown === 0) {
          bird.targetId = opponent.id;
          if (distance(bird, opponent) <= OPPONENT_PECK_DISTANCE) { bird.action = 'attack'; bird.peckKind = 'opponent'; bird.peckAge = 0; }
          else {
            bird.action = 'approach';
            const gap = Math.max(.001, planar(bird, opponent)), stop = .27;
            move(bird, { x: opponent.x + (bird.x - opponent.x) / gap * stop, y: opponent.y, z: opponent.z + (bird.z - opponent.z) / gap * stop }, 1.25, dt, false);
          }
          continue;
        }
        const perching = (time % 28 > 12 && time % 28 < 22) || bird.action === 'fly-to-perch' || (bird.action === 'perch' && time < bird.until);
        if (perching && world.perches.length) {
          // Each species shares one destination; individuals occupy adjacent supported slots.
          const previousPerch = world.perches.find(p => p.id === bird.targetId);
          const kind = bird.action === 'fly-to-perch' || bird.action === 'perch' ? previousPerch?.kind ?? 'wire' : Math.floor(time / 28) % 2 === 0 ? 'wire' : 'roof';
          const candidates = world.perches.filter(p => p.kind === kind);
          const slots = candidates.length ? candidates : world.perches;
          const group = birds.filter(b => b.species === bird.species), slot = Math.max(0, group.indexOf(bird));
          const perch = slots[(slot + (bird.species === 'crow' ? 0 : 3)) % slots.length];
          bird.targetId = perch.id;
          if (distance(bird, perch) < .04 && supported(perch, perch.id)) {
            if (bird.action !== 'perch') { emit('perch', bird, perch.id); bird.until = time + 7; }
            bird.action = 'perch'; bird.airborne = false;
          } else {
            if (!flights.has(bird) && time >= (flightRetries.get(bird) ?? 0)) {
              const route = planFlight(bird, perch, perch.id);
              if (route) { flights.set(bird, route); bird.action = 'fly-to-perch'; }
              flightRetries.set(bird, time + 1);
            }
            if (flights.has(bird) && followFlight(bird, dt, 4) === 'landed') {
              bird.action = 'perch'; bird.until = time + 7; flightRetries.delete(bird);
            }
          }
          continue;
        }
        if (bird.airborne || bird.action === 'perch') { bird.action = 'return'; continue; }
      }
      if (feeder(bird.species) && bird.cooldown === 0) {
        const crumb = nearest(bird, world.crumbs.filter(c => !c.eaten), world.feedingGround ? 32 : 1.7);
        if (crumb) {
          bird.targetId = crumb.id; bird.heading = Math.atan2(crumb.x - bird.x, bird.z - crumb.z);
          if (planar(bird, crumb) < .17) { bird.action = 'feed'; bird.peckKind = 'ground'; bird.peckAge = 0; }
          else { bird.action = 'walk'; move(bird, crumb, bird.species === 'sparrow' ? .45 : .55, dt, false); }
          continue;
        }
      }
      if (corvid(bird.species)) {
        const companions = birds.filter(b => b !== bird && b.visible && b.species === bird.species && !b.airborne);
        if (companions.length) {
          const center = { x: companions.reduce((v, b) => v + b.x, 0) / companions.length, y: bird.y, z: companions.reduce((v, b) => v + b.z, 0) / companions.length };
          if (planar(bird, center) > 1.4) { bird.action = 'walk'; move(bird, center, .45, dt, false); continue; }
        }
      }
      bird.action = 'idle'; bird.peckAge = Infinity;
      if (world.feedingGround && feeder(bird.species)) {
        const cycle = (time + bird.phase) % 7;
        if (cycle < 5) {
          const angle = bird.phase + Math.floor((time + bird.phase) / 7) * 1.7;
          const center = world.feedingGround;
          const destination = { x: center.x + Math.sin(angle) * (2.5 + bird.phase % 2), y: center.y, z: center.z + Math.cos(angle) * (2.5 + bird.phase % 2) };
          bird.action = 'walk'; move(bird, destination, .3, dt, false);
        }
      }
    }
  }
  return { update,
    receivePeck(victimId: string, source: BirdObserver): boolean {
      const victim = birds.find(b => b.id === victimId && b.visible && !b.airborne);
      const reach = source.species === 'heron' ? .65 : OPPONENT_PECK_DISTANCE;
      if (!victim || distance(victim, source) > reach) return false;
      const attacker = makeFlockBird('player-bird', source.species ?? 'pigeon', source);
      emit('peck', attacker, victim.id, distance(victim, source)); struck(victim, attacker); return true;
    },
    consumeCrumb(id: string, source: BirdObserver): boolean {
      const crumb = world.crumbs.find(c => c.id === id && !c.eaten);
      if (!crumb || distance(crumb, source) > .25) return false;
      crumb.eaten = true; emit('eat', makeFlockBird('player-bird', source.species ?? 'pigeon', source), crumb.id, distance(crumb, source)); return true;
    },
    get time() { return time; }, snapshot() { return { time, birds: birds.map(b => ({ ...b, home: { ...b.home }, destination: b.destination && { ...b.destination } })), events: events.map(e => ({ ...e })), crumbsRemaining: world.crumbs.filter(c => !c.eaten).length }; } };
}
