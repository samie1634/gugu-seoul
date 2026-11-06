/** Metres, Y up, north/forward at heading zero is -Z. All positions are feet. */
export type NpcKind = 'human' | 'dog' | 'cat' | 'rat';
export type NpcAction = 'idle' | 'walk' | 'look' | 'avoid' | 'startle';
export type Surface = 'stone' | 'granite' | 'asphalt' | 'wood' | 'metal' | 'roof-tile' | 'water' | 'glass' | 'soil' | 'paving' | 'grass';
export interface Point2 { readonly x: number; readonly z: number }
export interface Point3 extends Point2 { readonly y: number }
export interface Probe {
  readonly kind: NpcKind;
  readonly radius: number;
  /** Ground to maximum animated head/ear clearance, not shoulder/torso height. */
  readonly height: number;
  readonly maxStep?: number;
}
export interface GroundSample {
  readonly height: number;
  readonly walkable: boolean;
  readonly surface: Surface;
  readonly layerId?: string;
}
export interface GroundContext { readonly referenceY?: number; readonly layerId?: string }
export interface NpcWaypoint extends Point2 { readonly y?: number; readonly layerId?: string }
export interface NpcRoute {
  readonly id: string;
  readonly kinds: readonly NpcKind[];
  readonly points: readonly NpcWaypoint[];
  readonly loop: boolean;
}
export interface SpawnZone {
  readonly id: string;
  readonly routeId: string;
  readonly kinds: readonly NpcKind[];
  readonly center: Point2;
  readonly radius: number;
  readonly capacity: number;
  readonly referenceY?: number;
  readonly layerId?: string;
}
/**
 * Map-owned navigation. groundAt checks the whole probe footprint, water and
 * vertical clearance. canTraverse checks a swept upright cylinder against the
 * current map, including moving blockers. NPCs also sample height along a step.
 * Only give sidewalk/plaza/service-edge routes; traffic lanes are not inferred.
 */
export interface NpcNavigation {
  readonly routes: readonly NpcRoute[];
  readonly spawnZones: readonly SpawnZone[];
  groundAt(point: Point2, probe: Probe, context?: GroundContext): GroundSample | undefined;
  canTraverse(from: Point3, to: Point3, probe: Probe, context?: GroundContext): boolean;
}
export interface NpcStimulus {
  readonly id: string;
  /** Body-center anchor in the same scene units; do not pass an eye/feet anchor. */
  readonly position: Point3;
  readonly type: 'presence' | 'flap' | 'coo' | 'sudden-motion';
  /** Metres/second; supply actual speed rather than a frame delta. */
  readonly speed?: number;
  readonly radius?: number;
  /** Upright body half-height; omitted means sphere with the supplied radius. */
  readonly halfHeight?: number;
}
export interface NpcFrame {
  /** Camera/player position: planar distance controls activation, even in flight. */
  readonly observer: Point3;
  readonly stimuli?: readonly NpcStimulus[];
}
/** Structural subset of coordination FrameContext; no wall/audio clock is used. */
export interface NpcClockFrame {
  readonly frame: number;
  readonly simTime: number;
  readonly acceptedSeconds: number;
  readonly playing: boolean;
}
export interface NpcState extends Point3 {
  readonly id: string;
  readonly kind: NpcKind;
  readonly heading: number;
  readonly action: NpcAction;
  readonly speed: number;
  /** Cumulative metres actually moved; animation uses this, never wall time. */
  readonly gaitDistance: number;
  readonly age: number;
  readonly variant: number;
  readonly surface: Surface;
  readonly routeId: string;
  /** Provisional reference anatomy -> shared scene scale. Renderer must apply it. */
  readonly bodyScale: number;
  readonly layerId?: string;
}
interface EventBase {
  readonly npcId: string;
  readonly kind: NpcKind;
  readonly time: number;
  readonly position: Point3;
  /** Frozen source-time pose. Retained after later ticks/despawn for voice anchors. */
  readonly state: NpcState;
}
export type NpcAudioCue = 'footstep' | 'rustle' | 'human-gasp' | 'dog-bark' | 'cat-mew' | 'rat-squeak';
export type NpcEvent = EventBase & (
  | { readonly type: 'spawn' }
  | { readonly type: 'despawn'; readonly reason: 'distance' | 'lifetime' | 'invalid-ground' | 'manual' | 'dispose' }
  | { readonly type: 'action'; readonly action: NpcAction; readonly previous: NpcAction }
  | { readonly type: 'proximity'; readonly phase: 'enter' | 'exit'; readonly targetId: string; readonly distance: number }
  | { readonly type: 'reaction'; readonly response: 'look' | 'startle'; readonly targetId: string }
  | { readonly type: 'audio'; readonly cue: NpcAudioCue; readonly gain: number; readonly surface: Surface }
);
export interface NpcLimits { readonly human: number; readonly dog: number; readonly cat: number; readonly rat: number }
export interface NpcOptions {
  readonly seed?: number;
  readonly limits?: Partial<NpcLimits>;
  readonly maxTotal?: number;
  readonly spawnMinDistance?: number;
  readonly spawnMaxDistance?: number;
  readonly despawnDistance?: number;
  readonly lifetimeSeconds?: readonly [number, number];
  readonly eventCapacity?: number;
  /** Supply the total-design-approved common scale; default 1 is test-only reference. */
  readonly bodyScale?: number;
}
