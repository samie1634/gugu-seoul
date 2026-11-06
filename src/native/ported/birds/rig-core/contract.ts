import type * as THREE from 'three';
export type SpeciesId = 'pigeon' | 'sparrow' | 'crow' | 'magpie' | 'tawny-owl' | 'eagle-owl' | 'kestrel';
export type BirdLod = 0 | 1 | 2;
export type BirdMorph = 'default' | 'gray' | 'white';
export interface BirdBuildOptions { species: SpeciesId; lod: BirdLod; morph?: BirdMorph }
export interface BirdPivots {
  head: THREE.Group; leftWing: THREE.Group; rightWing: THREE.Group;
  tail: THREE.Group; leftFoot: THREE.Group; rightFoot: THREE.Group;
}
export interface BirdMetrics {
  bodyLengthM: number; wingspanM: number; standingHeightM: number;
  footY: 0; eye: readonly [number, number, number];
}
export interface BirdModel {
  species: SpeciesId; morph: BirdMorph; lod: BirdLod;
  root: THREE.Group; pivots: BirdPivots; metrics: BirdMetrics;
  resources: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] };
  dispose(): void;
}
