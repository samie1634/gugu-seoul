import type { Appearance } from '../../native/ported/shared-contracts.ts';
import type { LookId } from '../../progress.ts';
import type { BirdBuildOptions, BirdLod, BirdMorph, SpeciesId } from '../../native/ported/birds/rig-core/contract.ts';
import { createBirdRig, type BirdModelFactory, type BirdPoseInput, type BirdRig, type BirdRigSettings } from '../../native/ported/birds/rig-core/rig.ts';

const candidateLooks = {
  'pigeon-gray': { species: 'pigeon', morph: 'gray' },
  'pigeon-white': { species: 'pigeon', morph: 'white' },
  sparrow: { species: 'sparrow', morph: 'default' },
  crow: { species: 'crow', morph: 'default' },
  magpie: { species: 'magpie', morph: 'default' },
  'tawny-owl': { species: 'tawny-owl', morph: 'default' },
  'eagle-owl': { species: 'eagle-owl', morph: 'default' },
  kestrel: { species: 'kestrel', morph: 'default' },
} as const satisfies Record<string, { species: SpeciesId; morph: BirdMorph }>;

export type CandidateLookId = keyof typeof candidateLooks;
export const CANDIDATE_LOOKS = Object.freeze(Object.keys(candidateLooks) as CandidateLookId[]);

const legacyLooks: Record<LookId, CandidateLookId> = {
  pigeon: 'pigeon-gray',
  white: 'pigeon-white',
  owl: 'eagle-owl',
};

export function candidateLookForLegacy(look: LookId): CandidateLookId {
  return legacyLooks[look];
}

export function optionsForCandidateLook(look: CandidateLookId, lod: BirdLod): BirdBuildOptions {
  return { ...candidateLooks[look], lod };
}

export function optionsForAppearance(appearance: Appearance, lod: BirdLod): BirdBuildOptions {
  const { speciesId: species, skinId } = appearance;
  const morph = species === 'pigeon' && skinId === 'default' ? 'gray' : skinId;
  return { species, morph, lod };
}

export function createCandidateFactory(urban: BirdModelFactory, raptors: BirdModelFactory): BirdModelFactory {
  return (options) => {
    switch (options.species) {
      case 'pigeon':
      case 'sparrow':
      case 'crow':
      case 'magpie':
        return urban(options);
      case 'tawny-owl':
      case 'eagle-owl':
      case 'kestrel':
        return raptors(options);
      default:
        throw new RangeError('Unsupported bird species');
    }
  };
}

export function createLegacyBirdRig(look: LookId, buildModel: BirdModelFactory, lod: BirdLod = 0, settings?: BirdRigSettings) {
  return createBirdRig(optionsForCandidateLook(candidateLookForLegacy(look), lod), buildModel, settings);
}

/** Positional pose adapter for existing gameplay and world callers. */
export function poseLegacyBird(
  rig: BirdRig, mode: BirdPoseInput['mode'], time: number, flapAge: number, steps: number, cooAge = 10,
): void {
  rig.pose({ mode, time, flapAge, steps, callAge: cooAge });
}
