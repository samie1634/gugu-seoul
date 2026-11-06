import * as THREE from 'three';
import type { NpcState, Point3 } from '../src/contracts.ts';
import { HARD_MAX_NPCS, NPC_KINDS } from '../src/profiles.ts';
import { paintPose, poseAnchors, SHAPES, variantScale, type Painter, type Shape } from './pose.ts';

export interface NpcModelLayer {
  readonly root: THREE.Group;
  sync(states: readonly NpcState[]): void;
  dispose(): void;
  /** Upper bounds for one main render pass, independent of the current population. */
  readonly stats: Readonly<{ drawCalls: number; trianglesAtCapacity: number; capacity: number }>;
}

export interface NpcWorldAnchors {
  readonly sole: Point3;
  readonly body: Point3;
  readonly eye: Point3;
  readonly voice: Point3;
}

const TAU = 2 * Math.PI;
const KINDS: ReadonlySet<unknown> = new Set(NPC_KINDS);
const ACTIONS: ReadonlySet<unknown> = new Set(['idle', 'walk', 'look', 'avoid', 'startle']);
function nonnegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}
function gpuCoordinate(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(Math.fround(n));
}
function renderable(state: unknown): state is NpcState {
  if (state === null || typeof state !== 'object') return false;
  const s = state as Partial<NpcState>;
  return typeof s.id === 'string' && s.id.trim().length > 0 && KINDS.has(s.kind) && ACTIONS.has(s.action)
    && gpuCoordinate(s.x) && gpuCoordinate(s.y) && gpuCoordinate(s.z) && Number.isFinite(s.heading)
    && nonnegative(s.gaitDistance) && nonnegative(s.age) && nonnegative(s.speed)
    && nonnegative(s.bodyScale) && Math.fround(s.bodyScale * 0.003) > 0 && s.bodyScale <= 10
    && typeof s.variant === 'number' && Number.isInteger(s.variant) && s.variant >= 0 && s.variant < 8;
}

function setNpcBasis(basis: THREE.Matrix4, state: NpcState, scratch: THREE.Vector3): THREE.Matrix4 {
  basis.makeRotationY(-(state.heading % TAU));
  basis.scale(scratch.setScalar(variantScale(state)));
  return basis.setPosition(state.x, state.y, state.z);
}

/** Sample the rendered pose in gameplay metres with an identity model parent. */
export function worldAnchors(state: NpcState | undefined): NpcWorldAnchors | undefined {
  if (!renderable(state)) return undefined;

  const point = new THREE.Vector3();
  const basis = setNpcBasis(new THREE.Matrix4(), state, point);
  const { body, eye, voice } = poseAnchors(state);
  function transform([x, y, z]: readonly [number, number, number]): Point3 {
    point.set(x, y, z).applyMatrix4(basis);
    return { x: point.x, y: point.y, z: point.z };
  }
  return { sole: { x: state.x, y: state.y, z: state.z }, body: transform(body), eye: transform(eye), voice: transform(voice) };
}

type Counts = Record<Shape, number>;
function counts(): Counts { return { round: 0, block: 0, taper: 0, point: 0 }; }
const PER_KIND = NPC_KINDS.map((kind) => {
  const result = counts();
  paintPose({ kind, action: 'idle', variant: 0, age: 0, gaitDistance: 0, speed: 0, bodyScale: 1 }, {
    part(shape) { result[shape]++; },
    link() { result.taper++; },
  });
  return result;
});

function makeGeometry(shape: Shape): THREE.BufferGeometry {
  switch (shape) {
    case 'round': {
      const geometry = new THREE.IcosahedronGeometry(0.5, 0);
      geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        const { x, y, z } = geometry.boundingBox.getSize(new THREE.Vector3());
        geometry.scale(1 / x, 1 / y, 1 / z);
      }
      const pos = geometry.getAttribute('position');
      const norm = geometry.getAttribute('normal');
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        norm.setXYZ(i, v.x, v.y, v.z);
      }
      return geometry;
    }
    case 'block': return new THREE.BoxGeometry(1, 1, 1);
    case 'taper': return new THREE.CylinderGeometry(0.37, 0.5, 1, 5);
    case 'point': return new THREE.ConeGeometry(0.5, 1, 4);
  }
}

