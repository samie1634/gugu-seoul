import * as THREE from 'three';
import { Painter, sign } from './geometry.ts';
import { makeBird, poseBird, type BirdRig } from './bird.ts';
import type { Obstacle } from './simulation.ts';

export interface World {
  obstacles: Obstacle[];
  update(time: number, delta: number): void;
}

export const LANDMARKS = [
  { name: '광화문', x: -12, z: -432 },
  { name: '광화문광장', x: -43, z: -80 },
  { name: '세종문화회관', x: -168, z: -105 },
  { name: '세종대로', x: 38, z: 65 },
  { name: '종로', x: 285, z: 225 },
  { name: '보신각', x: 520, z: 289 },
  { name: '청계천', x: 320, z: 420 },
] as const;

export function locationName(x: number, z: number): string {
  if (z < -385) return '광화문 · 경복궁 앞';
  if (z > 370 && x > 25) return '청계천';
  if (x > 450 && z > 240 && z < 360) return '보신각';
  if (x > 80 && z > 180 && z < 285) return '종로';
  if (x > -100 && x < 8 && z < 190) return '광화문광장';
  if (x < -100 && x > -245 && z < 80 && z > -235) return '세종문화회관';
  return x > 5 && x < 80 ? '세종대로' : '종로의 지붕들';
}

