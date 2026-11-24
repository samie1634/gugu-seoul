import type { HumanGender } from './contracts.ts';
/** Authored fictional cast metadata. Never infer gender from clothes, colour or body shape. */
export const HUMAN_CHARACTERS: readonly { id: string; gender: HumanGender; hair: 'tied' | 'short'; hairColor: number }[] = Object.freeze([
  { id: 'pedestrian-01', gender: 'female', hair: 'tied', hairColor: 0x2d2524 },
  { id: 'pedestrian-02', gender: 'male', hair: 'short', hairColor: 0x342c28 },
  { id: 'pedestrian-03', gender: 'female', hair: 'short', hairColor: 0x332c2b },
  { id: 'pedestrian-04', gender: 'male', hair: 'short', hairColor: 0x282829 },
  { id: 'pedestrian-05', gender: 'female', hair: 'tied', hairColor: 0x3b2d27 },
  { id: 'pedestrian-06', gender: 'male', hair: 'short', hairColor: 0x383232 },
  { id: 'pedestrian-07', gender: 'female', hair: 'short', hairColor: 0x292526 },
  { id: 'pedestrian-08', gender: 'male', hair: 'short', hairColor: 0x24272a },
]);
