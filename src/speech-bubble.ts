import * as THREE from 'three';

export interface BubbleViewport { left: number; top: number; width: number; height: number }

/** CSS-pixel bottom-left anchor, just above and right of the displayed character. */
export function characterBubblePosition(character: THREE.Object3D, camera: THREE.PerspectiveCamera, viewport: BubbleViewport): { left: number; top: number } | null {
  if (!character.visible || ![viewport.left, viewport.top, viewport.width, viewport.height].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0) return null;
  camera.updateWorldMatrix(true, false);
  character.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(character);
  if (bounds.isEmpty()) return null;
  const point = new THREE.Vector3();
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    // Never mirror a behind-camera or near-plane-crossing character onto the HUD.
    if (point.z >= -camera.near || point.z <= -camera.far) return null;
    point.applyMatrix4(camera.projectionMatrix);
    if (![point.x, point.y, point.z].every(Number.isFinite)) return null;
    const screenX = (point.x + 1) * viewport.width / 2;
    const screenY = (1 - point.y) * viewport.height / 2;
    left = Math.min(left, screenX); right = Math.max(right, screenX);
    top = Math.min(top, screenY); bottom = Math.max(bottom, screenY);
  }
  if (right < 0 || left > viewport.width || bottom < 0 || top > viewport.height) return null;
  const bubbleLeft = right + 12, bubbleBottom = top - 12;
  if (bubbleLeft >= viewport.width || bubbleBottom <= 0) return null;
  return { left: viewport.left + bubbleLeft, top: viewport.top + bubbleBottom };
}

export function updateCharacterBubble(bubble: HTMLElement, character: THREE.Object3D | null, camera: THREE.PerspectiveCamera, viewport: BubbleViewport, active: boolean): void {
  const position = active && character ? characterBubblePosition(character, camera, viewport) : null;
  bubble.hidden = position === null;
  if (position) {
    bubble.style.left = `${position.left}px`;
    bubble.style.top = `${position.top}px`;
  }
}
