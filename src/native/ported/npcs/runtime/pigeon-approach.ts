import type { NpcState, NpcStimulus } from '../src/contracts.ts';
/** Nearby takeoff or an approaching/passing pigeon; ignore walking and distant overhead birds. */
export function approachingPigeon(person: Pick<NpcState, 'x' | 'y' | 'z' | 'kind' | 'bodyScale'>, stimulus: NpcStimulus): boolean {
  const flight = stimulus.birdFlight;
  if (person.kind !== 'human' || !flight || flight.species !== 'pigeon' || !flight.airborne) return false;
  const { velocity: v } = flight, p = stimulus.position, scale = person.bodyScale;
  if (![v.x, v.y, v.z, p.x, p.y, p.z, scale].every(Number.isFinite) || scale <= 0) return false;
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < .8 || p.y < person.y + .30 * scale || p.y > person.y + 2.05 * scale) return false;
  const dx = p.x - person.x, dz = p.z - person.z, planarSpeed2 = v.x * v.x + v.z * v.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 2.4 * scale) return false;
  // A bird lifting off at somebody's feet can startle them even before it has
  // forward speed. A close wingbeat also remains audible/visible while passing.
  if (distance <= 1.25 * scale && (v.y > .5 || stimulus.type === 'flap')) return true;
  if (planarSpeed2 < .25) return false;
  const dot = dx * v.x + dz * v.z;
  if (dot >= 0 && distance > .60 * scale) return false;
  const t = Math.max(0, Math.min(.55, -dot / planarSpeed2));
  const closest = Math.hypot(dx + v.x * t, dz + v.z * t);
  const projectedY = p.y + v.y * t;
  return closest < .85 * scale && projectedY >= person.y + .25 * scale && projectedY <= person.y + 2.1 * scale;
}
