import * as THREE from 'three';
import { Painter, cityMaterial } from './geometry.ts';
import type { LookId } from './progress.ts';
import type { BirdState } from './simulation.ts';

export interface BirdRig {
  root: THREE.Group;
  head: THREE.Mesh;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  leftFoot: THREE.Mesh;
  rightFoot: THREE.Mesh;
  look: LookId;
}

const cache = new Map<LookId, { body: THREE.BufferGeometry; head: THREE.BufferGeometry; wings: THREE.BufferGeometry[]; foot: THREE.BufferGeometry }>();

export function makeBird(look: LookId = 'pigeon'): BirdRig {
  let parts = cache.get(look);
  if (!parts) {
    const owl = look === 'owl';
    const base = owl ? '#917454' : look === 'white' ? '#eeeade' : '#8999a6';
    const light = owl ? '#d8bd89' : look === 'white' ? '#fff8e9' : '#b6bdc1';
    const dark = owl ? '#4a4237' : look === 'white' ? '#c9c8bc' : '#43505d';
    const body = new Painter();
    body.ellipsoid(0, 0.08, 0.05, 0.47, 0.52, 0.71, base, 12);
    body.ellipsoid(0, 0.17, -0.3, 0.4, 0.44, 0.38, light, 12);
    body.box(0, -0.08, 0.75, 0.56, 0.10, owl ? 0.36 : 0.62, dark);
    if (!owl) {
      body.ellipsoid(0, 0.43, -0.39, 0.28, 0.36, 0.3, look === 'white' ? light : '#45796d', 12);
      body.ellipsoid(0.04, 0.46, -0.54, 0.24, 0.22, 0.16, look === 'white' ? base : '#897399');
    } else {
      for (let i = 0; i < 4; i += 1) body.box((i % 2 ? -1 : 1) * 0.13, 0.23 - i * 0.11, -0.61, 0.07, 0.13, 0.04, dark);
    }
    const head = new Painter();
    head.ellipsoid(0, 0, 0, owl ? 0.44 : 0.3, owl ? 0.43 : 0.32, owl ? 0.35 : 0.29, base, 12);
    if (owl) {
      for (const side of [-1, 1]) {
        head.ellipsoid(side * 0.19, -0.01, -0.25, 0.22, 0.27, 0.11, light, 12);
        head.ellipsoid(side * 0.2, 0.04, -0.345, 0.105, 0.12, 0.035, '#e7ac48', 12);
        head.ellipsoid(side * 0.2, 0.04, -0.377, 0.053, 0.082, 0.016, '#172c2c', 12);
        head.add(new THREE.ConeGeometry(0.13, 0.38, 4), dark, new THREE.Vector3(side * 0.32, 0.39, 0.01), undefined, new THREE.Euler(0, 0, side * -0.24));
      }
    } else {
      for (const side of [-1, 1]) {
        head.ellipsoid(side * 0.245, 0.045, -0.13, 0.06, 0.067, 0.056, '#e8a65d', 12);
        head.ellipsoid(side * 0.283, 0.05, -0.145, 0.027, 0.034, 0.032, '#172c2c');
      }
    }
    head.add(new THREE.ConeGeometry(owl ? 0.075 : 0.08, owl ? 0.19 : 0.25, 5), owl ? '#3e3e34' : '#c8b8aa', new THREE.Vector3(0, -0.09, owl ? -0.36 : -0.34), undefined, new THREE.Euler(-Math.PI / 2, 0, 0));
    const wings = [-1, 1].map(side => {
      const wing = new Painter();
      wing.ellipsoid(side * 0.48, 0, 0.12, 0.61, 0.09, 0.53, base, 10);
      for (let i = 0; i < 6; i += 1) {
        wing.ellipsoid(side * (0.57 + i * 0.15), -0.012, 0.25 + i * 0.09, 0.20, 0.055, 0.55 - i * 0.035, i > 3 ? dark : light, 8);
      }
      if (look === 'pigeon') {
        wing.box(side * 0.54, 0.102, 0.13, 0.075, 0.025, 0.8, dark);
        wing.box(side * 0.77, 0.098, 0.20, 0.075, 0.025, 0.8, dark);
      }
      return wing.geometry();
    });
    const foot = new Painter();
    foot.cylinder(0, 0, 0, 0.034, 0.22, owl ? '#b59d71' : '#bd7c72', 5);
    for (let i = -1; i <= 1; i += 1) foot.box(i * 0.061, -0.12, -0.09, 0.03, 0.027, 0.23, '#a57062', i * 0.3);
    parts = { body: body.geometry(), head: head.geometry(), wings, foot: foot.geometry() };
    cache.set(look, parts);
  }
  const mesh = (geometry: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geometry, cityMaterial); m.castShadow = true; m.receiveShadow = true; return m;
  };
  const root = new THREE.Group(); root.add(mesh(parts.body));
  const head = mesh(parts.head); head.position.set(0, 0.61, -0.45); root.add(head);
  const leftWing = mesh(parts.wings[0]); leftWing.position.set(-0.33, 0.28, 0.03); root.add(leftWing);
  const rightWing = mesh(parts.wings[1]); rightWing.position.set(0.33, 0.28, 0.03); root.add(rightWing);
  const leftFoot = mesh(parts.foot); leftFoot.position.set(-0.19, -0.42, 0.05); root.add(leftFoot);
  const rightFoot = mesh(parts.foot); rightFoot.position.set(0.19, -0.42, 0.05); root.add(rightFoot);
  if (look === 'owl') root.scale.setScalar(1.18);
  return { root, head, leftWing, rightWing, leftFoot, rightFoot, look };
}

export function poseBird(rig: BirdRig, mode: BirdState['mode'], time: number, flapAge: number, steps: number, cooAge = 10): void {
  const walking = mode === 'walk';
  const flying = mode === 'flap' || mode === 'glide' || mode === 'fall';
  const beat = Math.sin(time * 17);
  const spread = mode === 'glide' ? 0.06 + Math.sin(time * 2) * 0.04
    : mode === 'fall' ? 0.2 + Math.sin(time * 7) * 0.14
    : Math.cos(flapAge * 19) * 0.8;
  rig.leftWing.rotation.set(0, flying ? -0.08 : -0.58, flying ? -spread : 1.25);
  rig.rightWing.rotation.set(0, flying ? 0.08 : 0.58, flying ? spread : -1.25);
  rig.leftFoot.rotation.x = flying ? 0.8 : walking ? Math.sin(steps * 8) * 0.7 : 0;
  rig.rightFoot.rotation.x = flying ? 0.8 : walking ? -Math.sin(steps * 8) * 0.7 : 0;
  rig.head.position.z = -0.45 + (walking ? Math.sin(steps * 8) * 0.09 : 0);
  rig.head.rotation.x = cooAge < 0.9 ? Math.sin(cooAge * 24) * 0.16 : 0;
  rig.head.position.y = 0.61 + (walking ? Math.abs(Math.sin(steps * 8)) * 0.04 : Math.sin(time * 1.6) * 0.012);
  if (mode === 'flap') rig.head.rotation.x += beat * 0.015;
}