export function createWorld(scene: THREE.Scene): World {
  const p = new Painter();
  const obstacles: Obstacle[] = [];
  let seed = 7741;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const solid = (x: number, z: number, width: number, depth: number, height: number, minY = 0) => obstacles.push({ x, z, width, depth, height, minY });
  const box = p.box.bind(p);
  const plaque = (text: string, x: number, y: number, z: number, w: number, h: number, bg?: string) => {
    const m = sign(text, w, h, '#f6f0dd', bg); m.position.set(x, y, z); scene.add(m); return m;
  };

  box(0, -1.5, 0, 3000, 3, 3000, '#d6d9c7');
  // North-south avenue, with the pedestrian square on its western side.
  box(34, 0.035, 60, 52, 0.07, 1050, '#74817f');
  box(34, 0.04, 225, 1250, 0.08, 40, '#74817f');
  box(35, 0.05, -394, 630, 0.1, 31, '#74817f');
  for (const x of [-277, -384, 228, 388, 579]) box(x, 0.03, 10, 17, 0.06, 1190, '#89928b');
  for (const z of [-290, -28, 506]) {
    box(-338, 0.03, z, 490, 0.06, 17, '#89928b');
    box(365, 0.03, z, 610, 0.06, 17, '#89928b');
  }
  for (let z = -370; z < 555; z += 16) {
    for (const x of [17, 29, 42, 54]) box(x, 0.09, z, 0.45, 0.05, 7, '#e6e3c6');
    box(35.5, 0.1, z, 1, 0.05, 16, '#d7c78b');
  }
  for (let x = -570; x < 650; x += 16) {
    box(x, 0.1, 225, 7, 0.05, 0.6, '#dfd1a3');
    if (Math.abs(x - 35) < 40) continue;
    box(x, 0.1, 215, 7, 0.05, 0.3, '#e0e2cc');
    box(x, 0.1, 236, 7, 0.05, 0.3, '#e0e2cc');
  }
  for (const z of [-376, 191, 257]) for (let x = 10; x < 61; x += 4) box(x, 0.12, z, 2.2, 0.04, 8, '#f3efdb');
  for (let z = 207; z < 245; z += 4) box(88, 0.12, z, 8, 0.04, 2.2, '#f3efdb');

  box(-45, 0.075, -92, 94, 0.15, 557, '#d7d1b9');
  box(-45, 0.13, -92, 82, 0.12, 548, '#e4decb');
  for (let z = -363; z < 180; z += 11) box(-45, 0.2, z, 82, 0.018, 0.17, '#cac6b1');
  for (let x = -86; x < -3; x += 10) box(x, 0.2, -92, 0.12, 0.018, 548, '#d0cbb6');
  // Shallow time waterway, trees and seating, all original primitive geometry.
  box(-3, 0.23, -95, 2, 0.10, 515, '#99bdb4');
  for (let z = -337; z < 176; z += 54) {
    box(-83, 0.3, z, 11, 0.5, 23, '#a7b589');
    tree(-83, z, 0.9 + rand() * 0.25);
    box(-71, 0.8, z + 7, 2.5, 1.1, 8, '#b39770');
    box(-71, 1.7, z + 7, 0.5, 1, 8, '#8c7a5c');
    solid(-71, z + 7, 2.5, 8, 1.8);
  }

  function tree(x: number, z: number, scale = 1): void {
    p.cylinder(x, 4 * scale, z, 0.65 * scale, 8 * scale, '#8d8771');
    const colors = ['#a0b57a', '#c1bb7e', '#90a879', '#d2bf80'];
    p.ellipsoid(x, 10.5 * scale, z, 5.1 * scale, 5.8 * scale, 4.6 * scale, colors[Math.floor(rand() * colors.length)], 7);
    p.ellipsoid(x + 2 * scale, 9.6 * scale, z + 1.4 * scale, 3.8 * scale, 3.8 * scale, 4 * scale, '#a7b788', 7);
  }
  for (let z = -340; z < 530; z += 45) {
    tree(76, z, 0.8 + rand() * 0.3);
    if (z < 160) tree(-105, z, 0.8 + rand() * 0.25);
    lamp(67, z + 20);
  }
  function lamp(x: number, z: number): void {
    p.cylinder(x, 4.3, z, 0.16, 8.6, '#61776f');
    box(x + 1.3, 8.6, z, 2.9, 0.2, 0.28, '#61776f');
    box(x + 2.4, 8.5, z, 1.3, 0.2, 0.75, '#f3ddb1');
  }

  function roof(x: number, y: number, z: number, w: number, d: number, rise: number, color = '#486a61'): void {
    const vertices: number[] = [];
    const point = (u: number, v: number) => [u * w / 2, rise * (1 - Math.abs(v)) + Math.pow(Math.abs(u), 5) * rise * 0.18 + Math.pow(Math.abs(v), 5) * rise * 0.18, v * d / 2];
    const n = 12;
    for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
      const u = i / n * 2 - 1; const v = j / n * 2 - 1; const step = 2 / n;
      const a = point(u, v); const b = point(u + step, v); const c = point(u, v + step); const e = point(u + step, v + step);
      vertices.push(...a, ...c, ...b, ...b, ...c, ...e);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals();
    p.add(g, color, new THREE.Vector3(x, y, z));
    box(x, y + rise + 0.2, z, w * 0.98, 0.5, 0.65, '#779086');
    box(x, y + rise * 0.17, z + d / 2, w, 0.35, 0.5, '#73877a');
    box(x, y + rise * 0.17, z - d / 2, w, 0.35, 0.5, '#73877a');
  }

  // Gwanghwamun's three passages and double pavilion, facing the square.
  const gx = -12; const gz = -432;
  box(gx, 0.5, gz, 86, 1, 30, '#b9bcb0');
  const shape = new THREE.Shape(); shape.moveTo(-38, 0); shape.lineTo(38, 0); shape.lineTo(38, 12); shape.lineTo(-38, 12); shape.closePath();
  for (const center of [-22, 0, 22]) {
    const hole = new THREE.Path(); hole.moveTo(center - 4.8, 0); hole.lineTo(center - 4.8, 6.5);
    hole.absarc(center, 6.5, 4.8, Math.PI, 0, true); hole.lineTo(center + 4.8, 0); hole.closePath(); shape.holes.push(hole);
  }
  p.add(new THREE.ExtrudeGeometry(shape, { depth: 15, bevelEnabled: false }), '#dedbcc', new THREE.Vector3(gx, 0, gz - 7.5));
  for (const x of [-33, -11, 11, 33]) solid(gx + x, gz, 12.2, 15, 12);
  solid(gx, gz, 76, 15, 12, 10.8);
  box(gx, 12.5, gz, 76, 1, 21, '#c9c7b5');
  for (const x of [-29, -19.3, -9.6, 0, 9.6, 19.3, 29]) {
    for (const side of [-1, 1]) p.cylinder(gx + x, 17, gz + side * 7, 0.7, 8, '#9b6250');
  }
  box(gx, 17, gz, 62, 5, 5, '#58766a');
  box(gx, 21, gz, 72, 1, 18, '#536c5e');
  roof(gx, 21.5, gz, 83, 28, 7);
  for (const x of [-24, -12, 0, 12, 24]) for (const side of [-1, 1]) p.cylinder(gx + x, 28.2, gz + side * 5, 0.6, 5.4, '#9b6250');
  box(gx, 28, gz, 51, 4.7, 4, '#69856b');
  roof(gx, 31, gz, 68, 23, 6);
  solid(gx, gz, 72, 23, 24, 20.5); solid(gx, gz, 61, 19, 35, 26);
  plaque('光 化 門', gx, 29.2, gz + 5.15, 13, 3.2, '#33473b');
  // Palace boundary and hints of courtyards behind the gate.
  for (const side of [-1, 1]) {
    box(gx + side * 165, 4.4, gz, 247, 8.8, 5.5, '#d5d2be');
    box(gx + side * 165, 9, gz, 247, 1, 8.5, '#63796b');
    solid(gx + side * 165, gz, 247, 5.5, 9.5);
  }
  box(gx, 0.05, -554, 540, 0.1, 230, '#c5c8a4');
  box(gx, 0.13, -546, 100, 0.15, 210, '#dfdac4');
  for (let z = -515; z > -670; z -= 66) {
    box(gx, 7, z, 54, 14, 25, '#9f7861'); roof(gx, 14, z, 65, 37, 7);
    solid(gx, z, 60, 30, 21);
    for (const side of [-1, 1]) { box(gx + side * 128, 4, z, 150, 8, 16, '#a38d6b'); roof(gx + side * 128, 8, z, 158, 24, 4); solid(gx + side * 128, z, 153, 20, 12); }
  }

  // Abstract, original representations of the square's two monuments.
  const gold = '#bba365'; const bronze = '#52776c';
  box(-40, 1.1, -172, 17, 2.2, 18, '#aaa994'); solid(-40, -172, 17, 18, 2.2);
  box(-40, 4.2, -172, 10.5, 6.2, 10, '#c1baa0');
  box(-40, 8.3, -173.7, 8, 5, 4, gold);
  box(-40, 7.1, -170, 7, 2.4, 6, gold);
  p.ellipsoid(-40, 12.6, -173.3, 1.65, 2, 1.7, gold, 10);
  box(-40, 14.1, -173.3, 4.9, 0.8, 2.2, gold);
  box(-42, 9.9, -170.5, 1.6, 1.5, 5, gold, 0.2); box(-38, 9.9, -170.5, 1.6, 1.5, 5, gold, -0.2);
  box(-40, 9.2, -168.7, 4.6, 0.35, 2.3, '#cbb77b'); solid(-40, -172, 10, 10, 15);
  plaque('세종대왕', -40, 4, -166.9, 5.8, 1.4, '#90866d');
  box(-40, 1, 117, 16, 2, 17, '#b8b8a3');
  box(-40, 5.6, 117, 7, 9.2, 7, '#bab49d');
  box(-40, 12.5, 117, 3.2, 5, 2.6, bronze);
  p.ellipsoid(-40, 16.7, 117, 1.25, 1.5, 1.2, bronze);
  box(-40, 18.2, 117, 3, 0.65, 2.1, bronze);
  box(-41.3, 11.4, 117, 1.05, 6, 1.1, bronze, -0.1); box(-38.6, 11.4, 117, 1.05, 6, 1.1, bronze, 0.1);
  box(-36.9, 11.5, 118.6, 0.33, 7.8, 0.45, bronze); solid(-40, 117, 8, 8, 18.6);
  plaque('이순신', -40, 5.1, 120.6, 4.8, 1.3, '#8b8873');
  box(-40, 0.25, 153, 29, 0.25, 21, '#a8c4be');
  for (let i = 0; i < 16; i += 1) {
    const x = -52 + i % 8 * 3.4; const z = 148 + Math.floor(i / 8) * 8;
    p.cylinder(x, 0.8 + (i % 3) * 0.24, z, 0.13, 1.1 + i % 3 * 0.5, '#c4ded5', 5);
  }

  // Broad colonnaded arts centre, west of the square.
  box(-176, 12.5, -110, 116, 25, 138, '#c6bda3');
  box(-171, 27, -110, 129, 4, 148, '#ded5b9');
  box(-111.7, 12, -110, 0.6, 20, 126, '#5f736d');
  for (let z = -171; z < -45; z += 10) box(-109, 12, z, 4, 23, 2.4, '#d7ccb0');
  box(-172, 2, -30, 120, 4, 13, '#b3b099'); solid(-176, -110, 120, 142, 29);
  plaque('세 종 문 화 회 관', -175, 20, -40.8, 72, 5, '#b1a88e');
  // Kyobo block and Jongno Tower are recognisable silhouettes, not scanned assets.
  building(135, 123, 83, 114, 87, '#b4b9aa', true);
  plaque('교보', 135, 81, 180.2, 17, 5, '#687b6c');
  building(514, 112, 53, 60, 67, '#9eafa8', true);
  box(514, 100, 112, 84, 15, 78, '#afc4b7');
  for (const x of [489, 539]) p.cylinder(x, 84, 112, 2.8, 28, '#95a9a2');
  solid(514, 112, 84, 78, 108, 92);

  const palettes = ['#c7c6b2', '#b5bfb2', '#b6b4a7', '#cbbfa7', '#a6b8b1', '#d4c8b0'];
  for (const x of [-525, -430, -332, -205, 149, 266, 349, 446, 574]) {
    for (const z of [-328, -205, -91, 74, 344, 498]) {
      if (x === -205 && z > -250 && z < 100) continue;
      if (x === 149 && z === 74) continue;
      if (x > 470 && (z === 74 || z === 344)) continue;
      if (x > 80 && z === 344) continue;
      const w = 52 + rand() * 26; const d = 50 + rand() * 30;
      const h = x < -300 || x > 300 ? 16 + rand() * 45 : 27 + rand() * 45;
      building(x + (rand() - 0.5) * 12, z, w, d, h, palettes[Math.floor(rand() * palettes.length)]);
    }
  }
  function building(x: number, z: number, w: number, d: number, h: number, color: string, tower = false): void {
    box(x, 1, z, w + 6, 2, d + 6, '#b9baa6');
    box(x, h / 2 + 1, z, w, h, d, color);
    box(x, h + 1.8, z, w + 1.5, 1.6, d + 1.5, '#d7d5c1');
    box(x + w * 0.17, h + 3.6, z - d * 0.12, w * 0.33, 3, d * 0.26, '#a4afa3');
    const levels = Math.floor(h / 4.5);
    for (let i = 1; i < levels; i += 1) {
      const y = i * 4.5;
      if (tower) {
        box(x, y, z + d / 2 + 0.04, w - 3, 2.6, 0.10, '#839d99');
        box(x + w / 2 + 0.04, y, z, 0.1, 2.6, d - 3, '#839d99');
        box(x - w / 2 - 0.04, y, z, 0.1, 2.6, d - 3, '#8ca59e');
      } else for (let cx = -w / 2 + 5; cx < w / 2 - 2; cx += 7) {
        box(x + cx, y, z + d / 2 + 0.04, 3, 2.2, 0.10, '#819a91');
        box(x + cx, y, z - d / 2 - 0.04, 3, 2.2, 0.10, '#819a91');
      }
    }
    solid(x, z, w + 1.5, d + 1.5, h + 2.6);
  }

  // Jongno's lower shopfronts frame the eastbound street.
  const shopNames = ['종로 책방', '서울 다방', '꽃과 나무', '종로 공방'];
  for (let i = 0; i < 7; i += 1) {
    const x = 132 + i * 51;
    box(x, 7, 277, 43, 14, 34, palettes[i % palettes.length]);
    roof(x, 14, 277, 47, 39, 3.2, '#768577');
    solid(x, 277, 44, 35, 17.2);
    for (let j = -1; j <= 1; j += 1) box(x + j * 11, 4.3, 259.8, 8, 5, 0.2, '#6b8175');
    const s = plaque(shopNames[i % shopNames.length], x, 10.8, 259.6, 30, 2.7, '#8e8b70'); s.rotation.y = Math.PI;
  }
  // Bosingak: a red, green double-roofed bell pavilion in an open court.
  box(520, 0.3, 300, 100, 0.6, 75, '#d3cdb6');
  box(520, 1.3, 295, 45, 2.6, 31, '#bdbda6');
  for (const x of [-17, -8.5, 0, 8.5, 17]) for (const side of [-1, 1]) p.cylinder(520 + x, 7.5, 295 + side * 10.5, 0.65, 12.5, '#a96351');
  p.cylinder(520, 8, 295, 3.2, 6.5, '#9c9165', 12);
  roof(520, 13.5, 295, 51, 35, 6);
  box(520, 19.7, 295, 32, 5, 12, '#688569'); roof(520, 22, 295, 43, 27, 5);
  solid(520, 295, 48, 33, 17, 12.5); solid(520, 295, 38, 23, 27, 18);
  plaque('普信閣', 520, 20.1, 302, 9, 2.4, '#3b5e4e');
  for (let i = 0; i < 5; i += 1) tree(480 + i * 19, 333, 0.75);

  // Cheonggyecheon is compressed into the southern edge of the playable area.
  box(338, 0.02, 420, 625, 0.05, 35, '#aaa997');
  box(338, 0.09, 420, 625, 0.1, 18, '#83b9ae');
  for (const side of [-1, 1]) {
    box(338, 0.3, 420 + side * 14, 625, 0.6, 6, '#d6d1b9');
    box(338, 1, 420 + side * 19, 625, 2, 2, '#b3b69f');
    for (let x = 80; x < 640; x += 44) tree(x, 420 + side * 30, 0.65);
  }
  for (const x of [95, 237, 389, 579]) {
    box(x, 2.4, 420, 18, 1.4, 43, '#d4cfb7');
    for (const side of [-1, 1]) box(x + side * 9, 4, 420, 0.6, 1.8, 43, '#9fa890');
    solid(x, 420, 19, 43, 3.1);
  }
  // A handful of abstract distant blocks close the horizon without copied data.
  for (let i = 0; i < 48; i += 1) {
    const angle = i / 48 * Math.PI * 2; const x = Math.sin(angle) * (740 + rand() * 180); const z = Math.cos(angle) * (740 + rand() * 180);
    if (z < -600) continue;
    const h = 18 + rand() * 60; box(x, h / 2, z, 40 + rand() * 30, h, 40 + rand() * 30, '#bbc5b7');
  }
  scene.add(p.mesh());
  mountains(scene);
  clouds(scene);

  const cars: { mesh: THREE.Mesh; start: number; speed: number; lane: number }[] = [];
  for (let i = 0; i < 11; i += 1) {
    const car = new Painter(); const bus = i % 4 === 0; const length = bus ? 11 : 5;
    const color = bus ? i % 2 ? '#72956b' : '#648d9b' : ['#e4d3a3', '#ebede0', '#8ca5a2', '#c58a6d'][i % 4];
    car.box(0, bus ? 1.7 : 1, 0, 2.7, bus ? 2.9 : 1.5, length, color);
    car.box(0, bus ? 2.25 : 1.8, bus ? 0 : -0.1, 2.5, bus ? 0.85 : 0.8, bus ? length - 1.3 : length * 0.57, '#5e7976');
    car.box(0, 0.38, 0, 2.95, 0.6, length * 0.7, '#69716a');
    const m = car.mesh(); const lane = [17, 29, 43, 55][i % 4]; m.position.x = lane;
    const speed = i % 4 < 2 ? -8 - i % 3 : 9 + i % 3; if (speed > 0) m.rotation.y = Math.PI;
    scene.add(m); cars.push({ mesh: m, start: i * 91 - 380, speed, lane });
  }
  const pigeons: { rig: BirdRig; x: number; z: number; phase: number; airborne: boolean }[] = [];
  for (let i = 0; i < 18; i += 1) {
    const rig = makeBird(i % 7 === 0 ? 'white' : 'pigeon'); scene.add(rig.root);
    pigeons.push({ rig, x: -65 + rand() * 45, z: -300 + rand() * 450, phase: rand() * Math.PI * 2, airborne: i > 13 });
  }
  return {
    obstacles,
    update(time: number, delta: number) {
      for (const car of cars) {
        car.mesh.position.z = (((car.start + time * car.speed) % 930 + 930) % 930) - 385;
      }
      for (const [i, bird] of pigeons.entries()) {
        const t = time * 0.14 + bird.phase;
        if (bird.airborne) {
          bird.rig.root.position.set(-25 + Math.cos(t) * 80, 39 + i * 1.7 + Math.sin(t * 2) * 4, -250 + Math.sin(t) * 62);
          bird.rig.root.rotation.y = t;
          poseBird(bird.rig, 'glide', time + i, 0, 0);
        } else {
          const walk = Math.sin(time * 0.4 + bird.phase) > -0.2;
          if (walk) {
            bird.x += Math.sin(t) * delta * 0.6; bird.z -= Math.cos(t) * delta * 0.6;
            bird.x = Math.max(-69, Math.min(-12, bird.x)); bird.z = Math.max(-310, Math.min(173, bird.z));
          }
          bird.rig.root.position.set(bird.x, 0.8, bird.z); bird.rig.root.rotation.y = -t;
          poseBird(bird.rig, walk ? 'walk' : 'rest', time + i, 0, walk ? time * 0.7 + i : 0);
        }
      }
    },
  };
}

