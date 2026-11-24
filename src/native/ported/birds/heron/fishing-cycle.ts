/** Slow watch, quick submerged bill strike, recovery, then a small swallowing motion. */
export function heronFishingCycle(age: number) {
  const smooth = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
  if (!Number.isFinite(age) || age < 0 || age >= 2.6) return { reach: 0, jaw: 0, swallow: 0 };
  const reach = age < .8 ? .10 * smooth(age / .8) : age < 1.15 ? .1 + .9 * smooth((age - .8) / .35) : age < 1.35 ? 1 : 1 - smooth((age - 1.35) / .65);
  const jaw = age >= 1.35 && age < 2.35 ? -.18 * Math.sin(Math.PI * (age - 1.35)) ** 2 : 0;
  const swallow = age >= 2 && age < 2.5 ? Math.sin(Math.PI * (age - 2) / .5) ** 2 : 0;
  return { reach, jaw, swallow };
}
