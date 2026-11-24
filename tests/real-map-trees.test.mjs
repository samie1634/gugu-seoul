import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { mappedTreeNodes, mappedTreeSource } from '../src/native/ported/map/real-map/tree-data.ts';
import { createMappedTreeLods, treeArtworkScale, TREE_RENDER_BUDGET } from '../src/native/ported/map/real-map/trees.ts';
import { makeMapLayout, sampleGround } from '../src/native/ported/map/layout.ts';
import { polygonContains } from '../src/native/ported/map/real-map/geometry.ts';

test('only the 162 verified outdoor OSM node records are used, without indoor floor-four tree or invented points', () => {
  assert.equal(mappedTreeNodes.length, 162);
  assert.equal(new Set(mappedTreeNodes.map(row => row[0])).size, 162);
  assert.ok(!mappedTreeNodes.some(row => row[0] === 9837708384));
  assert.deepEqual(mappedTreeNodes.find(row => row[0] === 4439111930), [4439111930, -120.947, -391.06, 'broadleaf']);
  assert.equal(createHash('sha256').update(JSON.stringify(mappedTreeNodes)).digest('hex'), '26cd1d4eca10d779aa1edc8888c7bcba96959d39159ff2d3dd660dfffde08cec');
  assert.equal(mappedTreeNodes.filter(row => row[3] === 'needleleaf').length, 1);
  assert.equal(mappedTreeNodes.find(row => row[0] === 7576719568)[3], 'needleleaf');
  for (const [id, x, z, kind] of mappedTreeNodes) {
    assert.ok(Number.isSafeInteger(id) && id > 0);
    assert.ok(Number.isFinite(x) && Number.isFinite(z));
    assert.ok(Math.abs(x) <= 575 && Math.abs(z) <= 556);
    assert.ok(['broadleaf', 'needleleaf'].includes(kind));
  }
});

test('downloadable ODbL subset matches the runtime data without adding attribution UI', () => {
  const published = JSON.parse(fs.readFileSync(new URL('../public/data/seoul-trees.json', import.meta.url), 'utf8'));
  assert.deepEqual(published.nodes, mappedTreeNodes);
  assert.deepEqual(published.source, mappedTreeSource);
  assert.equal(published.source.licenseUrl, 'https://opendatacommons.org/licenses/odbl/1-0/');
  assert.equal(published.source.derivativeData, '/data/seoul-trees.json');
  assert.deepEqual(published.fields, ['osmNodeId', 'x', 'z', 'illustrativeCrown']);
  assert.equal(published.coordinateSystem.metricProjection, 'EPSG:5186');
  assert.deepEqual(published.coordinateSystem.originLonlat, [126.9805, 37.573]);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/class="map-attribution"/g) ?? []).length, 1);
  assert.match(html, /https:\/\/www.openstreetmap.org\/copyright/);
  assert.match(html, /https:\/\/opendatacommons.org\/licenses\/odbl\/1-0\//);
});

test('every rendered root keeps source x/z, samples actual ground, and adds no collisions or landing surfaces', () => {
  const layout = makeMapLayout({ data: 'osm' });
  const original = JSON.stringify({ colliders: layout.colliders, landingSurfaces: layout.landingSurfaces, water: layout.water, buildings: layout.realMap.buildings, origin: layout.realMap.origin });
  const tree = createMappedTreeLods(layout, 'desktop');
  const roots = [];
  try {
    tree.root.updateMatrixWorld(true);
    for (const lod of tree.root.children) {
      const [near, far] = lod.children;
      assert.equal(near.count, far.count);
      for (let i = 0; i < near.count; i++) {
        const matrix = new THREE.Matrix4(); near.getMatrixAt(i, matrix);
        const world = new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(near.matrixWorld);
        const node = mappedTreeNodes.find(row => row[0] === near.userData.nodeIds[i]);
        assert.ok(node);
        const ground = sampleGround(layout, node[1], node[2]);
        assert.ok(ground.walkable);
        assert.ok(Math.abs(world.x - node[1]) < 0.0001);
        assert.ok(Math.abs(world.z - node[2]) < 0.0001);
        assert.equal(world.y, ground.y);
        const farMatrix = new THREE.Matrix4(); far.getMatrixAt(i, farMatrix);
        assert.deepEqual(matrix.toArray(), farMatrix.toArray());
        assert.ok(!layout.realMap.water.some(polygon => polygonContains(polygon.rings, world.x, world.z)));
        assert.ok(!layout.realMap.buildings.some(polygon => polygon.minY <= world.y && polygon.height > world.y && polygonContains(polygon.rings, world.x, world.z)));
        roots.push({ id: node[0], x: world.x, y: world.y, z: world.z });
      }
    }
    assert.equal(roots.length, 162);
    assert.equal(JSON.stringify({ colliders: layout.colliders, landingSurfaces: layout.landingSurfaces, water: layout.water, buildings: layout.realMap.buildings, origin: layout.realMap.origin }), original);
    assert.equal(tree.budget.addedColliders, 0);
    assert.match(tree.root.userData.locationProvenance, /registered.*not current field-survey/);
    assert.match(tree.root.userData.shapeProvenance, /Original.*unmeasured/);
    fs.mkdirSync('evidence', { recursive: true });
    fs.writeFileSync('evidence/real-map-tree-positions.json', JSON.stringify({ verification: 'CPU instance roots, ground sampling and source-derived coordinates; no GPU/browser check', roots, budget: tree.budget }, null, 2));
  } finally { tree.dispose(); }
});