function mountains(scene: THREE.Scene): void {
  const p = new Painter();
  for (let layer = 0; layer < 2; layer += 1) {
    const vertices: number[] = [];
    const point = (col: number, row: number): number[] => {
      const x = -1200 + col * 100;
      const peaks = 80 + 150 * Math.exp(-Math.pow((x + 80) / 275, 2)) + 105 * Math.exp(-Math.pow((x + 670) / 240, 2)) + 120 * Math.exp(-Math.pow((x - 630) / 310, 2));
      const envelope = Math.sin(row / 5 * Math.PI * 0.86);
      const height = peaks * envelope * (layer ? 1.15 : 1) + Math.sin(col * 2.7 + row) * 14 * envelope;
      return [x, height - 3, -745 - row * 90 - layer * 270];
    };
    for (let col = 0; col < 24; col += 1) for (let row = 0; row < 5; row += 1) {
      const a = point(col, row); const b = point(col + 1, row); const c = point(col, row + 1); const d = point(col + 1, row + 1);
      vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals();
    p.add(g, layer ? '#91aaa0' : '#91a181', new THREE.Vector3());
  }
  scene.add(p.mesh(false));
}

function clouds(scene: THREE.Scene): void {
  const p = new Painter();
  for (let i = 0; i < 9; i += 1) {
    const x = Math.sin(i * 3.9) * 1000; const z = Math.cos(i * 2.4) * 800;
    for (let j = 0; j < 4; j += 1) p.ellipsoid(x + j * 22, 240 + i % 3 * 40 + Math.sin(j) * 8, z, 41, 12 + j % 2 * 8, 20, '#e7ebe0', 10);
  }
  scene.add(p.mesh(false));
}
