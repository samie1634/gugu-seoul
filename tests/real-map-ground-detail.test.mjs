import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Painter } from '../src/geometry.ts';
import { createTerrainDetailMaterial, withTerrainDetail, TERRAIN_DETAIL_CODES } from '../src/native/ported/map/real-map/ground-detail.ts';
import { polygonGeometry } from '../src/native/ported/map/real-map/geometry.ts';
import { createMapCandidate } from '../src/native/ported/map/candidate.ts';
import { realSurfaces } from '../src/native/ported/map/real-map/surfaces.ts';
import { channelTerrainReplacements, CHEONGGYE_LEVELS } from '../src/native/ported/map/real-map/cheonggye-channel.ts';

function compile(material) {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader);
  return shader;
}

function expand(source) {
  return source.replace(/#include <([\w]+)>/g, (_, name) => {
    assert.ok(name in THREE.ShaderChunk, `Unknown shader chunk ${name}`);
    return expand(THREE.ShaderChunk[name]);
  });
}

test('detail selector preserves exact polygons, holes, normals, heights and indexing', () => {
  const rings = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]]];
  for (const [kind, code] of Object.entries(TERRAIN_DETAIL_CODES)) {
    const geometry = polygonGeometry(rings, 0);
    const original = geometry.clone();
    const result = withTerrainDetail(geometry, kind);
    assert.equal(result, geometry);
    for (const name of ['position', 'normal', 'uv']) {
      assert.deepEqual(geometry.attributes[name].array, original.attributes[name].array);
    }
    assert.deepEqual(geometry.index.array, original.index.array);
    assert.ok(geometry.attributes.terrainKind.array instanceof Uint8Array);
    assert.equal(geometry.attributes.terrainKind.array.byteLength, geometry.attributes.position.count);
    assert.ok(geometry.attributes.terrainKind.array.every(value => value === code));
    const painter = new Painter();
    painter.add(geometry, '#b8c2a9', new THREE.Vector3());
    const painted = painter.geometry();
    assert.ok(painted.attributes.terrainKind.array.every(value => value === code));
    assert.equal(painted.attributes.terrainKind.array.byteLength, painted.attributes.position.count);
    painted.dispose(); original.dispose();
  }
});

