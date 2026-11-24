# Experimental Seoul map integration

This integration has not been deployed by its implementation task.

## Scope and data

- Normal integrated scene uses the reviewed OSM sample, EPSG:5186 metric offsets from longitude 126.9805, latitude 37.573. One game unit is one metre, north is negative Z.
- Source area: 126.974–126.987 E, 37.568–37.578 N. This is a small Gwanghwamun–Jongno–western Cheonggyecheon sample, not all Seoul.
- Source snapshot: 2026-11-06 08:16:47 UTC, with relation details at 08:18:49. No source data is downloaded at runtime.
- `public/data/seoul-osm.json` contains the source-derived database, height evidence, estimates, render adapter and ODbL URLs. It is an ODbL dataset, separate from the software's MIT license.
- Existing Help includes the approved “© OpenStreetMap 기여자, ODbL” with official links. No other new UI explanation or control was added.

## Geometry and uncertainty

The adapter renders 1,540 building polygon pieces, 730 road polygon pieces and two source water-area polygons. The source geodata is community mapped, not a certified field survey. Nine additional water lines remain in the downloadable dataset; no unsupported stream width is inferred from them. Six building holes are retained. Invalid source relations remain excluded.

Source-level heights: 196 unverified OSM-tag values, two documentary values, 59 floor-count estimates and 1,269 unknown values. These are source-feature counts, not rendered-piece counts. Unknown heights use a 0.12 m footprint marker, not an invented building height. Cultural/special-purpose buildings without suitable evidence remain unknown. No height is labelled measured.

Ten parent outlines that contain building parts do not create full-height enclosing boxes. Uncovered outline fragments remain low footprint markers. Part minimum heights and voids are retained. Jongno Tower's documented 133.5 m maximum is applied only to its highest existing part; original tag values and source evidence remain in the database. SK Seorin remains 160 m from published evidence. Roof shapes/facades and terrain elevations are not surveyed.

Road polygons remain polygons. Centerlines are buffered using tagged widths or explicit lane/default estimates. Tunnels and negative layers remain in data but are not rendered as surface roads. Terrain is flat y=0; water surface y=0.02 and bed y=-0.5 are visual/physics approximations, with no measured flow imposed. Existing bridge roads shield water contact at ground level. The old deep rectangular channel is not reused.

## Runtime compatibility

- Exact polygon prisms and triangulated caps support building collision, landing, concavities, courtyard holes and elevated parts. AABB values are broad-phase metadata only.
- Existing movement world bounds contain every building footprint and the largest height (160 m) remains below the 180 m ceiling. The narrow margin outside sampled data stays empty; it is not claimed as mapped content.
- Player/home/nearby flock spawn at verified plaza point (-336, 0, 108). Procedural QA presets fall back to this point in the real-map scene. Use `?map=procedural&native-preset=roof` for old preset comparisons.
- All source roads stay visible/in data. NPC validation is limited to the 48 nearest walkable path segments around the plaza. All 48 routes and 11 spawn zones are accepted, with traffic and water exclusions. The full 1,018-edge graph took 65 seconds to validate, so it is not enabled. Local NPC initialization takes approximately 2.5 seconds on this test machine.
- Existing minimap, location label and marker use the geographic coordinate frame. No new mini-map widget is added.
- `?map=procedural` keeps the previous scene available. No production or experiment deployment was performed by this task.

## Verification

- Polygon collision tests: concavity, courtyard holes, roofs, swept walls, elevated parts, water/bridge masks, stationary overlaps, actual data spawns.
- NPC tests: actual source routes, 48 accepted paths/11 spawns, traffic exclusion, polygon-vs-AABB regression.
- Render tests: triangulated hole area, metric extents, finite vertices, height categories, 133.5 m maximum, spawn, committed frames and home reset.
- CPU geometry: five meshes, 44,808 triangles. No browser screenshot or GPU visual quality is claimed by these tests.
- Full application verification is coordinated separately so concurrent audio/camera changes are tested together.

Regeneration, using installed GDAL Python:

    /usr/bin/python3 tools/prepare-real-map.py ../gugu-real-map-research-20261106

The source folder is a developer input, not a user-download link. The generated database is self-contained in the built site's `data/seoul-osm.json` asset.
