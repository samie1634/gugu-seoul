import * as THREE from 'three';

export const HERON_FOLDED_HEAD = new THREE.Vector3(0, .265, -.16);
export const HERON_EXTENDED_HEAD = new THREE.Vector3(0, .49, -.19);

/** Equal-topology poses unfold the lower S-bend while keeping one connected neck mesh. */
export function createHeronNeckGeometry(detail: number): THREE.BufferGeometry {
  const curve = (points: readonly number[][]) => new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const folded = curve([[0, 0, 0], [0, .09, -.065], [0, .19, -.025], [0, .285, -.08], HERON_FOLDED_HEAD.toArray()]);
  const extended = curve([[0, 0, 0], [0, .12, -.03], [0, .29, -.035], [0, .44, -.075], HERON_EXTENDED_HEAD.toArray()]);
  const geometry = new THREE.TubeGeometry(folded, detail * 2, .031, Math.max(6, detail / 2), false);
  const target = new THREE.TubeGeometry(extended, detail * 2, .031, Math.max(6, detail / 2), false);
  geometry.morphAttributes.position = [target.getAttribute('position').clone()];
  geometry.morphAttributes.normal = [target.getAttribute('normal').clone()];
  target.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

const smooth = (value: number) => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

/** Calm scanning periodically unfolds the S; flight always carries a tucked neck. */
export function heronNeckExtension(time: number, mode: string, reducedMotion = false): number {
  if (reducedMotion || (mode !== 'rest' && mode !== 'walk') || !Number.isFinite(time)) return 0;
  const phase = THREE.MathUtils.euclideanModulo(time, 18);
  return phase < 3 ? 0 : phase < 6 ? smooth((phase - 3) / 3) : phase < 9 ? 1 : phase < 12 ? 1 - smooth((phase - 9) / 3) : 0;
}
