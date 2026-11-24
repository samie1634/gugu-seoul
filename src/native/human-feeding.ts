import type { BirdCrumb, BirdPoint } from './bird-behavior.ts';
import type { HumanRole } from './ported/npcs/src/contracts.ts';

export const MAX_STREET_CRUMBS = 64;
export interface HumanFeeder extends BirdPoint {
  id: string; kind: string; heading?: number; humanRole?: HumanRole; foodSequence?: number; bodyScale?: number;
}
interface Toss { from: BirdPoint; to: BirdPoint; age: number; duration: number }
/** Bounded food pool. Supplies and tosses advance only with accepted scene seconds. */
export function createHumanFeeding(crumbs: BirdCrumb[], groundAt: (x: number, z: number) => number | null) {
  const released = new Map<string, number>(), tossed = new Map<number, Toss>();
  const pending = new Map<string, { human: HumanFeeder; points: BirdPoint[] }>();
  const orders: number[] = crumbs.map((_, i) => i - MAX_STREET_CRUMBS);
  let sequence = 0, supplied = 0, batches = 0;
  function landing(human: HumanFeeder, n: number, count: number): BirdPoint | undefined {
    const heading = human.heading ?? 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = n * 2.3999632297 + attempt * .83 + (human.foodSequence ?? 0) * .37;
      const radius = count === 1 ? .4 + attempt * .035 : .25 + Math.sqrt((n + .5) / count) * (1.45 - attempt * .08);
      const forward = count === 1 ? 0 : Math.max(.2, 1.2 - attempt * .09);
      const x = human.x + Math.sin(heading) * forward + Math.sin(angle) * radius;
      const z = human.z - Math.cos(heading) * forward + Math.cos(angle) * radius;
      const y = groundAt(x, z);
      if (y !== null && Math.abs(y - human.y) <= .2) return { x, y, z };
    }
    // Validated walking surfaces may be narrow: keep every grain on safe ground.
    const y = groundAt(human.x, human.z);
    return y !== null && Math.abs(y - human.y) <= .2 ? { x: human.x, y, z: human.z } : undefined;
  }
  function add(human: HumanFeeder, to: BirdPoint, count: number, grain: number): void {
    let slot = crumbs.findIndex((c, i) => c.eaten && !tossed.has(i));
    if (slot < 0 && crumbs.length < MAX_STREET_CRUMBS) slot = crumbs.length;
    if (slot < 0) {
      const candidates = crumbs.map((_, i) => i).filter(i => !tossed.has(i));
      slot = candidates.reduce((oldest, i) => (orders[i] ?? -Infinity) < (orders[oldest] ?? -Infinity) ? i : oldest);
    }
    const id = `crumb:human:${++sequence}`;
    const crumb = { ...to, id, eaten: true };
    if (slot === crumbs.length) crumbs.push(crumb); else crumbs[slot] = crumb;
    orders[slot] = sequence; supplied++;
    const heading = human.heading ?? 0, scale = human.bodyScale ?? 1;
    const hand = count > 1 ? .38 : 0;
    tossed.set(slot, { from: { x: human.x + Math.sin(heading) * hand + Math.cos(heading) * .21 * scale,
      y: human.y + (count > 1 ? 1.18 : .84) * scale,
      z: human.z - Math.cos(heading) * hand + Math.sin(heading) * .21 * scale }, to,
      age: 0, duration: count > 1 ? .52 + grain % 5 * .045 : .42 });
  }
  return {
    update(dt: number, humans: readonly HumanFeeder[]) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > .1) return;
      for (const [slot, flight] of tossed) {
        flight.age += dt;
        if (flight.age + 1e-9 >= flight.duration) { crumbs[slot].eaten = false; tossed.delete(slot); }
      }
      const present = new Set(humans.filter(h => h.kind === 'human').map(h => h.id));
      for (const id of released.keys()) if (!present.has(id)) released.delete(id);
      for (const human of humans) {
        if (human.kind !== 'human' || ![human.x, human.y, human.z].every(Number.isFinite)) continue;
        const current = human.foodSequence ?? 0, previous = released.get(human.id) ?? 0;
        if (!Number.isInteger(current) || current <= previous || current < 0 || pending.has(human.id) || pending.size >= 48) continue;
        const count = human.humanRole === 'grandmother' || human.humanRole === 'grandfather' ? 30 : 1;
        const points = Array.from({ length: count }, (_, i) => landing(human, i, count));
        if (points.some(p => !p)) continue;
        pending.set(human.id, { human: { ...human }, points: points as BirdPoint[] });
        released.set(human.id, current);
      }
      for (const [id, batch] of pending) {
        // Never replace a grain in mid-flight. At simultaneous bursts, queue the
        // remaining full batches until settled slots are available (< .8 seconds).
        if (MAX_STREET_CRUMBS - tossed.size < batch.points.length) continue;
        batch.points.forEach((point, i) => add(batch.human, point, batch.points.length, i));
        pending.delete(id); batches++;
      }
    },
    visual(slot: number): BirdPoint | undefined {
      const flight = tossed.get(slot);
      if (!flight) return undefined;
      const t = Math.min(1, flight.age / flight.duration), from = flight.from, to = flight.to;
      return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t,
        y: from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * .35 };
    },
    snapshot() { return { supplied, batches, airborne: tossed.size, capacity: MAX_STREET_CRUMBS, trackedHumans: released.size, pendingGrains: [...pending.values()].reduce((sum, batch) => sum + batch.points.length, 0) }; },
    dispose() { tossed.clear(); released.clear(); pending.clear(); },
  };
}
