/** Readability at map scale. Nearby water retains its transparent riverbed. */
export const WATER_DISTANCE_STYLE = Object.freeze({ start: 35, end: 170, skyWeight: .62, waveScale: .32 });
export function waterDistanceBlend(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const t = Math.max(0, Math.min(1, (distance - WATER_DISTANCE_STYLE.start) / (WATER_DISTANCE_STYLE.end - WATER_DISTANCE_STYLE.start)));
  return t * t * (3 - 2 * t);
}
export function waterReflectionWeight(distance: number, incidence: number): number {
  const facing = Math.max(0, Math.min(1, Number.isFinite(incidence) ? incidence : 1));
  const fresnel = .08 + .92 * (1 - facing) ** 4;
  return Math.max(fresnel, .08 + (WATER_DISTANCE_STYLE.skyWeight - .08) * waterDistanceBlend(distance));
}
