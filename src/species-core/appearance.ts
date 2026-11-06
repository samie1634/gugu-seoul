import type { Appearance, SpeciesId } from '../native/ported/shared-contracts.ts';
import type { BirdLod } from '../native/ported/birds/rig-core/contract.ts';

export const SPECIES: readonly SpeciesId[] = Object.freeze(['pigeon', 'sparrow', 'crow', 'magpie', 'tawny-owl', 'eagle-owl', 'kestrel']);
const appearances: Appearance[] = [
  { speciesId: 'pigeon', skinId: 'gray' }, { speciesId: 'pigeon', skinId: 'white' },
  ...SPECIES.filter(s => s !== 'pigeon').map(speciesId => ({ speciesId, skinId: 'default' as const })),
];
export const APPEARANCES: readonly Appearance[] = Object.freeze(appearances.map(a => Object.freeze(a)));

/** Runtime validation is separate from the upstream type-only dispatch adapter. */
export function normalizeAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') throw new RangeError('Missing appearance');
  const { speciesId, skinId } = value as Partial<Appearance>;
  if (!SPECIES.includes(speciesId as SpeciesId)) throw new RangeError('Unsupported species');
  if (speciesId === 'pigeon') {
    if (skinId !== 'default' && skinId !== 'gray' && skinId !== 'white') throw new RangeError('Unsupported pigeon skin');
    return Object.freeze({ speciesId, skinId: skinId === 'default' ? 'gray' : skinId });
  }
  if (skinId !== 'default') throw new RangeError('Only pigeon has alternate skins');
  return Object.freeze({ speciesId: speciesId as Exclude<SpeciesId, 'pigeon'>, skinId });
}

export function validateLod(value: unknown): BirdLod {
  if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('Unsupported bird LOD');
  return value;
}

/** This wrapper does not change the app's LookId, progress or product policy. */
export function appearanceForLegacy(look: unknown): Appearance {
  if (look === 'pigeon') return normalizeAppearance({ speciesId: 'pigeon', skinId: 'gray' });
  if (look === 'white') return normalizeAppearance({ speciesId: 'pigeon', skinId: 'white' });
  if (look === 'owl') return normalizeAppearance({ speciesId: 'eagle-owl', skinId: 'default' });
  throw new RangeError('Unsupported legacy look');
}
