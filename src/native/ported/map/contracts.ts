import type { Obstacle } from '../../../simulation.ts';
export const MAP_CONTRACT_VERSION = 2 as const;

export interface MapPoint { x: number; y: number; z: number }
export interface MapRect { x: number; z: number; width: number; depth: number }
export type SurfaceKind = 'stone' | 'granite' | 'asphalt' | 'wood' | 'metal' | 'roof-tile' | 'water' | 'glass' | 'soil';
export type TerrainMode = 'flat-compatible' | 'sunken-channel';
export type MapQuality = 'mobile' | 'desktop';
export interface MapOptions { terrain?: TerrainMode; quality?: MapQuality; proportions?: 'reference-scale' | 'legacy-compressed'; eventSessionId?: string }

/** height is an absolute top, NOT a box thickness; minY is an absolute bottom. */
export interface MapCollider extends Obstacle {
  id: string;
  surface: SurfaceKind;
  kind: 'building' | 'roof' | 'wall' | 'prop' | 'bridge' | 'column' | 'monument';
}
export interface LandingSurface extends MapRect {
  id: string;
  y: number;
  surface: SurfaceKind;
  /** Maximum radius of the foot support disk, independent of body clearance. */
  maxFootRadius: number;
  /** Conservative AABB roof bands can sit up to this far above the pitched mesh. */
  approximation: number;
}
export interface GroundProbe { feetY: number; maxStep?: number; height?: number }
export interface GroundSample {
  y: number;
  surface: SurfaceKind;
  walkable: boolean;
  zone: 'street' | 'square' | 'courtyard' | 'promenade' | 'ramp' | 'bridge' | 'riverbed';
}
export interface NavNode extends MapPoint { id: string; zone: GroundSample['zone'] }
export interface NavEdge {
  a: string;
  b: string;
  width: number;
  kind: 'walk' | 'crossing' | 'ramp';
  requiresTrafficCheck: boolean;
}
export interface SpawnPoint extends MapPoint { id: string; clearance: number; for: readonly ('human' | 'dog' | 'cat' | 'rat' | 'bird')[] }
export interface MapActor extends MapPoint {
  id: string;
  /** Current BirdState.y is body centre. feetY = y - radius. */
  radius: number;
  grounded: boolean;
  /** Optional actual sole/toe support radius. Defaults to body radius conservatively. */
  footRadius?: number;
  centreToSole?: number;
  horizontalRadius?: number;
}
export interface MapSurfaceEvent extends MapPoint {
  type: 'surface-contact' | 'prop-perch' | 'water-enter' | 'water-exit';
  producer: 'map';
  sessionId: string;
  sequence: number;
  eventId: string;
  actorId: string;
  targetId: string;
  surface: SurfaceKind;
  strength: number;
  time: number;
}
export interface WaterConfig {
  id: 'cheonggyecheon';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  bedY: number;
  /** Direction is unit +X; speed is a visual art direction value, not a measured current. */
  flowX: number;
  flowZ: number;
  flowSpeed: number;
}
export interface WaterContact {
  id: string;
  y: number;
  depth: number;
  current: { x: number; z: number };
}
export interface BuildingSpec extends MapRect {
  id: string;
  height: number;
  palette: 'limestone' | 'concrete' | 'brick';
  facade: 'punched' | 'curtain';
}
export interface RoofSpec extends MapRect {
  id: string;
  y: number;
  rise: number;
  eaveUpturn?: number;
}
export interface PropSpec extends MapPoint { id: string; kind: 'bench' | 'bollard' | 'planter' | 'lamp' }
export interface MapLayout {
  terrain: TerrainMode;
  proportions: 'reference-scale' | 'legacy-compressed';
  quality: MapQuality;
  water: WaterConfig;
  promenadeY: number;
  buildings: BuildingSpec[];
  roofs: RoofSpec[];
  props: PropSpec[];
  colliders: MapCollider[];
  landingSurfaces: LandingSurface[];
  navNodes: NavNode[];
  navEdges: NavEdge[];
  spawns: SpawnPoint[];
}

