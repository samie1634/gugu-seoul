import * as THREE from 'three';

/** A soft elbow opening for the overhead triangle, kept separate from flight shape.
 * A GPU morph bends the shared feather mesh instead of stretching the whole wing
 * into a narrow upright blade. Root and tip stay attached and symmetric.
 */
export function addFlirtWingShape(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  let span = 0;
  for (let i = 0; i < position.count; i++) span = Math.max(span, position.getX(i));
  if (span <= 0) return;
  const shape = position.clone();
  const angle = Math.PI / 2 + .207;
  for (let i = 0; i < position.count; i++) {
    const u = Math.max(0, Math.min(1, position.getX(i) / span));
    const elbow = span * .26 * Math.sin(Math.PI * u);
    shape.setXYZ(i, position.getX(i) + Math.cos(angle) * elbow,
      position.getY(i), position.getZ(i) + Math.sin(angle) * elbow);
  }
  // Retain smooth feather lighting under the curved silhouette.
  const probe = geometry.clone(); probe.setAttribute('position', shape); probe.computeVertexNormals();
  geometry.morphAttributes.position = [shape];
  geometry.morphAttributes.normal = [probe.getAttribute('normal').clone()];
  geometry.morphTargetsRelative = false;
  probe.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
}
