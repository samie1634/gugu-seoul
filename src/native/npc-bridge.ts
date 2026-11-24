import * as THREE from 'three';
import type { MapLayout } from './ported/map/contracts.ts';
import { createNpcModelLayer } from './ported/npcs/models/index.ts';
import { createMapNpcAdapter } from './ported/npcs/runtime/map-adapter.ts';
import { NpcSystem } from './ported/npcs/runtime/simulation.ts';
import type { NpcClockFrame, NpcEvent, NpcOptions, NpcStimulus, Point3 } from './ported/npcs/src/contracts.ts';
import type { NativeBody } from './ported/motion/locomotion/b2/contracts.ts';

export interface NativeNpcPlayer extends Point3 {
  readonly body: NativeBody;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly flap: boolean;
  readonly coo: boolean;
  readonly speciesId?: string;
  readonly grounded?: boolean;
}

/** The scene's accepted commit is the sole clock, model-sync and raw-drain owner. */
export function createNativeNpcBridge(parent: THREE.Scene, layout: MapLayout, sharedSimTime = 0, options: NpcOptions = {}) {
  if (!Number.isFinite(sharedSimTime) || sharedSimTime < 0) throw new RangeError('Invalid shared NPC epoch');
  const adapter = createMapNpcAdapter(layout, { bodyScale: 1, feedingWalks: true, landmarkCrowds: true });
  const crowdLimits = layout.realMap ? { human: layout.quality === 'mobile' ? 24 : 32 } : {};
  const system = new NpcSystem(adapter.navigation, { ...options, limits: { ...crowdLimits, ...options.limits }, bodyScale: 1 });
  const models = createNpcModelLayer(parent, 48);
  models.root.traverse(object => {
    if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
  });
  const epoch = Object.freeze({ sharedSimTime, localSimTime: system.stats.time });
  let lastClock: Readonly<NpcClockFrame> | null = null;
  let signal: 'flap' | 'coo' | null = null;
  let pendingPeck: NpcStimulus | null = null;
  let acceptedCommits = 0;
  let drains = 0;
  let syncs = 0;
  let disposed = false;

  return {
    adapter, models,
    notifyPeck(id: string, at: Point3): boolean {
      if (disposed || ![at.x, at.y, at.z].every(Number.isFinite)) return false;
      const target = system.snapshot().find(npc => npc.id === id);
      if (!target || Math.hypot(target.x - at.x, target.y - at.y, target.z - at.z) > .65) return false;
      pendingPeck = { id: 'player-bird-peck', type: 'sudden-motion', position: { ...at, y: at.y + .15 }, speed: 2, radius: .12, halfHeight: .15 }; return true;
    },
    captureRat(id: string, at: Point3): boolean {
      if (disposed || ![at.x, at.y, at.z].every(Number.isFinite)) return false;
      const rat = system.snapshot().find(npc => npc.id === id && npc.kind === 'rat');
      if (!rat || Math.hypot(rat.x - at.x, rat.y - at.y, rat.z - at.z) > .25) return false;
      return system.despawn(id);
    },
    commit(clock: NpcClockFrame, observer: Point3, player: NativeNpcPlayer, flyingBirds: readonly NpcStimulus[] = []): readonly NpcEvent[] {
      // Reject before queuing a transient signal or entering the stateful producer.
      if (disposed || !clock.playing || !Number.isInteger(clock.frame) || clock.frame < 0 ||
        !Number.isFinite(clock.simTime) || !Number.isFinite(clock.acceptedSeconds) ||
        clock.acceptedSeconds <= 0 || clock.acceptedSeconds > .1 ||
        clock.simTime + 1e-9 < (lastClock?.simTime ?? epoch.sharedSimTime) + clock.acceptedSeconds ||
        clock.frame <= (lastClock?.frame ?? -1) ||
        player.body.horizontalRadiusM <= 0 || player.body.heightM <= 0 ||
        ![observer.x, observer.y, observer.z, player.x, player.y, player.z, player.vx, player.vy, player.vz,
          player.body.horizontalRadiusM, player.body.heightM].every(Number.isFinite)) return [];
      const nextSignal = player.flap || signal === 'flap' ? 'flap' : player.coo || signal === 'coo' ? 'coo' : null;
      const stimulus: NpcStimulus = { id: 'player-bird', type: nextSignal ?? 'presence',
        position: { x: player.x, y: player.y, z: player.z }, speed: Math.hypot(player.vx, player.vy, player.vz),
        radius: player.body.horizontalRadiusM, halfHeight: player.body.heightM / 2,
        ...(player.speciesId && typeof player.grounded === 'boolean' ? { birdFlight: { species: player.speciesId, airborne: !player.grounded, velocity: { x: player.vx, y: player.vy, z: player.vz } } } : {}) };
      const before = system.stats.time;
      if (!system.updateFrame(clock, { observer, stimuli: [...(pendingPeck ? [pendingPeck, stimulus] : [stimulus]), ...flyingBirds] })) return [];
      lastClock = Object.freeze({ ...clock }); acceptedCommits++;
      // A short flap between20Hz steps survives until a step actually consumes it.
      signal = system.stats.time > before ? null : nextSignal;
      if (system.stats.time > before) pendingPeck = null;
      models.sync(system.snapshot()); syncs++;
      drains++;
      return system.drainEvents();
    },
    toSharedTime(localTime: number): number { return epoch.sharedSimTime + localTime - epoch.localSimTime; },
    snapshot() { return { states: system.snapshot(), stats: system.stats, modelStats: models.stats,
      epoch, lastClock, acceptedCommits, drains, syncs, pendingSignal: signal,
      routes: adapter.navigation.routes.map(route => route.id), spawnZones: adapter.navigation.spawnZones,
      excludedEdges: adapter.excludedEdges, road: adapter.road, rootScale: models.root.scale.toArray(), disposed }; },
    dispose(): readonly NpcEvent[] {
      if (disposed) return [];
      disposed = true; signal = null; pendingPeck = null;
      system.dispose();
      const events = system.drainEvents(); drains++;
      models.sync([]); models.dispose();
      return events;
    },
  };
}
