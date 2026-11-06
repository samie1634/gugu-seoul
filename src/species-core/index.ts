export { APPEARANCES, SPECIES, appearanceForLegacy, normalizeAppearance, validateLod } from './appearance.ts';
export { buildNativeAppearance, measureOriginRig, localGeometryBounds, defaultBuildRig, NEUTRAL_POSE } from './assets.ts';
export type { AssetDependencies, BirdAsset, Measurement, Bounds } from './assets.ts';
export { createSpeciesActor, SHARED_GAME_TUNING } from './actor.ts';
export type { SpeciesOptions, SpeciesCursor, CandidateDependencies, CandidateView, SpeciesFrame, SpeciesSwap, SpeciesEmission, Blocked } from './actor.ts';
export { LANDING_BLEND_SECONDS, toBirdPoseInput } from './upstream/pose-input.ts';
export { resolveFirstPersonPoseRebind } from './first-person-rebind.ts';
export type { FirstPersonPoseRebindRequest, PoseRebindResult } from './first-person-rebind.ts';
