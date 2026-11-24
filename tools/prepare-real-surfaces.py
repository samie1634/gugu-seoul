#!/usr/bin/python3
"""Offline derived rendering partition, not a change to OSM source observations.

Run /usr/bin/python3 tools/prepare-real-surfaces.py (GDAL/GEOS required).
Use --check to validate the committed output without rewriting it.
Input data.ts is the existing metric adapter of public/data/seoul-osm.json.
OSM contributors, ODbL-1.0. Widths and water levels remain visualization estimates.
"""
import argparse
import collections
import json
import pathlib
from osgeo import ogr

ROOT = pathlib.Path(__file__).resolve().parents[1]
INPUT = ROOT / 'src/native/ported/map/real-map/data.ts'
OUTPUT = ROOT / 'src/native/ported/map/real-map/surfaces.ts'
KINDS = ('ground', 'road', 'path', 'bridge', 'water')
TOLERANCE = 1e-5  # square metres over the entire 9 km² domain


def read_export(path):
    return json.loads(path.read_text().split(' = ', 1)[1].strip().removesuffix(';'))


def polygon(rings):
    return ogr.CreateGeometryFromJson(json.dumps({'type': 'Polygon', 'coordinates': rings}))


def rectangle(x, z, size):
    return polygon([[[x,z],[x+size,z],[x+size,z+size],[x,z+size],[x,z]]])


def parts(g):
    if g.IsEmpty():
        return
    if g.GetGeometryName() == 'POLYGON':
        if g.GetArea() > 0:
            yield g.Clone()
    elif g.GetGeometryName() in ('MULTIPOLYGON', 'GEOMETRYCOLLECTION'):
        for i in range(g.GetGeometryCount()):
            yield from parts(g.GetGeometryRef(i))


def union(geometries):
    # GEOS cascaded union eliminates internal overlaps before any render mesh exists.
    collection = ogr.Geometry(ogr.wkbMultiPolygon)
    for geometry in geometries:
        for part in parts(geometry):
            collection.AddGeometry(part)
    if collection.IsEmpty():
        return collection
    result = collection.UnionCascaded()
    assert result is not None and result.IsValid(), 'Union failed'
    return result


def clean(rings):
    g = polygon(rings)
    return g if g.IsValid() else g.MakeValid()


def generate():
    data = read_export(INPUT)
    # Source JSON is deliberately read-only; check the metric adapter still matches.
    source = json.loads((ROOT / 'public/data/seoul-osm.json').read_text())
    assert source['runtime']['coordinate_system']['origin_lonlat'] == data['origin']
    domain = rectangle(-1500, -1500, 3000)
    grouped = collections.defaultdict(list)
    for road in data['roads']:
        if road['underground']:
            continue
        kind = 'bridge' if road['bridge'] else 'path' if road['walkable'] else 'road'
        grouped[kind].append(clean(road['rings']))
    grouped['water'] = [clean(w['rings']) for w in data['water']]
    occupied = ogr.Geometry(ogr.wkbMultiPolygon)
    layers = {}
    # Bridge deck cuts water as well as other surfaces, rather than covering it.
    for kind in ('bridge', 'water', 'road', 'path'):
        raw = union(grouped[kind]).Intersection(domain)
        layers[kind] = raw.Difference(occupied)
        occupied = union([occupied, raw])
    layers['ground'] = domain.Difference(occupied)
    result = []
    # Shared tile edges do not overlap in area. Small shapes keep Earcut practical.
    for kind in KINDS:
        for x in range(-1500, 1500, 250):
            for z in range(-1500, 1500, 250):
                tile = rectangle(x, z, 250)
                if not layers[kind].Intersects(tile):
                    continue
                for part in parts(layers[kind].Intersection(tile)):
                    result.append({'kind': kind, 'rings': json.loads(part.ExportToJson())['coordinates'],
                                   'y': .02 if kind == 'water' else 0})
    return result


def validate(surfaces):
    grouped = collections.defaultdict(list)
    domain = rectangle(-1500, -1500, 3000)
    for surface in surfaces:
        kind = surface['kind']
        assert kind in KINDS
        assert surface['y'] == (.02 if kind == 'water' else 0)
        g = polygon(surface['rings'])
        assert g.IsValid() and not g.IsEmpty(), f'Invalid {kind} polygon'
        assert g.Difference(domain).GetArea() <= TOLERANCE
        grouped[kind].append(g)
    merged = {kind: union(grouped[kind]) for kind in KINDS}
    for i, kind in enumerate(KINDS):
        # Detect same-material coplanar overlaps as well as cross-material ones.
        area = sum(g.GetArea() for g in grouped[kind])
        assert abs(area - merged[kind].GetArea()) < TOLERANCE, f'{kind} self-overlap'
        for other in KINDS[i+1:]:
            overlap = merged[kind].Intersection(merged[other]).GetArea()
            assert overlap < TOLERANCE, f'{kind}/{other} overlap: {overlap}'
    # Preserve every source water hole and bridge footprint, including overlaps.
    data = read_export(INPUT)
    bridges = union(clean(r['rings']) for r in data['roads']
                    if r['bridge'] and not r['underground']).Intersection(domain)
    water = union(clean(w['rings']) for w in data['water']).Intersection(domain).Difference(bridges)
    for kind, expected in [('water', water), ('bridge', bridges)]:
        assert expected.SymmetricDifference(merged[kind]).GetArea() < TOLERANCE, f'{kind} source mismatch'
    all_surfaces = union(merged.values())
    assert domain.Difference(all_surfaces).GetArea() < TOLERANCE, 'Uncovered ground'
    assert abs(sum(g.GetArea() for g in merged.values()) - 9_000_000) < TOLERANCE
    print(json.dumps({'polygons': len(surfaces), 'areas_m2': {k: round(g.GetArea(), 6) for k, g in merged.items()},
                      'max_overlap_tolerance_m2': TOLERANCE}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    surfaces = read_export(OUTPUT) if args.check else generate()
    validate(surfaces)
    if not args.check:
        OUTPUT.write_text('// Generated by tools/prepare-real-surfaces.py; derived visualization only.\n'
                          '// OSM contributors, ODbL-1.0. Sources: data.ts and public/data/seoul-osm.json.\n'
                          '// Disjoint surface partition; heights/widths are not new surveyed observations.\n'
                          "export const realSurfaces: {kind:'ground'|'road'|'path'|'bridge'|'water';rings:number[][][]; y:number}[] = "
                          + json.dumps(surfaces, separators=(',', ':')) + ';\n')
        (ROOT / 'public/data/seoul-surface-partition.json').write_text(json.dumps({
            'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors',
            'source_database': 'seoul-osm.json',
            'description': 'Rendering-only disjoint surface partition; original observations unchanged. Heights and road buffer widths are not measured.',
            'surfaces': surfaces}, separators=(',', ':')))
