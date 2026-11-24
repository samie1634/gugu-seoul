import type { SurfaceKind } from '../contracts.ts';
/** Metric EPSG:5186 offsets. x east, z south. Closed rings, outer then holes. */
export interface RealPolygon {
  id: string; sourceId: string; rings: number[][][]; height: number; minY: number;
  surface: SurfaceKind; heightStatus: string; name?: string;
  sourceHeight: number | null; measured: false;
}
export interface RealRoad {
  id: string; sourceId: string; rings: number[][][]; width: number;
  walkable: boolean; surface: SurfaceKind; bridge: boolean; underground: boolean;
  centerline?: number[][]; widthStatus: string; highway: string;
}
export interface RealMapData {
  buildings: RealPolygon[]; water: RealPolygon[]; roads: RealRoad[];
  origin: number[]; bounds: {minX:number;maxX:number;minZ:number;maxZ:number};
  sourceDate: string; license: string; heightCounts: Record<string,number>;
}
