export * from '../src/contracts.ts';
export { DEFAULT_LIMITS, FIXED_STEP, MAX_FRAME_SECONDS, HARD_MAX_NPCS, NPC_KINDS, PROFILES, scaleProfiles } from '../src/profiles.ts';
export { NpcSystem, type NpcStats } from './simulation.ts';
export { createAabbNavigation, type AabbNavigationInput, type LegacyObstacle } from './legacy-adapter.ts';
export { createMapNpcAdapter, type MapNpcAdapter, type MapNpcAdapterOptions } from './map-adapter.ts';
// The independently owned model team exports its layer from ../models/index.ts.