test('tree artwork is bounded by local spacing without moving a single registered coordinate', () => {
  for (const [id, x, z] of mappedTreeNodes) {
    const art = treeArtworkScale(id, x, z);
    assert.deepEqual(art, treeArtworkScale(id, x, z));
    assert.ok(Object.values(art).every(Number.isFinite));
    assert.ok(art.radius >= 0.3 && art.radius <= TREE_RENDER_BUDGET.maxCrownRadius);
    assert.ok(art.height >= TREE_RENDER_BUDGET.minHeight && art.height <= TREE_RENDER_BUDGET.maxHeight);
    for (const [otherId, otherX, otherZ] of mappedTreeNodes) {
      if (otherId === id) continue;
      assert.ok(art.radius <= Math.hypot(otherX - x, otherZ - z) * 0.42 + 1e-9);
    }
  }
});

test('mobile/desktop use bounded instanced LOD and only wholly nearby cells cast shadows', () => {
  for (const quality of ['mobile', 'desktop']) {
    const layout = makeMapLayout({ data: 'osm' });
    const tree = createMappedTreeLods(layout, quality);
    try {
      assert.equal(tree.budget.count, 162);
      assert.equal(tree.budget.chunks, 16);
      assert.equal(tree.budget.drawCalls, 16);
      assert.equal(tree.budget.allocatedMeshes, 32);
      assert.equal(tree.budget.nearTriangles, 20068);
      assert.equal(tree.budget.farTriangles, 5832);
      assert.ok(tree.budget.farTriangles < tree.budget.nearTriangles * 0.3);
      assert.equal(tree.budget.geometryBytes, 32400);
      assert.equal(tree.budget.instanceBytes, 24624);
      assert.equal(tree.budget.textureBytes, 0);
      const camera = new THREE.PerspectiveCamera();
      tree.root.updateMatrixWorld(true);
      for (const lod of tree.root.children) {
        const [near, far] = lod.children;
        assert.equal(lod.levels[1].distance, TREE_RENDER_BUDGET.lodMetres[quality]);
        assert.ok(near.isInstancedMesh && far.isInstancedMesh);
        assert.ok(near.frustumCulled && far.frustumCulled);
        assert.ok(near.boundingSphere.radius > 0 && Number.isFinite(near.boundingSphere.radius));
        assert.equal(near.material.transparent, false);
        assert.equal(far.material.transparent, false);
        assert.equal(far.material.map, null);
        for (const distance of [0, 30, 100, 300, 900, 0]) {
          camera.position.copy(lod.position).add(new THREE.Vector3(distance, 2, 0));
          camera.updateMatrixWorld(true); lod.update(camera);
          assert.notEqual(near.visible, far.visible);
          if (distance === 900) { assert.equal(far.visible, true); assert.equal(near.castShadow, false); }
          if (distance === 0) assert.equal(near.visible, true);
          assert.equal(far.castShadow, false);
          if (near.castShadow) {
            for (const id of near.userData.nodeIds) {
              const node = mappedTreeNodes.find(row => row[0] === id);
              const distanceToRoot = camera.position.distanceTo(new THREE.Vector3(node[1], sampleGround(layout, node[1], node[2]).y, node[2]));
              assert.ok(distanceToRoot <= TREE_RENDER_BUDGET.shadowMetres[quality] + 1e-6);
            }
          }
        }
      }
      // A single nearby tree demonstrates that the strict shadow radius can
      // enable shadows, rather than satisfying the bound by never casting any.
      const singleton = tree.root.children.find(lod => lod.children[0].count === 1);
      camera.position.copy(singleton.position).add(new THREE.Vector3(0, 2, 0)); camera.updateMatrixWorld(true); singleton.update(camera);
      assert.equal(singleton.children[0].castShadow, true);
    } finally { tree.dispose(); }
  }
});

test('shared geometry, materials and instance resources dispose exactly once', () => {
  const tree = createMappedTreeLods(makeMapLayout({ data: 'osm' }), 'desktop');
  const resources = new Set();
  tree.root.traverse(object => {
    if (object.isInstancedMesh) { resources.add(object); resources.add(object.geometry); resources.add(object.material); }
  });
  const counts = new Map();
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  tree.dispose(); tree.dispose();
  assert.equal(tree.root.children.length, 0);
  for (const resource of resources) assert.equal(counts.get(resource), 1);
});
