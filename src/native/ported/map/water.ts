/** Stable root facade; the water team owns the implementation below water/. */
export { createRiverWater } from './water/index.ts';
import type { createRiverWater } from './water/index.ts';
export type WaterLayer = ReturnType<typeof createRiverWater>;
