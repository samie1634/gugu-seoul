/**
 * Original model units from the approved 2-second preview. The forward-only
 * pulse reaches these displacements and returns to the exact rest position.
 */
export const PIGEON_COO_OFFSETS = [.036, .029] as const;
export type CooCue = readonly [number, number];

/** Pulse centres hand-pinned to the measured main coo band in each unchanged WAV. */
const PIGEON_COO_CUES: Readonly<Record<string, CooCue | undefined>> = {
  'c3fa7d0324e35d98577946891c2b1609b6ed28c8fa5a6761ef5201d528ad76c2': [.25, .765],
  'ca272dfd5c143b811aa6681d173314f7332b053f831e55270e9f9d9df026819a': [.17, .665],
  'eb52e3ef09da644f2ca680eee81a73026c2dbdf3c7b05b6160a8e81c63497ab6': [.12, .610],
  'd764dab816327bd8facdaee1e650387c07aee6fcd80519566c77ccde5827934c': [.085, .510],
  '9f9328fed1ef61d6c7f597d98b266e14629903c68a5bfe9a1111014deb2d7608': [.030, .460],
};

export function pigeonCooCue(sha256: string): CooCue | undefined { return PIGEON_COO_CUES[sha256]; }

export function pigeonCooForwardOffset(clipTime: number, cue: CooCue): number {
  if (!Number.isFinite(clipTime) || clipTime < 0) return 0;
  const midpoint = (cue[0] + cue[1]) / 2;
  return cue.reduce((offset, peak, index) => {
    const lo = Math.max(index === 0 ? 0 : midpoint, peak - 1/3);
    const hi = Math.min(index === 0 ? midpoint : Infinity, peak + 1/3);
    if (clipTime <= lo || clipTime >= hi) return offset;
    const width = clipTime < peak ? peak - lo : hi - peak;
    return offset + PIGEON_COO_OFFSETS[index] * Math.cos((clipTime - peak) * Math.PI / (2 * width)) ** 2;
  }, 0);
}
