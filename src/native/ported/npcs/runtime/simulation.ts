import type {
  GroundContext, GroundSample, NpcAction, NpcClockFrame, NpcEvent, NpcFrame, NpcKind, NpcLimits,
  NpcNavigation, NpcOptions, NpcRoute, NpcState, NpcStimulus, Point2, Point3, SpawnZone,
} from '../src/contracts.ts';
import { DEFAULT_LIMITS, FIXED_STEP, HARD_MAX_NPCS, MAX_FRAME_SECONDS, NPC_KINDS, scaleProfiles, type NpcProfile } from '../src/profiles.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type EventData<T = NpcEvent> = T extends NpcEvent ? Omit<T, 'npcId' | 'kind' | 'time' | 'position' | 'state'> : never;
interface Agent extends Mutable<NpcState> {
  zoneId: string;
  waypoint: number;
  direction: 1 | -1;
  pauseUntil: number;
  fleeUntil: number;
  fleeX: number;
  fleeZ: number;
  reactionAfter: number;
  lifetime: number;
  nextFootstep: number;
  motionSpeed: number;
  pauseAction: 'look' | 'idle';
  nearby?: { id: string; distance: number };
}
interface Settings {
  limits: NpcLimits;
  maxTotal: number;
  spawnMin: number;
  spawnMax: number;
  despawn: number;
  lifetime: readonly [number, number];
  eventCapacity: number;
}
export interface NpcStats {
  readonly count: number;
  readonly counts: NpcLimits;
  readonly time: number;
  readonly queuedEvents: number;
  readonly droppedEvents: number;
  readonly droppedSeconds: number;
  readonly groundQueries: number;
  readonly traversalQueries: number;
  readonly disposed: boolean;
}

const finitePoint = (p: Point3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const distance2 = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (a: Point3): Point3 => ({ x: a.x, y: a.y, z: a.z });
const turnToward = (from: number, to: number, amount: number): number => {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-amount, Math.min(amount, difference));
};
const boundedInteger = (n: number, max: number): number => {
  if (!Number.isFinite(n) || n < 0) throw new RangeError('NPC limits must be finite and nonnegative');
  return Math.min(max, Math.floor(n));
};

/** No rendering, audio playback, DOM, timers, global RNG or root-app imports. */
export class NpcSystem {
  private readonly nav: NpcNavigation;
  private readonly options: Settings;
  private readonly routes: Map<string, NpcRoute>;
  private readonly profiles: Readonly<Record<NpcKind, NpcProfile>>;
  private readonly bodyScale: number;
  private readonly agents: Agent[] = [];
  private events: NpcEvent[] = [];
  private seed: number;
  private sequence = 0;
  private accumulator = 0;
  private time = 0;
  private disposed = false;
  private droppedEvents = 0;
  private droppedSeconds = 0;
  private groundQueries = 0;
  private traversalQueries = 0;
  private lastFrame = -1;
  private lastFrameTime = -Infinity;

