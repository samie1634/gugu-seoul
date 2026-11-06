import type { LandingSurface, MapActor, MapCollider, MapPoint, MapRect, MapSurfaceEvent, PropSpec } from '../contracts.ts';
import type { BodyProfile } from '../../shared-contracts.ts';

const TOP_SLOP_M = 0.01;
const SIDE_SLOP_M = 0.01;
const ACTOR_LIMIT = 256;

export type PropActorGeometry = Pick<BodyProfile, 'horizontalRadiusM' | 'heightM' | 'centreToSoleM'> & {
  readonly footSupportRadiusM: number;
};

// The root map producer stamps these payloads using its shared event sequence.
export type PropContact = Omit<MapSurfaceEvent, 'producer' | 'sessionId' | 'sequence' | 'eventId'> & {
  type: Extract<MapSurfaceEvent['type'], 'prop-perch' | 'surface-contact'>;
};

type Perch = LandingSurface & { type: 'prop-perch'; round: boolean };
type Side = MapCollider & { type: 'surface-contact'; minY: number; round: boolean };
type Target = Perch | Side;

function validRect(rect: MapRect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.z)
    && Number.isFinite(rect.width) && rect.width > 0
    && Number.isFinite(rect.depth) && rect.depth > 0;
}

function contactAt(
  targets: readonly Target[], actor: MapActor, body: PropActorGeometry, feetY: number, bodyTopY: number,
): Target | undefined {
  let best: Target | undefined;
  let bestDistance = Infinity;
  for (const target of targets) {
    // All perch targets come first. A valid top takes precedence over a side.
    if (best?.type === 'prop-perch' && target.type === 'surface-contact') break;
    const dx = actor.x - target.x;
    const dz = actor.z - target.z;
    const xGap = Math.abs(dx) - target.width / 2;
    const zGap = Math.abs(dz) - target.depth / 2;
    const edgeGap = target.round ? Math.hypot(dx, dz) - roundRadius(target) : Math.max(xGap, zGap);
    let distance: number;
    if (target.type === 'prop-perch') {
      const footDelta = feetY - target.y;
      if (body.footSupportRadiusM > target.maxFootRadius || edgeGap > -body.footSupportRadiusM
        || Math.abs(footDelta) > TOP_SLOP_M) continue;
      distance = Math.abs(footDelta);
    } else {
      if (feetY >= target.height || bodyTopY <= target.minY) continue;
      distance = target.round || edgeGap < 0
        ? Math.abs(edgeGap) : Math.hypot(Math.max(xGap, 0), Math.max(zGap, 0));
      if (distance > body.horizontalRadiusM + SIDE_SLOP_M) continue;
    }
    if (distance < bestDistance || (distance === bestDistance && best && target.id < best.id)) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundRadius(rect: MapRect): number {
  return Math.min(rect.width, rect.depth) / 2;
}

function sidePoint(target: Side, actor: MapActor): MapPoint {
  const dx = actor.x - target.x;
  const dz = actor.z - target.z;
  const y = clamp(actor.y, target.minY, target.height);
  if (target.round) {
    const radius = roundRadius(target);
    const length = Math.hypot(dx, dz);
    return {
      x: target.x + radius * (length === 0 ? 1 : dx / length),
      y,
      z: target.z + radius * (length === 0 ? 0 : dz / length),
    };
  }
  const halfWidth = target.width / 2;
  const halfDepth = target.depth / 2;
  let x = clamp(dx, -halfWidth, halfWidth);
  let z = clamp(dz, -halfDepth, halfDepth);
  const toX = halfWidth - Math.abs(dx);
  const toZ = halfDepth - Math.abs(dz);
  // An interior projection needs the closest side face.
  if (toX > 0 && toZ > 0) {
    if (toX <= toZ) x = dx < 0 ? -halfWidth : halfWidth;
    else z = dz < 0 ? -halfDepth : halfDepth;
  }
  return { x: target.x + x, y, z: target.z + z };
}

function eventAt(target: Target, actor: MapActor, time: number): PropContact {
  const point = target.type === 'prop-perch'
    ? { x: actor.x, y: target.y, z: actor.z }
    : sidePoint(target, actor);
  return {
    ...point,
    type: target.type,
    actorId: actor.id,
    targetId: target.id,
    surface: target.surface,
    strength: target.type === 'prop-perch' ? 0.5 : 0.25,
    time,
  };
}

/** Supply layout.colliders to observe sides, including the non-perchable lamp columns. */
export function createPropInteractions(
  props: readonly PropSpec[],
  surfaces: readonly LandingSurface[],
  colliders: readonly MapCollider[] = [],
) {
  const roundById = new Map<string, boolean>();
  for (const prop of props) {
    if (prop.kind === 'bench') {
      roundById.set(`${prop.id}:seat`, false);
      roundById.set(`${prop.id}:back`, false);
    } else {
      roundById.set(prop.id, prop.kind === 'lamp' || prop.kind === 'bollard');
    }
  }

  const targets: Target[] = [];
  for (const surface of surfaces) {
    const round = roundById.get(surface.id);
    if (round === undefined || !validRect(surface) || !Number.isFinite(surface.y)
      || !Number.isFinite(surface.maxFootRadius) || surface.maxFootRadius < 0
      || surface.approximation !== 0) continue;
    targets.push({ ...surface, type: 'prop-perch', round });
  }
  for (const collider of colliders) {
    const round = roundById.get(collider.id);
    const minY = collider.minY ?? 0;
    if (round === undefined || !validRect(collider) || !Number.isFinite(minY)
      || !Number.isFinite(collider.height) || collider.height <= minY) continue;
    targets.push({ ...collider, type: 'surface-contact', minY, round });
  }

  const actors = new Map<string, { time: number; target: Target | undefined }>();
  let disposed = false;

  return {
    observeActor(actor: MapActor, time: number, geometry?: PropActorGeometry): PropContact[] {
      if (disposed || !actor || typeof actor.id !== 'string' || !actor.id.trim()
        || typeof actor.grounded !== 'boolean' || !Number.isFinite(time) || time < 0
        || !Number.isFinite(actor.x) || !Number.isFinite(actor.z) || !Number.isFinite(actor.y)
        || !Number.isFinite(actor.radius) || actor.radius < 0) return [];

      const body = geometry ?? {
        horizontalRadiusM: actor.horizontalRadius ?? actor.radius,
        heightM: actor.radius * 2,
        centreToSoleM: actor.centreToSole ?? actor.radius,
        footSupportRadiusM: actor.footRadius ?? actor.horizontalRadius ?? actor.radius,
      };
      const { horizontalRadiusM, heightM, centreToSoleM, footSupportRadiusM } = body;
      if (![horizontalRadiusM, heightM, centreToSoleM, footSupportRadiusM].every(Number.isFinite)
        || horizontalRadiusM <= 0 || centreToSoleM <= 0 || centreToSoleM >= heightM
        || footSupportRadiusM < 0) return [];

      const feetY = actor.y - centreToSoleM;
      const bodyTopY = feetY + heightM;
      if (!Number.isFinite(feetY) || !Number.isFinite(bodyTopY)) return [];
      const prior = actors.get(actor.id);
      if (prior && time <= prior.time) return [];

      const target = actor.grounded ? contactAt(targets, actor, body, feetY, bodyTopY) : undefined;
      actors.delete(actor.id);
      actors.set(actor.id, { time, target });
      if (actors.size > ACTOR_LIMIT) {
        const oldest = actors.keys().next().value;
        if (oldest !== undefined) actors.delete(oldest);
      }

      if (!target || (prior?.target?.id === target.id && prior.target.type === target.type)) return [];
      return [eventAt(target, actor, time)];
    },
    forgetActor(id: string): void {
      actors.delete(id);
    },
    reset(): void {
      actors.clear();
    },
    dispose(): void {
      disposed = true;
      actors.clear();
      targets.length = 0;
    },
  };
}
