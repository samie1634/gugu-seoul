/**
 * Coordination contract v1: type-only integration target, not imported by the app.
 * Producer APIs are adapted by the sole integration owner. No producer source is edited here.
 * One unit = one real metre; +Y up, +X east, -Z north; heading zero faces -Z.
 */
export type SpeciesId = 'pigeon' | 'sparrow' | 'crow' | 'magpie' | 'tawny-owl' | 'eagle-owl' | 'kestrel';
export type SkinId = 'default' | 'gray' | 'white';
export type Appearance =
  | { readonly speciesId: 'pigeon'; readonly skinId: 'default' | 'gray' | 'white' }
  | { readonly speciesId: Exclude<SpeciesId, 'pigeon'>; readonly skinId: 'default' };
export type LegacyLookId = 'pigeon' | 'white' | 'owl'; // legacy owl always means eagle-owl
export type AppearanceId = 'pigeon-gray' | 'pigeon-white' | Exclude<SpeciesId, 'pigeon'>;
export type BirdMode = 'rest' | 'walk' | 'flap' | 'glide' | 'fall';
export type NpcKind = 'human' | 'dog' | 'cat' | 'rat';
export type NpcAction = 'idle' | 'walk' | 'look' | 'avoid' | 'startle';
export type SurfaceId = 'stone' | 'granite' | 'asphalt' | 'wood' | 'metal' | 'roof-tile' | 'water' | 'glass' | 'soil' | 'paving' | 'grass';
export interface Vec2 { readonly x: number; readonly z: number }
export interface Vec3 extends Vec2 { readonly y: number }