test('original material details compose with the real standard shader and keep normal lighting', () => {
  for (const quality of ['desktop', 'mobile']) {
    const material = createTerrainDetailMaterial(quality);
    try {
      const shader = compile(material), fragment = expand(shader.fragmentShader), vertex = expand(shader.vertexShader);
      assert.match(vertex, /attribute float terrainKind/);
      assert.match(vertex, /vTerrainWorld = \(modelMatrix \* vec4\(transformed, 1.0\)\).xz/);
      assert.match(vertex, /vTerrainKind = terrainKind/);
      assert.match(fragment, /dFdx\(terrainP\)/);
      assert.match(fragment, /dFdy\(terrainP\)/);
      assert.ok(fragment.indexOf('float terrainPixel =') < fragment.indexOf('if (terrainLarge'));
      assert.ok(fragment.indexOf('float terrainRoughness =') < fragment.indexOf('roughnessFactor = terrainRoughness'));
      assert.ok(fragment.indexOf('float roughnessFactor =') < fragment.indexOf('roughnessFactor = terrainRoughness'));
      assert.ok(fragment.indexOf('roughnessFactor = terrainRoughness') < fragment.indexOf('material.roughness ='));
      assert.equal((fragment.match(/float terrainHash\(/g) || []).length, 1);
      assert.match(fragment, /if \(terrainFine > 0.001\)/);
      assert.match(fragment, /if \(slabFade > 0.001\)/);
      assert.match(fragment, /terrainResolve\(terrainPixel, slabSize.y\)/);
      assert.match(fragment, /smoothstep\(size \* 0.25, size \* 0.8, footprint\)/);
      assert.doesNotMatch(fragment, /#include </);
      assert.doesNotMatch(shader.vertexShader, /transformed\s*[+*\-]=/);
      assert.equal(shader.fragmentShader.includes('vec2 bladeCell'), quality === 'desktop');
      assert.equal(material.transparent, false);
      assert.equal(material.depthWrite, true);
      assert.equal(material.map, null);
      assert.equal(material.normalMap, null);
      assert.equal(material.bumpMap, null);
      assert.equal(material.displacementMap, null);
      assert.equal(material.customProgramCacheKey(), `osm-original-ground-detail-v1-${quality}`);
      assert.deepEqual(material.userData.detailBudget, {
        textureBytes: 0, addedDrawCalls: 0, addedTriangles: 0,
        selectorBytesPerVertex: 1, grassStrands: quality === 'desktop',
      });
    } finally { material.dispose(); }
  }
});

test('filter footprints suppress subpixel detail before distant or oblique views shimmer', () => {
  const resolve = (footprint, size) => {
    const t = Math.max(0, Math.min(1, (footprint - size * 0.25) / (size * 0.55)));
    return 1 - t * t * (3 - 2 * t);
  };
  for (const size of [0.045, 0.25, 0.4, 0.8, 1.2]) {
    assert.equal(resolve(size * 0.1, size), 1);
    assert.ok(Math.abs(resolve(size * 0.525, size) - 0.5) < 1e-12);
    assert.equal(resolve(size, size), 0);
    let last = 1;
    for (let i = 0; i <= 100; i++) {
      const value = resolve(size * i / 100, size);
      assert.ok(Number.isFinite(value) && value >= 0 && value <= last);
      last = value;
    }
  }
});

test('terrain keeps baseline draw/triangle budgets and geographic geometry on both quality levels', () => {
  const expectedCounts = new Map();
  for (const [index, surface] of realSurfaces.entries()) {
    if (surface.kind === 'water') continue;
    for (const rings of channelTerrainReplacements.get(index) ?? [surface.rings]) {
      const geometry = polygonGeometry(rings, surface.y);
      expectedCounts.set(TERRAIN_DETAIL_CODES[surface.kind],
        (expectedCounts.get(TERRAIN_DETAIL_CODES[surface.kind]) ?? 0) + (geometry.index?.count ?? geometry.attributes.position.count));
      geometry.dispose();
    }
  }
  const evidence = [];
  for (const quality of ['desktop', 'mobile']) {
    const map = createMapCandidate({ data: 'osm', quality });
    try {
      const terrain = map.root.children.filter(object => object.name.startsWith('osm:terrain-cell:'));
      const materials = new Set(terrain.map(mesh => mesh.material));
      assert.equal(terrain.length, 144);
      assert.equal(materials.size, 1);
      const treeBudget = map.root.userData.renderBudget.trees;
      const gateBudget = map.root.userData.renderBudget.gwanghwamun;
      assert.equal(map.stats.meshes - treeBudget.drawCalls - gateBudget.drawCalls, 256);
      assert.equal(map.stats.triangles - treeBudget.nearTriangles - gateBudget.triangles, 78427);
      assert.equal(map.stats.colliders, 1694);
      assert.equal(map.stats.landingSurfaces, 1540);
      assert.equal(map.root.userData.renderBudget.allocatedMeshes - treeBudget.allocatedMeshes - gateBudget.drawCalls - gateBudget.farDrawCalls, 353);
      assert.equal(map.root.userData.renderBudget.allocatedTriangles - treeBudget.allocatedTriangles - gateBudget.triangles - gateBudget.farTriangles, 86880);
      assert.equal(map.layout.water.y, CHEONGGYE_LEVELS.water);
      assert.equal(map.layout.water.bedY, CHEONGGYE_LEVELS.bed);
      assert.equal(map.layout.promenadeY, CHEONGGYE_LEVELS.promenade);
      const actualCounts = new Map();
      let selectorBytes = 0;
      for (const mesh of terrain) {
        const selector = mesh.geometry.attributes.terrainKind;
        selectorBytes += selector.array.byteLength;
        assert.equal(selector.count, mesh.geometry.attributes.position.count);
        for (let i = 0; i < selector.count; i += 3) {
          assert.equal(selector.getX(i), selector.getX(i + 1));
          assert.equal(selector.getX(i), selector.getX(i + 2));
          assert.ok(Number.isFinite(mesh.geometry.attributes.position.getY(i)));
        }
        for (const value of selector.array) actualCounts.set(value, (actualCounts.get(value) ?? 0) + 1);
      }
      assert.deepEqual(actualCounts, expectedCounts);
      assert.equal(selectorBytes, 49950);
      const material = terrain[0].material;
      let disposed = 0;
      material.addEventListener('dispose', () => disposed++);
      evidence.push({ quality, terrainChunks: terrain.length, selectorBytes, stats: map.stats, budget: map.root.userData.renderBudget });
      map.dispose(); map.dispose();
      assert.equal(disposed, 1);
      assert.equal(map.root.children.length, 0);
    } finally { map.dispose(); }
  }
  fs.mkdirSync('evidence', { recursive: true });
  fs.writeFileSync('evidence/real-map-ground-detail.json', JSON.stringify({
    validation: 'CPU geometry, shader composition and budgets only; no GPU/browser validation', evidence,
  }, null, 2));
});
