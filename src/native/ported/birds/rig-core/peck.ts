/** One deliberate ground peck: lower, touch with the bill closed, then lift and open. */
export function pigeonPeckCycle(age: number): { reach: number; jaw: number } {
  if (!Number.isFinite(age) || age < 0 || age >= 0.5) return { reach: 0, jaw: 0 };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const reach = age < 0.20 ? smooth(age / 0.20)
    : age <= 0.24 ? 1 : 1 - smooth((age - 0.24) / 0.26);
  const opening = (age - 0.26) / 0.16;
  const jaw = opening > 0 && opening < 1 ? -0.18 * Math.sin(Math.PI * opening) ** 2 : 0;
  return { reach, jaw };
}

/** Find the first downward contact, rather than letting a fixed angle cross the sole plane. */
export function solvePeckContact(heightAtPitch: (pitch: number) => number, clearance = 0.001): number | null {
  const start = heightAtPitch(0);
  if (!Number.isFinite(start) || start <= clearance) return null;
  let before = 0;
  for (let i = 1; i <= 48; i++) {
    const after = i * 0.05;
    const height = heightAtPitch(after);
    if (!Number.isFinite(height)) return null;
    if (height <= clearance) {
      let low = before, high = after;
      for (let j = 0; j < 40; j++) {
        const middle = (low + high) / 2;
        if (heightAtPitch(middle) > clearance) low = middle;
        else high = middle;
      }
      return (low + high) / 2;
    }
    before = after;
  }
  return null;
}
