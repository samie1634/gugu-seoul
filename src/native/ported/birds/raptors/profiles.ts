
import type { Vec } from './mesh.ts';

export type RaptorSpecies = 'tawny-owl' | 'eagle-owl' | 'kestrel';

/** [fraction of half-wing from shoulder, leading Z, trailing Z, centre Y, thickness]. */
export type WingStation = readonly [span: number, front: number, back: number, y: number, thickness: number];

interface ShellProfile {
  center: Vec;
  radii: Vec;
  pitch: number;
  crown?: number;
}

export interface Profile {
  /** Anatomical total length target, bill tip to tail tip with posture standardized. */
  bodyLength: number;
  wingspan: number;
  height: number;
  body: ShellProfile;
  head: ShellProfile & { pivot: Vec };
  wing: { pivot: Vec; stations: readonly WingStation[]; scallop: number };
  tail: { pivot: Vec; lengthZ: number; endY: number; halfWidth: number; edgeShortening: number };
  foot: { pivot: Vec; reach: number; spread: number; thickness: number };
  plumage: {
    back: string; flank: string; breast: string; ink: string;
    crown: string; face: string; rim: string; flight: string; feet: string; horn: string;
  };
}

/** Native metre dimensions in the neutral, wings-extended bind pose. */
export const PROFILES: Readonly<Record<RaptorSpecies, Profile>> = {
  'tawny-owl': {
    bodyLength: 0.38, wingspan: 0.99, height: 0.347,
    body: { center: [0, 0.168, 0.022], radii: [0.084, 0.132, 0.102], pitch: -0.38 },
    head: { pivot: [0, 0.267, -0.062], center: [0, 0.006, -0.006], radii: [0.079, 0.074, 0.069], pitch: -0.02 },
    wing: {
      pivot: [0.065, 0.213, 0.003], scallop: 0.007,
      stations: [
        [0, -0.043, 0.090, 0, 0.019], [0.16, -0.075, 0.130, 0.012, 0.024],
        [0.36, -0.088, 0.155, 0.015, 0.024], [0.58, -0.078, 0.158, 0.010, 0.020],
        [0.76, -0.054, 0.138, 0.002, 0.014], [0.89, -0.020, 0.110, -0.009, 0.010],
        [0.96, 0.012, 0.081, -0.020, 0.005], [1, 0.048, 0.048, -0.027, 0],
      ],
    },
    tail: { pivot: [0, 0.117, 0.061], lengthZ: 0.116, endY: -0.056, halfWidth: 0.060, edgeShortening: 0.12 },
    foot: { pivot: [0.039, 0.071, 0.015], reach: 0.046, spread: 0.026, thickness: 0.0066 },
    plumage: {
      back: '#635347', flank: '#a18b77', breast: '#c1ae96', ink: '#533c31',
      crown: '#69564a', face: '#b39a7f', rim: '#503b33', flight: '#6a5348', feet: '#a48c76', horn: '#515456',
    },
  },
  'eagle-owl': {
    bodyLength: 0.66, wingspan: 1.66, height: 0.661,
    body: { center: [0, 0.303, 0.026], radii: [0.137, 0.228, 0.167], pitch: -0.32 },
    head: {
      pivot: [0, 0.474, -0.108], center: [0, 0.011, 0.001], radii: [0.120, 0.110, 0.092],
      pitch: -0.04, crown: 0.78,
    },
    wing: {
      pivot: [0.115, 0.362, 0.008], scallop: 0.015,
      stations: [
        [0, -0.084, 0.154, 0, 0.034], [0.14, -0.128, 0.227, 0.018, 0.042],
        [0.34, -0.149, 0.267, 0.023, 0.038], [0.59, -0.132, 0.276, 0.010, 0.029],
        [0.77, -0.092, 0.241, -0.005, 0.021], [0.88, -0.052, 0.191, -0.019, 0.015],
        [0.96, -0.002, 0.119, -0.034, 0.008], [1, 0.052, 0.052, -0.039, 0],
      ],
    },
    tail: { pivot: [0, 0.235, 0.112], lengthZ: 0.194, endY: -0.155, halfWidth: 0.103, edgeShortening: 0.08 },
    foot: { pivot: [0.067, 0.112, 0.027], reach: 0.077, spread: 0.043, thickness: 0.013 },
    plumage: {
      back: '#735039', flank: '#a6805c', breast: '#ccaa81', ink: '#472d24',
      crown: '#67462f', face: '#ba946d', rim: '#624936', flight: '#795439', feet: '#b3956e', horn: '#3c3934',
    },
  },
  kestrel: {
    bodyLength: 0.33, wingspan: 0.75, height: 0.240,
    body: { center: [0, 0.128, 0.005], radii: [0.043, 0.080, 0.076], pitch: -0.62 },
    head: { pivot: [0, 0.194, -0.074], center: [0, 0.007, -0.009], radii: [0.033, 0.039, 0.041], pitch: -0.14 },
    wing: {
      pivot: [0.037, 0.137, -0.007], scallop: 0.004,
      stations: [
        [0, -0.044, 0.063, 0, 0.010], [0.16, -0.073, 0.093, 0.007, 0.012],
        [0.34, -0.082, 0.098, 0.010, 0.011], [0.55, -0.070, 0.079, 0.007, 0.008],
        [0.74, -0.049, 0.053, 0.002, 0.006], [0.88, -0.026, 0.028, -0.006, 0.004],
        [0.95, -0.011, 0.013, -0.011, 0.002], [1, 0.002, 0.002, -0.015, 0],
      ],
    },
    tail: { pivot: [0, 0.115, 0.046], lengthZ: 0.150, endY: -0.056, halfWidth: 0.044, edgeShortening: 0.07 },
    foot: { pivot: [0.024, 0.071, 0.006], reach: 0.047, spread: 0.018, thickness: 0.0042 },
    plumage: {
      back: '#a45d38', flank: '#b68157', breast: '#e7cdaa', ink: '#40332d',
      crown: '#647889', face: '#c5bba9', rim: '#353841', flight: '#483c37', feet: '#d39b48', horn: '#343c48',
    },
  },
};