  constructor(navigation: NpcNavigation, options: NpcOptions = {}) {
    this.nav = navigation;
    this.bodyScale = options.bodyScale ?? 1;
    this.profiles = scaleProfiles(this.bodyScale);
    this.routes = new Map();
    for (const route of navigation.routes) {
      if (!route.id || this.routes.has(route.id) || route.points.length < 2 || !route.kinds.length
        || route.kinds.some(kind => !NPC_KINDS.includes(kind))
        || route.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z) || (p.y !== undefined && !Number.isFinite(p.y)))) {
        throw new TypeError('NPC route needs a unique id, allowed species and at least two finite points');
      }
      this.routes.set(route.id, route);
    }
    const zoneIds = new Set<string>();
    for (const zone of navigation.spawnZones) {
      const route = this.routes.get(zone.routeId);
      if (!zone.id || zoneIds.has(zone.id) || !route || !Number.isFinite(zone.radius) || zone.radius <= 0
        || !Number.isFinite(zone.center.x) || !Number.isFinite(zone.center.z)
        || (zone.referenceY !== undefined && !Number.isFinite(zone.referenceY))
        || !Number.isInteger(zone.capacity) || zone.capacity < 1 || zone.capacity > HARD_MAX_NPCS
        || !zone.kinds.length || zone.kinds.some(kind => !route.kinds.includes(kind))) {
        throw new TypeError('NPC spawn zone must reference a route, valid radius/capacity and allowed species');
      }
      zoneIds.add(zone.id);
    }
    const seed = options.seed ?? 991103;
    if (!Number.isFinite(seed)) throw new RangeError('NPC seed must be finite');
    this.seed = seed >>> 0;
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const kind of NPC_KINDS) limits[kind] = boundedInteger(limits[kind], HARD_MAX_NPCS);
    const spawnMin = options.spawnMinDistance ?? 24;
    const spawnMax = options.spawnMaxDistance ?? 120;
    const despawn = options.despawnDistance ?? 180;
    const lifetime = options.lifetimeSeconds ?? [150, 270];
    if (![spawnMin, spawnMax, despawn, ...lifetime].every(Number.isFinite)
      || spawnMin < 0 || spawnMax <= spawnMin || despawn <= spawnMax
      || lifetime[0] < 1 || lifetime[1] < lifetime[0]) throw new RangeError('Invalid NPC activation/lifetime range');
    this.options = {
      limits, spawnMin, spawnMax, despawn, lifetime,
      maxTotal: boundedInteger(options.maxTotal ?? HARD_MAX_NPCS, HARD_MAX_NPCS),
      eventCapacity: Math.max(8, boundedInteger(options.eventCapacity ?? 128, 512)),
    };
  }

  /** Consume the shared FrameContext.acceptedSeconds; do not pass raw wall time. */
  update(acceptedSeconds: number, frame: NpcFrame): void {
    if (this.disposed || !Number.isFinite(acceptedSeconds) || acceptedSeconds <= 0 || !finitePoint(frame.observer)) return;
    this.accumulator += Math.min(acceptedSeconds, MAX_FRAME_SECONDS);
    this.droppedSeconds += Math.max(0, acceptedSeconds - MAX_FRAME_SECONDS);
    const stimuli = (frame.stimuli ?? []).slice(0, 16).filter(s => s.id && finitePoint(s.position));
    let steps = 0;
    while (this.accumulator + 1e-9 >= FIXED_STEP && steps < 2) {
      this.accumulator -= FIXED_STEP;
      this.step(frame.observer, stimuli);
      steps += 1;
    }
  }

  /** Preferred shared-clock entry: replay/backdated/paused frames emit nothing. */
  updateFrame(clock: NpcClockFrame, frame: NpcFrame): boolean {
    if (this.disposed || !Number.isInteger(clock.frame) || clock.frame < 0
      || !Number.isFinite(clock.simTime) || clock.simTime < 0
      || !Number.isFinite(clock.acceptedSeconds) || clock.acceptedSeconds < 0
      || clock.acceptedSeconds > MAX_FRAME_SECONDS || !finitePoint(frame.observer)
      || clock.frame <= this.lastFrame || clock.simTime < this.lastFrameTime) return false;
    const delta = clock.simTime - this.lastFrameTime;
    if (clock.playing && clock.acceptedSeconds > 0 && delta + 1e-9 < clock.acceptedSeconds) return false;
    this.lastFrame = clock.frame;
    this.lastFrameTime = clock.simTime;
    if (!clock.playing || clock.acceptedSeconds === 0 || delta === 0) return false;
    this.update(clock.acceptedSeconds, frame);
    return true;
  }

  /** Copies for consumers retaining snapshots; visit avoids those allocations. */
  snapshot(): readonly NpcState[] {
    return this.agents.map(a => this.stateOf(a));
  }

  private stateOf(a: Agent): NpcState {
    return { id: a.id, kind: a.kind, x: a.x, y: a.y, z: a.z,
      heading: a.heading, action: a.action, speed: a.speed, gaitDistance: a.gaitDistance,
      age: a.age, variant: a.variant, surface: a.surface, routeId: a.routeId, bodyScale: a.bodyScale, layerId: a.layerId };
  }

  /** Views are valid only during callback; do not mutate or retain them. */
  visit(visitor: (state: NpcState) => void): void {
    for (const agent of this.agents) visitor(agent);
  }

  drainEvents(): readonly NpcEvent[] {
    const result = this.events;
    this.events = [];
    return result;
  }

  get stats(): NpcStats {
    const counts = { human: 0, dog: 0, cat: 0, rat: 0 };
    for (const agent of this.agents) counts[agent.kind] += 1;
    return { count: this.agents.length, counts, time: this.time, queuedEvents: this.events.length,
      droppedEvents: this.droppedEvents, droppedSeconds: this.droppedSeconds,
      groundQueries: this.groundQueries, traversalQueries: this.traversalQueries, disposed: this.disposed };
  }

  despawn(id: string): boolean {
    if (this.disposed) return false;
    const index = this.agents.findIndex(a => a.id === id);
    if (index < 0) return false;
    this.remove(index, 'manual');
    return true;
  }

  /** Idempotent; the final despawn events remain drainable. No map resources owned. */
  dispose(): void {
    if (this.disposed) return;
    for (let i = this.agents.length - 1; i >= 0; i -= 1) this.remove(i, 'dispose');
    this.accumulator = 0;
    this.disposed = true;
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private emit(agent: Agent, data: EventData): void {
    if (this.events.length >= this.options.eventCapacity) {
      // Drop oldest; disposal/proximity events from the present remain available.
      this.events.shift();
      this.droppedEvents += 1;
    }
    this.events.push({ ...data, npcId: agent.id, kind: agent.kind, time: this.time, position: point(agent),
      state: Object.freeze(this.stateOf(agent)) } as NpcEvent);
  }

  private setAction(agent: Agent, action: NpcAction): void {
    if (agent.action === action) return;
    const previous = agent.action;
    agent.action = action;
    this.emit(agent, { type: 'action', action, previous });
  }

  private remove(index: number, reason: Extract<NpcEvent, { type: 'despawn' }>['reason']): void {
    const agent = this.agents[index];
    if (agent.nearby) this.emit(agent, { type: 'proximity', phase: 'exit', targetId: agent.nearby.id, distance: agent.nearby.distance });
    this.emit(agent, { type: 'despawn', reason });
    this.agents.splice(index, 1);
  }

  private ground(position: Point2, kind: NpcKind, context?: GroundContext): GroundSample | undefined {
    this.groundQueries += 1;
    const sample = this.nav.groundAt(position, this.profiles[kind], context);
    return sample?.walkable && sample.surface !== 'water' && Number.isFinite(sample.height) ? sample : undefined;
  }

  private step(observer: Point3, stimuli: readonly NpcStimulus[]): void {
    this.time += FIXED_STEP;
    for (let i = 0; i < this.agents.length;) {
      const a = this.agents[i];
      a.age += FIXED_STEP;
      const distance = distance2(a, observer);
      if (distance > this.options.despawn) { this.remove(i, 'distance'); continue; }
      if (a.age > a.lifetime && distance > this.options.spawnMin) { this.remove(i, 'lifetime'); continue; }
      const sample = this.ground(a, a.kind, { referenceY: a.y, layerId: a.layerId });
      if (!sample || Math.abs(sample.height - a.y) > this.profiles[a.kind].maxStep) { this.remove(i, 'invalid-ground'); continue; }
      a.y = sample.height;
      a.surface = sample.surface;
      a.layerId = sample.layerId ?? a.layerId;
      this.react(a, stimuli);
      this.move(a, stimuli);
      i += 1;
    }
    // Four successful spawns maximum, and twelve attempts per species per tick.
    let budget = 4;
    for (const kind of NPC_KINDS) {
      let count = this.agents.filter(a => a.kind === kind).length;
      for (let tries = 0; tries < 12 && count < this.options.limits[kind]
        && budget > 0 && this.agents.length < this.options.maxTotal; tries += 1) {
        if (this.trySpawn(kind, observer, stimuli)) { count += 1; budget -= 1; }
      }
    }
  }

  private trySpawn(kind: NpcKind, observer: Point3, stimuli: readonly NpcStimulus[]): boolean {
    const zones = this.nav.spawnZones.filter(z => z.kinds.includes(kind)
      && this.agents.filter(a => a.zoneId === z.id).length < z.capacity);
    if (!zones.length) return false;
    const zone: SpawnZone = zones[Math.floor(this.random() * zones.length)];
    const route = this.routes.get(zone.routeId)!;
    const segment = Math.floor(this.random() * (route.points.length - (route.loop ? 0 : 1)));
    const start = route.points[segment];
    const end = route.points[(segment + 1) % route.points.length];
    const t = this.random();
    const x = start.x + (end.x - start.x) * t;
    const z = start.z + (end.z - start.z) * t;
    const p = { x, z };
    const distance = distance2(p, observer);
    if (distance < this.options.spawnMin || distance > this.options.spawnMax || distance2(p, zone.center) > zone.radius) return false;
    const context: GroundContext = { referenceY: zone.referenceY
      ?? (start.y !== undefined && end.y !== undefined ? start.y + (end.y - start.y) * t : start.y ?? end.y),
      layerId: zone.layerId ?? start.layerId ?? end.layerId };
    const sample = this.ground(p, kind, context);
    if (!sample) return false;
    const at = { x, y: sample.height, z };
    if (!this.spaceFree(at, at, kind, undefined, stimuli)) return false;
    this.traversalQueries += 1;
    if (!this.nav.canTraverse(at, at, this.profiles[kind], context)) return false;
    const a: Agent = {
      id: `npc-${++this.sequence}`, kind, x, y: at.y, z,
      heading: Math.atan2(end.x - start.x, -(end.z - start.z)), action: 'walk', speed: 0,
      gaitDistance: 0, age: 0, variant: Math.floor(this.random() * 8), surface: sample.surface,
      routeId: route.id, zoneId: zone.id, waypoint: (segment + 1) % route.points.length, direction: 1,
      bodyScale: this.bodyScale,
      layerId: sample.layerId ?? context.layerId,
      pauseUntil: 0, fleeUntil: 0, fleeX: 0, fleeZ: 0, reactionAfter: 0,
      lifetime: this.options.lifetime[0] + this.random() * (this.options.lifetime[1] - this.options.lifetime[0]),
      nextFootstep: this.profiles[kind].stride / 2,
      motionSpeed: 0, pauseAction: 'look',
    };
    this.agents.push(a);
    this.emit(a, { type: 'spawn' });
    return true;
  }

  private react(a: Agent, stimuli: readonly NpcStimulus[]): void {
    const profile = this.profiles[a.kind];
    let nearest: NpcStimulus | undefined;
    let nearestDistance = Infinity;
    for (const stimulus of stimuli) {
      const dy = stimulus.position.y - (a.y + profile.height / 2);
      const distance = Math.hypot(a.x - stimulus.position.x, dy, a.z - stimulus.position.z);
      const range = profile.reactionRadius * (a.nearby?.id === stimulus.id ? 1.4 : 1);
      if (distance <= range && distance < nearestDistance) {
        nearest = stimulus; nearestDistance = distance;
      }
    }
    if (a.nearby && a.nearby.id !== nearest?.id) {
      this.emit(a, { type: 'proximity', phase: 'exit', targetId: a.nearby.id, distance: a.nearby.distance });
      a.nearby = undefined;
    }
    if (!nearest) return;
    if (!a.nearby) this.emit(a, { type: 'proximity', phase: 'enter', targetId: nearest.id, distance: nearestDistance });
    a.nearby = { id: nearest.id, distance: nearestDistance };
    if (this.time < a.reactionAfter) return;
    const speed = Number.isFinite(nearest.speed) ? nearest.speed! : 0;
    const sudden = nearest.type === 'flap' || nearest.type === 'sudden-motion' || speed > 5;
    const close = nearestDistance < profile.radius + this.stimulusRadius(nearest) + 0.35 * this.bodyScale;
    const startle = a.kind === 'rat' || (a.kind === 'human' ? sudden && close : sudden || close);
    const response = startle ? 'startle' : 'look';
    a.reactionAfter = this.time + 4 + this.random() * 3;
    this.emit(a, { type: 'reaction', response, targetId: nearest.id });
    if (startle) {
      let dx = a.x - nearest.position.x; let dz = a.z - nearest.position.z;
      if (Math.hypot(dx, dz) < 0.001) { dx = Math.sin(a.variant + 1); dz = Math.cos(a.variant + 1); }
      const length = Math.hypot(dx, dz);
      a.fleeX = dx / length; a.fleeZ = dz / length;
      a.fleeUntil = this.time + 0.75 + this.random() * 0.75;
      const cue = { human: 'human-gasp', dog: 'dog-bark', cat: 'cat-mew', rat: 'rat-squeak' } as const;
      this.emit(a, { type: 'audio', cue: cue[a.kind], gain: a.kind === 'rat' ? 0.15 : 0.35, surface: a.surface });
    } else {
      a.pauseUntil = this.time + 0.7 + this.random() * 0.8;
      a.pauseAction = 'look';
    }
  }

  private move(a: Agent, stimuli: readonly NpcStimulus[]): void {
    a.speed = 0;
    const fleeing = this.time < a.fleeUntil;
    const profile = this.profiles[a.kind];
    const route = this.routes.get(a.routeId)!;
    let target = route.points[a.waypoint];
    if (!fleeing && this.time >= a.pauseUntil && distance2(a, target) < 0.10) {
      if (route.loop) a.waypoint = (a.waypoint + 1) % route.points.length;
      else {
        if (a.waypoint === 0) a.direction = 1;
        if (a.waypoint === route.points.length - 1) a.direction = -1;
        a.waypoint += a.direction;
      }
      target = route.points[a.waypoint];
      if (this.random() < profile.pauseChance) {
        a.pauseUntil = this.time + 0.7 + this.random() * 2;
        a.pauseAction = this.random() < 0.6 ? 'look' : 'idle';
      }
    }
    const dx = fleeing ? a.fleeX : target.x - a.x;
    const dz = fleeing ? a.fleeZ : target.z - a.z;
    const pausing = !fleeing && this.time < a.pauseUntil;
    const desiredSpeed = pausing ? 0 : fleeing ? profile.fleeSpeed : profile.walkSpeed;
    const acceleration = profile.acceleration * FIXED_STEP;
    a.motionSpeed += Math.max(-acceleration * 1.5, Math.min(acceleration, desiredSpeed - a.motionSpeed));
    if (a.motionSpeed < 0.01) { a.motionSpeed = 0; this.setAction(a, a.pauseAction); return; }
    const desired = pausing ? a.heading : Math.atan2(dx, -dz);
    const travel = Math.min(a.motionSpeed * FIXED_STEP, pausing || fleeing ? Infinity : Math.hypot(dx, dz));
    // Deterministic side preference reduces head-on symmetry. Map route recapture
    // always uses the same target; no teleporting or crossing unchecked corners.
    const side = Number(a.id.slice(4)) % 2 ? 1 : -1;
    const offsets = [0, 0.55 * side, -0.55 * side, 1.1 * side, -1.1 * side, 1.6 * side, -1.6 * side];
    for (const offset of offsets) {
      const heading = turnToward(a.heading, desired + offset, profile.turnRate * FIXED_STEP);
      const next = { x: a.x + Math.sin(heading) * travel, y: a.y, z: a.z - Math.cos(heading) * travel };
      const sample = this.canMove(a, next, stimuli);
      if (!sample) continue;
      const moved = distance2(a, next);
      a.x = next.x; a.y = sample.height; a.z = next.z;
      a.heading = heading; a.surface = sample.surface;
      a.layerId = sample.layerId ?? a.layerId;
      a.speed = moved / FIXED_STEP; a.gaitDistance += moved;
      a.motionSpeed = a.speed;
      this.setAction(a, fleeing ? 'startle' : offset === 0 ? 'walk' : 'avoid');
      if (a.gaitDistance >= a.nextFootstep) {
        // Match the model's fixed distance/stride origin. Overshoot must not
        // accumulate into a new phase; collapse skipped contacts to <=1 cue/tick.
        const halfStride = profile.stride / 2;
        a.nextFootstep = (Math.floor((a.gaitDistance + 1e-9) / halfStride) + 1) * halfStride;
        this.emit(a, { type: 'audio', cue: a.kind === 'rat' ? 'rustle' : 'footstep',
          gain: a.kind === 'human' ? 0.20 : a.kind === 'dog' ? 0.12 : 0.06, surface: a.surface });
      }
      return;
    }
    this.setAction(a, fleeing ? 'startle' : 'look');
    a.motionSpeed = 0;
    a.heading = turnToward(a.heading, desired + side * Math.PI / 2, profile.turnRate * FIXED_STEP);
    a.pauseUntil = this.time + FIXED_STEP;
  }

  private canMove(a: Agent, to: Point3, stimuli: readonly NpcStimulus[]): GroundSample | undefined {
    const profile = this.profiles[a.kind];
    const slices = Math.max(1, Math.ceil(distance2(a, to) / 0.10));
    let previousHeight = a.y;
    let layerId = a.layerId;
    let sample: GroundSample | undefined;
    for (let i = 1; i <= slices; i += 1) {
      sample = this.ground({ x: a.x + (to.x - a.x) * i / slices, z: a.z + (to.z - a.z) * i / slices }, a.kind,
        { referenceY: previousHeight, layerId });
      if (!sample || Math.abs(sample.height - previousHeight) > profile.maxStep
        || Math.abs(sample.height - a.y) > profile.maxStep + distance2(a, to) * 0.5) return undefined;
      previousHeight = sample.height;
      layerId = sample.layerId ?? layerId;
    }
    if (!sample) return undefined;
    const groundedTo = { ...to, y: sample.height };
    this.traversalQueries += 1;
    if (!this.nav.canTraverse(a, groundedTo, profile, { referenceY: a.y, layerId: a.layerId })
      || !this.spaceFree(a, groundedTo, a.kind, a.id, stimuli)) return undefined;
    return sample;
  }

  private spaceFree(from: Point3, to: Point3, kind: NpcKind, id: string | undefined, stimuli: readonly NpcStimulus[]): boolean {
    const profile = this.profiles[kind];
    const intersects = (p: Point2, radius: number): boolean => {
      const clearance = profile.radius + radius + 0.03;
      const before = distance2(p, from); const after = distance2(p, to);
      // A player may enter an NPC between ticks. Permit monotonic escape from
      // that overlap, rather than trapping the startled animal in place.
      if (before < clearance && after > before + 1e-7) return false;
      const dx = to.x - from.x; const dz = to.z - from.z;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.z - from.z) * dz) / lengthSq)) : 0;
      return Math.hypot(p.x - from.x - dx * t, p.z - from.z - dz * t) < clearance;
    };
    for (const other of this.agents) {
      if (other.id === id || from.y + profile.height <= other.y || other.y + this.profiles[other.kind].height <= from.y) continue;
      if (intersects(other, this.profiles[other.kind].radius)) return false;
    }
    for (const stimulus of stimuli) {
      // A high flying bird casts no invisible wall on the sidewalk.
      const radius = this.stimulusRadius(stimulus);
      const halfHeight = Number.isFinite(stimulus.halfHeight)
        ? Math.max(0, Math.min(4 * this.bodyScale, stimulus.halfHeight!)) : radius;
      if (stimulus.position.y - halfHeight > from.y + profile.height || stimulus.position.y + halfHeight < from.y) continue;
      if (intersects(stimulus.position, radius)) return false;
    }
    return true;
  }

  private stimulusRadius(stimulus: NpcStimulus): number {
    return Number.isFinite(stimulus.radius) ? Math.max(0, Math.min(2 * this.bodyScale, stimulus.radius!)) : 0.20 * this.bodyScale;
  }
}
