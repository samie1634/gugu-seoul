import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { realSurfaces } from '../src/native/ported/map/real-map/surfaces.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
function ringArea(ring) {
  return Math.abs(ring.reduce((area, point, i) => {
    const next = ring[(i + 1) % ring.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

test('derived surfaces cover the finite ground without stacked heights', () => {
  let totalArea = 0;
  const kinds = new Set();
  for (const surface of realSurfaces) {
    kinds.add(surface.kind);
    assert.equal(surface.y, surface.kind === 'water' ? 0.02 : 0);
    assert.ok(surface.rings.length > 0);
    for (const ring of surface.rings) {
      assert.deepEqual(ring[0], ring.at(-1));
      assert.ok(ring.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)
        && x >= -1500 && x <= 1500 && z >= -1500 && z <= 1500));
    }
    totalArea += ringArea(surface.rings[0]) - surface.rings.slice(1).reduce((a, r) => a + ringArea(r), 0);
  }
  assert.deepEqual([...kinds].sort(), ['bridge', 'ground', 'path', 'road', 'water']);
  assert.ok(Math.abs(totalArea - 9_000_000) < 1e-5, `area ${totalArea}`);
});

test('each bounded partition triangulates with its holes intact', () => {
  for (const surface of realSurfaces) {
    const rings = surface.rings.map(ring => ring.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)));
    const vertices = rings.flat();
    const triangles = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1));
    const area = triangles.reduce((sum, t) => sum + ringArea(t.map(i => [vertices[i].x, vertices[i].y])), 0);
    const expected = ringArea(surface.rings[0]) - surface.rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
    assert.ok(Math.abs(area - expected) < 1e-5, `${surface.kind} triangulation ${area} vs ${expected}`);
  }
});

test('GEOS validates cross-layer and self overlap, water holes and bridge priority', t => {
  const available = spawnSync('/usr/bin/python3', ['-c', 'from osgeo import ogr'], { encoding: 'utf8' });
  if (available.status !== 0) {
    t.skip('Offline topology verification requires system Python GDAL/GEOS');
    return;
  }
  const result = spawnSync('/usr/bin/python3', ['tools/prepare-real-surfaces.py', '--check'], {
    cwd: root, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.ok(JSON.parse(result.stdout).polygons > 0);
});