/** Positions are metres in parent space; keep the map's parent transform at identity for world metres. */
export function createNpcModelLayer(parent: THREE.Object3D, capacity = HARD_MAX_NPCS): NpcModelLayer {
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > HARD_MAX_NPCS) {
    throw new RangeError('NPC model capacity must be an integer between 0 and ' + HARD_MAX_NPCS);
  }

  const root = new THREE.Group();
  root.name = 'npc-models';
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92 });
  material.name = 'npc-matte';
  type Batch = THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const batches = new Map<Shape, Batch>();
  const triangles = counts();
  const used = counts();
  if (capacity > 0) {
    for (const shape of SHAPES) {
      const max = capacity * Math.max(...PER_KIND.map((kind) => kind[shape]));
      const geometry = makeGeometry(shape);
      triangles[shape] = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
      const mesh = new THREE.InstancedMesh(geometry, material, max);
      mesh.name = 'npc:' + shape;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
        .setUsage(THREE.DynamicDrawUsage);
      // One batch spans multiple NPCs. Avoid stale bounds when instances move or leave.
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      batches.set(shape, mesh);
      root.add(mesh);
    }
  }
  const stats = Object.freeze({
    drawCalls: batches.size,
    trianglesAtCapacity: capacity * Math.max(...PER_KIND.map((kind) =>
      SHAPES.reduce((sum, shape) => sum + kind[shape] * triangles[shape], 0))),
    capacity,
  });

  const seen = new Set<string>();
  const colors = new Map<number, THREE.Color>();
  const basis = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const matrix = new THREE.Matrix4();
  const xyz = new THREE.Vector3();
  const dimensions = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const angles = new THREE.Euler(0, 0, 0, 'YXZ');
  let disposed = false;

  function write(shape: Shape, hex: number): void {
    const mesh = batches.get(shape);
    if (!mesh) return;
    const slot = used[shape]++;
    local.compose(xyz, rotation, dimensions);
    mesh.setMatrixAt(slot, matrix.multiplyMatrices(basis, local));
    let color = colors.get(hex);
    if (!color) {
      color = new THREE.Color(hex);
      colors.set(hex, color);
    }
    mesh.setColorAt(slot, color);
  }

  const painter: Painter = {
    part(shape, x, y, z, w, h, d, color, pitch = 0, yaw = 0, roll = 0) {
      xyz.set(x, y, z);
      dimensions.set(w, h, d);
      rotation.setFromEuler(angles.set(pitch, yaw, roll));
      write(shape, color);
    },
    link(ax, ay, az, bx, by, bz, w, d, color) {
      direction.set(bx - ax, by - ay, bz - az);
      const length = direction.length();
      rotation.setFromUnitVectors(up, direction.normalize());
      xyz.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
      dimensions.set(w, length + Math.min(w * 0.20, length * 0.15), d);
      write('taper', color);
    },
  };

  function sync(states: readonly NpcState[]): void {
    if (disposed || capacity === 0) return;
    for (const shape of SHAPES) used[shape] = 0;
    seen.clear();
    if (Array.isArray(states)) {
      for (const state of states) {
        if (!renderable(state) || seen.has(state.id)) continue;
        seen.add(state.id);
        setNpcBasis(basis, state, dimensions);
        paintPose(state, painter);
        if (seen.size >= capacity) break;
      }
    }
    seen.clear();
    for (const [shape, mesh] of batches) {
      mesh.count = used[shape];
      mesh.visible = mesh.count > 0;
      const attrs = [mesh.instanceMatrix, mesh.instanceColor];
      for (const attr of attrs) {
        if (!attr) continue;
        attr.clearUpdateRanges();
        if (mesh.count > 0) {
          attr.addUpdateRange(0, mesh.count * attr.itemSize);
          attr.needsUpdate = true;
        }
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const mesh of batches.values()) {
      mesh.removeFromParent();
      mesh.count = 0;
      mesh.visible = false;
      mesh.dispose();
      mesh.geometry.dispose();
    }
    batches.clear();
    colors.clear();
    seen.clear();
    material.dispose();
  }

  parent.add(root);
  return { root, stats, sync, dispose };
}
