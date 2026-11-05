import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const cityMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });

/** Bake coloured primitives together to keep the handcrafted scene inexpensive. */
export class Painter {
  private pieces: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, position: THREE.Vector3, scale = new THREE.Vector3(1, 1, 1), rotation = new THREE.Euler()): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    g.deleteAttribute('uv');
    const matrix = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
    g.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.pieces.push(g);
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, angle = 0): void {
    this.add(new THREE.BoxGeometry(w, h, d), color, new THREE.Vector3(x, y, z), undefined, new THREE.Euler(0, angle, 0));
  }

  ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number, color: THREE.ColorRepresentation, detail = 8): void {
    this.add(new THREE.SphereGeometry(1, detail, Math.max(4, detail / 2)), color, new THREE.Vector3(x, y, z), new THREE.Vector3(rx, ry, rz));
  }

  cylinder(x: number, y: number, z: number, radius: number, height: number, color: THREE.ColorRepresentation, segments = 8): void {
    this.add(new THREE.CylinderGeometry(radius, radius, height, segments), color, new THREE.Vector3(x, y, z));
  }

  geometry(): THREE.BufferGeometry {
    const result = mergeGeometries(this.pieces, false);
    if (!result) throw new Error('Could not construct scene geometry');
    this.pieces.forEach(g => g.dispose()); this.pieces = [];
    result.computeBoundingSphere();
    return result;
  }

  mesh(shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(), cityMaterial);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    return mesh;
  }
}

export function sign(text: string, width: number, height: number, color = '#edf0e6', background = '#29524e'): THREE.Mesh {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color; ctx.font = '600 96px "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, 131, 960);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  return mesh;
}