export interface FrameContext {
  readonly contractVersion: 1;
  readonly frame: number;
  readonly simTime: number; // cumulative acceptedSeconds, not AudioContext.currentTime
  readonly rawSeconds: number; // finite, capped to .25 before acceptance
  readonly acceptedSeconds: number; // <= .1; same value for physics, progress, world, pose, NPC
  readonly playing: boolean;
  readonly quality: 'desktop' | 'mobile';
  readonly reducedMotion: boolean;
}
export interface FlightInput {
  readonly forward: number;
  readonly turn: number;
  readonly flapPressed: boolean; // aggregate 0->1 edge, consumed once
  readonly flapHeld: boolean; // any owning key/pointer is held
  readonly descend: boolean;
}
export interface BodyProfile {
  readonly horizontalRadiusM: number;
  readonly heightM: number;
  readonly centreToSoleM: number; // not necessarily horizontalRadiusM
  readonly eyeFromSoleM: Vec3;
}
export interface BirdSnapshot extends Vec3 {
  readonly actorId: string;
  readonly appearance: Appearance;
  readonly heading: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly grounded: boolean;
  readonly mode: BirdMode;
  readonly steps: number; // actual ground metres
  readonly flaps: number;
  readonly flapAge: number;
  readonly heldSeconds: number;
  readonly body: BodyProfile; // x/y/z remain physics body centre
}
export interface BirdMetrics {
  readonly bodyLengthM: number;
  readonly wingspanM: number;
  readonly standingHeightM: number;
  readonly footY: 0; // native visual root is soles on zero, native scale 1
  readonly eye: readonly [number, number, number];
}
export interface RigDescriptor {
  readonly speciesId: SpeciesId;
  readonly modelForward: '-Z';
  readonly pivotNames: readonly ('head' | 'leftWing' | 'rightWing' | 'tail' | 'leftFoot' | 'rightFoot')[];
  readonly metrics: BirdMetrics;
}
export interface StaticCollider extends Vec2 {
  readonly id: string;
  readonly width: number;
  readonly depth: number;
  readonly height: number; // absolute top Y, NOT thickness
  readonly minY?: number; // absolute bottom Y, default 0
}
export interface Probe {
  readonly kind: NpcKind | 'bird';
  readonly radiusM: number;
  readonly heightM: number;
  readonly maxStepM: number;
}
export interface SurfaceSample {
  readonly id: string;
  readonly layerId: string;
  readonly height: number;
  readonly normal: Vec3;
  readonly surface: SurfaceId;
  readonly walkable: boolean;
  readonly landable: boolean;
  readonly waterDepthM: number;
}
export interface NavNode extends Vec3 {
  readonly id: string;
  readonly layerId: string;
  readonly allowedKinds: readonly NpcKind[];
  readonly zone: 'sidewalk' | 'plaza' | 'service-edge' | 'bridge' | 'promenade' | 'ramp';
}
export interface NavEdge {
  readonly from: string;
  readonly to: string;
  readonly widthM: number;
  readonly allowedKinds: readonly NpcKind[];
  readonly requiresTrafficCheck: boolean;
}
export interface WorldQueries {
  readonly obstacles: readonly StaticCollider[];
  readonly navNodes: readonly NavNode[];
  readonly navEdges: readonly NavEdge[];
  // Point Y is the existing feet/support context; never discard it at bridges.
  sampleSurface(point: Vec3, probe: Probe, layerId?: string): SurfaceSample | undefined;
  canTraverse(from: Vec3, to: Vec3, probe: Probe): boolean;
}
export interface ProgressV2 {
  readonly version: 2;
  readonly activeSeconds: number;
  readonly appearance: Appearance;
  readonly muted: boolean;
}
export interface UnlockDefinition {
  readonly id: AppearanceId;
  readonly appearance: Appearance;
  readonly unlockAtActiveSeconds: number;
  readonly displayName: string;
}
export interface NpcSnapshot extends Vec3 {
  readonly actorId: string;
  readonly kind: NpcKind;
  readonly action: NpcAction;
  readonly heading: number;
  readonly speed: number;
  readonly gaitDistance: number;
  readonly age: number;
  readonly surface: SurfaceId;
  // NPC y is feet height. Keep producer bodyScale/maxStep via explicit adapter.
}
interface EventBase {
  readonly id: string; // stable sessionId:batchSequence:itemIndex; retain on redelivery
  readonly sessionId: string;
  readonly batchSequence: number;
  readonly itemIndex: number;
  readonly seq: number; // monotonic session counter, assigned by one drain/envelope owner
  readonly simTime: number;
  readonly sourceId: string; // producer provenance/stream, NOT the physical emitter
  readonly actorId: string; // physical actor/emitter; AudioEvent.emitterId = actorId
  readonly position: Vec3; // physical contact/emitter point, not arbitrary body centre
}
export type SceneEvent = EventBase & (
  | { readonly type: 'flap'; readonly speciesId: SpeciesId }
  | { readonly type: 'mode-change'; readonly from: BirdMode; readonly to: BirdMode }
  | { readonly type: 'bird-call'; readonly speciesId: SpeciesId; readonly cause: 'manual' | 'walk-auto' }
  | { readonly type: 'land'; readonly surface: SurfaceId; readonly supportId: string; readonly impactSpeed: number }
  | { readonly type: 'footstep'; readonly surface: SurfaceId; readonly strength: number }
  | { readonly type: 'npc-reaction'; readonly targetId: string; readonly kind: NpcKind; readonly response: 'look' | 'startle' }
  | { readonly type: 'npc-audio'; readonly kind: NpcKind; readonly cue: 'footstep' | 'rustle' | 'human-gasp' | 'dog-bark' | 'cat-mew' | 'rat-squeak'; readonly gain: number; readonly surface: SurfaceId }
  | { readonly type: 'surface-contact' | 'water-enter' | 'water-exit' | 'prop-perch'; readonly targetId: string; readonly surface: SurfaceId; readonly strength: number }
  | { readonly type: 'unlock'; readonly appearanceId: AppearanceId; readonly activeSeconds: number }
);
export type GameEvent = SceneEvent;
export interface CandidateLifecycle<TRoot> {
  readonly root: TRoot;
  update(frame: FrameContext, events: readonly SceneEvent[]): void;
  dispose(): void; // idempotent; own resources only, never shared cityMaterial/parent
}
export interface AssetRights {
  readonly id: string;
  readonly source: string; // public URL or approved asset identifier, never private/auth path
  readonly origin: 'original' | 'user-provided' | 'third-party';
  readonly license: string;
  readonly evidence: readonly string[];
  readonly redistributionVerified: boolean;
  readonly attributionRequired: boolean;
}
