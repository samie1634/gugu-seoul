/** Raise, briefly hold a triangle above the head, then lower both wings. */
export const FLIRT_SECONDS = 1.8;
export function flirtWeight(age: number): number {
  if (!Number.isFinite(age) || age < 0 || age >= FLIRT_SECONDS) return 0;
  const t = age < .45 ? age / .45 : age > 1.2 ? (FLIRT_SECONDS - age) / .6 : 1;
  return t * t * (3 - 2 * t);
}
