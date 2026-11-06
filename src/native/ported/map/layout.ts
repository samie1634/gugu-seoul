import { BOUNDS } from '../../../simulation.ts';
import type { BuildingSpec, GroundProbe, GroundSample, LandingSurface, MapCollider, MapLayout, MapOptions, MapPoint, MapRect, NavNode, RoofSpec, SurfaceKind, WaterContact } from './contracts.ts';

/** Anchors deliberately preserve the base game's compressed metre coordinate system. */
export const LANDMARK_ANCHORS = {
  gwanghwamun: { x: -12, z: -432 }, square: { x: -43, z: -80 },
  sejongCenter: { x: -176, z: -110 }, sejongDaero: { x: 34, z: 65 },
  jongno: { x: 285, z: 225 }, bosingak: { x: 520, z: 295 },
  cheonggyecheon: { x: 338, z: 420 },
} as const;
export const RIVER = { minX: 26, maxX: 650, minZ: 411, maxZ: 429, excavationMinZ: 395, excavationMaxZ: 445 } as const;
/** Existing bridge anchors; widths and designs are art approximations, not surveyed bridges. */
export const BRIDGES = [95, 237, 389, 579] as const;
export const RIVER_ENTRIES = [67, 278, 474] as const;
export const ROOF_COLUMNS = 6;
export const ROOF_ROWS = 12;
export const ROOF_RENDER_SEGMENTS = 24;

export function sejongRoad(layout:MapLayout):{width:number;minX:number;maxX:number;laneCentres:number[]}{
  const reference=layout.proportions==='reference-scale';const width=reference?30:52;
  return{width,minX:34-width/2,maxX:34+width/2,laneCentres:reference?Array.from({length:8},(_,i)=>34+(i-3.5)*3.25):[17,29,43,55]};
}

export function contains(rect: MapRect, x: number, z: number, margin = 0): boolean {
  return Math.abs(x - rect.x) <= rect.width / 2 + margin && Math.abs(z - rect.z) <= rect.depth / 2 + margin;
}
export function roofHeight(roof: RoofSpec, u: number, v: number): number {
  const hip = Math.max(0, 1 - Math.max((Math.abs(u) - 0.58) / 0.42, Math.abs(v)));
  return roof.y + roof.rise * hip + (roof.eaveUpturn ?? 0.38) * (Math.pow(Math.abs(u), 6) + Math.pow(Math.abs(v), 6));
}

/** Height of the actual 24x24 rendered triangles, including crease interpolation. */
export function roofMeshHeight(roof:RoofSpec,u:number,v:number):number{
  const n=ROOF_RENDER_SEGMENTS;
  const fu=(Math.max(-1,Math.min(1,u))+1)*n/2;const fv=(Math.max(-1,Math.min(1,v))+1)*n/2;
  const i=Math.min(n-1,Math.floor(fu));const j=Math.min(n-1,Math.floor(fv));const s=fu-i;const t=fv-j;
  const u0=i/n*2-1;const v0=j/n*2-1;const d=2/n;
  const a=roofHeight(roof,u0,v0),b=roofHeight(roof,u0+d,v0),c=roofHeight(roof,u0,v0+d),e=roofHeight(roof,u0+d,v0+d);
  return s+t<=1?a+(b-a)*s+(c-a)*t:e+(c-e)*(1-s)+(b-e)*(1-t);
}

export function makeMapLayout(options: MapOptions = {}): MapLayout {
  const terrain = options.terrain ?? 'flat-compatible';
  const sunken = terrain === 'sunken-channel';
  const layout: MapLayout = {
    terrain, proportions: options.proportions ?? 'reference-scale', quality: options.quality ?? 'mobile',
    water: { id: 'cheonggyecheon', ...RIVER, y: sunken ? -3.65 : -0.06, bedY: sunken ? -4.05 : -0.46, flowX: 1, flowZ: 0, flowSpeed: 0.65 },
    promenadeY: sunken ? -3.12 : 0,
    buildings: [], roofs: [], props: [], colliders: [], landingSurfaces: [], navNodes: [], navEdges: [], spawns: [],
  };
  const solid = (id: string, x: number, z: number, width: number, depth: number, height: number, surface: SurfaceKind, kind: MapCollider['kind'], minY = 0, landing = true) => {
    layout.colliders.push({ id, x, z, width, depth, height, minY, surface, kind });
    if (landing) layout.landingSurfaces.push({ id, x, z, width, depth, y: height, surface, maxFootRadius: Math.min(width,depth)/2, approximation: 0 });
  };
  const building = (spec: BuildingSpec) => {
    layout.buildings.push(spec);
    // Top cap and collision top are generated from the same dimensions in candidate.ts.
    solid(spec.id, spec.x, spec.z, spec.width + 0.5, spec.depth + 0.5, spec.height + 0.45, spec.palette === 'brick' ? 'stone' : 'granite', 'building');
    solid(`${spec.id}:plant`, spec.x + spec.width * 0.16, spec.z - spec.depth * 0.12, spec.width * 0.25, spec.depth * 0.24, spec.height + 3.0, 'metal', 'building', spec.height + 0.45);
  };
  building({ id: 'sejong-center', x: -176, z: -110, width: 116, depth: 138, height: 27, palette: 'limestone', facade: 'punched' });
  solid('sejong-center:cornice', -176, -110, 126, 147, 28.6, 'granite', 'building', 27.45);
  for (let z = -173; z < -41; z += 9) solid("sejong-center:fin:" + z, -116.2, z, 3.6, 2.2, 25, 'granite', 'column', 0, false);
  // Modern office envelopes are original massing approximations; no branded facade assets.
  building({ id: 'kyobo-block', x: 135, z: 123, width: 83, depth: 114, height: 81, palette: 'limestone', facade: 'curtain' });
  building({ id: 'jongno-tower-base', x: 514, z: 112, width: 53, depth: 60, height: 67, palette: 'concrete', facade: 'curtain' });
  solid('jongno-tower-skydeck', 514, 112, 84, 78, 107, 'metal', 'building', 93);
  for (const x of [489, 539]) solid(`jongno-tower-column:${x}`, x, 112, 4.8, 4.8, 93, 'metal', 'column', 67, false);
  let seed = 7741;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const x of [-525, -430, -332, -205, 149, 266, 349, 446, 574]) {
    for (const z of [-328, -205, -91, 74, 344, 498]) {
      if (x === -205 && z > -250 && z < 100) continue;
      if (x === 149 && z === 74) continue;
      if (x > 470 && (z === 74 || z === 344)) continue;
      if (x > 80 && z === 344) continue;
      building({ id: `block:${x}:${z}`, x: x + (rand() - 0.5) * 10, z,
        width: 49 + rand() * 22, depth: 48 + rand() * 23, height: 17 + rand() * (Math.abs(x) > 300 ? 41 : 51),
        palette: rand() > 0.65 ? 'brick' : 'concrete', facade: 'punched' });
    }
  }
  for (let i = 0; i < 7; i += 1) building({ id: `jongno-shop:${i}`, x: 132 + i * 51, z: 278, width: 43, depth: 32, height: 13 + i % 3 * 2, palette: i % 2 ? 'brick' : 'limestone', facade: 'punched' });

  // Three arched passages remain open at walking height.
  const gx = LANDMARK_ANCHORS.gwanghwamun.x; const gz = LANDMARK_ANCHORS.gwanghwamun.z;
  const reference = layout.proportions === 'reference-scale';
  const intervals = [[-38, -26.8], [-17.2, reference?-6:-4.8], [reference?6:4.8, 17.2], [26.8, 38]];
  for (const [i, [a, b]] of intervals.entries()) solid(`gate:pier:${i}`, gx + (a + b) / 2, gz, b - a, 15, 11.15, 'granite', 'wall');
  for (const arch of [-22, 0, 22]) for (let i = 0; i < 10; i += 1) {
    const rx = reference && arch===0 ? 6 : 4.8;
    const ry = reference ? arch===0?5:4.4 : 4.8;
    const jamb = reference ? arch===0?4.5:4.2 : 6.25;
    const a = -rx + i * rx/5; const b = a + rx/5;
    const farthest = Math.max(Math.abs(a),Math.abs(b));
    const low = jamb + ry*Math.sqrt(Math.max(0,1-farthest*farthest/(rx*rx)));
    solid(`gate:arch:${arch}:${i}`, gx + arch + (a + b) / 2, gz, rx/5, 15, 11.5, 'granite', 'wall', low, false);
  }
  solid('gate:stone-deck', gx, gz, 76, 19, 12.5, 'granite', 'wall', 11.15);
  for (const side of [-1, 1]) solid(`palace:wall:${side}`, gx + side * 165, gz, 247, 5.5, 9.1, 'stone', 'wall');
  for (const x of [-29, -19.3, -9.6, 0, 9.6, 19.3, 29]) for (const side of [-1, 1]) solid(`gate:column:${x}:${side}`, gx + x, gz + side * 7, 1.4, 1.4, 21.1, 'wood', 'column', 12.5, false);
  solid('gate:lower-pavilion', gx, gz, 62, 5, 21.3, 'wood', 'building', 14.7);
  solid('gate:upper-pavilion', gx, gz, 51, 4, 30.9, 'wood', 'building', 26.5);
  layout.roofs.push({ id: 'gate:lower-roof', x: gx, z: gz, width: 83, depth: 28, y: 21.4, rise: 6.5 }, { id: 'gate:upper-roof', x: gx, z: gz, width: 68, depth: 23, y: 31, rise: 5.4 });
  // Bosingak: open columned court, with a hanging bell, not a solid box at ground level.
  for (const x of [-18.5,-11.1,-3.7,3.7,11.1,18.5]) for (const z of [-10.5,-5.25,0,5.25,10.5]) solid(`bosingak:column:${x}:${z}`,520+x,295+z,1.3,1.3,13.5,'wood','column',0,false);
  solid('bosingak:bell', 520, 295, 5.6, 5.6, 10.8, 'metal', 'prop', 4.4, false);
  solid('bosingak:upper-pavilion', 520, 295, 32, 12, 22, 'wood', 'building', 18.8);
  layout.roofs.push({ id: 'bosingak:lower-roof', x: 520, z: 295, width: 51, depth: 35, y: 13.5, rise: 5.2 }, { id: 'bosingak:upper-roof', x: 520, z: 295, width: 43, depth: 27, y: 22, rise: 4.7 });
  if (reference) applyReferenceScale(layout);
  // Legacy AABB broad phase only: reference flight must use queryRoofSupport for narrow-phase contact.

  for (const roof of layout.roofs) for (let row = 0; row < ROOF_ROWS; row += 1) for (let col = 0; col < ROOF_COLUMNS; col += 1) {
    const u0 = col / ROOF_COLUMNS * 2 - 1; const u1 = (col + 1) / ROOF_COLUMNS * 2 - 1;
    const v0 = row / ROOF_ROWS * 2 - 1; const v1 = (row + 1) / ROOF_ROWS * 2 - 1;
    const heights = [roofHeight(roof, u0, v0), roofHeight(roof, u1, v0), roofHeight(roof, u0, v1), roofHeight(roof, u1, v1), roofHeight(roof, (u0 + u1) / 2, (v0 + v1) / 2)];
    const top = Math.max(...heights) + 0.16; const bottom = Math.min(...heights) - 0.28;
    const id = `${roof.id}:${row}:${col}`; const x = roof.x + (u0 + u1) / 2 * roof.width / 2; const z = roof.z + (v0 + v1) / 2 * roof.depth / 2;
    solid(id, x, z, roof.width / ROOF_COLUMNS, roof.depth / ROOF_ROWS, top, 'roof-tile', 'roof', bottom, false);
    layout.landingSurfaces.push({ id, x, z, width: roof.width / ROOF_COLUMNS, depth: roof.depth / ROOF_ROWS, y: top, surface: 'roof-tile', maxFootRadius: Math.min(roof.width/ROOF_COLUMNS,roof.depth/ROOF_ROWS)/2, approximation: top - Math.min(...heights) });
  }
  solid('monument:sejong', -45, -172, 10, 10, 4.2, 'granite', 'monument');
  solid('monument:sejong:body', -45, -172, 4.3, 5.4, 10.4, 'metal', 'monument',4.2);
  solid('monument:yi', -45, 117, 5.6, 5.6, 10.5, 'granite', 'monument');
  solid('monument:yi:body', -45, 117, 3.5, 3.5, 17, 'metal', 'monument',10.5);

  for (let z = -320; z < 180; z += 62) {
    layout.props.push({ id: `bench:${z}`, kind: 'bench', x: -79, y: 0, z: z + 10 });
    solid(`bench:${z}:seat`, -79, z + 10, 2.8, 0.85, 0.5, 'wood', 'prop', 0.34);
    solid(`bench:${z}:back`, -79, z + 10.39, 2.8, 0.12, 1.0, 'wood', 'prop', 0.5);
    layout.props.push({ id: `planter:${z}`, kind: 'planter', x: -85, y: 0, z });
    solid(`planter:${z}`, -85, z, 9, 12, 0.45, 'stone', 'prop');
  }
  for (let z = -350; z < 400; z += 50) {
    layout.props.push({ id: `lamp:${z}`, kind: 'lamp', x: 67, y: 0, z });
    solid(`lamp:${z}`, 67, z, 0.34, 0.34, 8.5, 'metal', 'column', 0, false);
  }
  for (const x of [-73, -57, -9]) {
    layout.props.push({ id: `bollard:${x}`, kind: 'bollard', x, y: 0, z: 183 });
    solid(`bollard:${x}`, x, 183, 0.4, 0.4, 0.86, 'metal', 'prop');
  }
  for (const x of BRIDGES) {
    solid(`bridge:${x}:deck`, x, 420, 12, 50, 0, 'stone', 'bridge', -0.48);
    const railParts = sunken ? [{ z: 420, depth: 49.6 }] : [{ z: 398.5, depth: 7 }, { z: 420, depth: 22 }, { z: 441.5, depth: 7 }];
    for (const side of [-1, 1]) for (const [i, part] of railParts.entries()) solid(`bridge:${x}:rail:${side}:${i}`, x + side * 6, part.z, 0.28, part.depth, 1.12, 'metal', 'wall');
  }
  // Retaining walls have actual entrance gaps, shared by geometry and navigation.
  for (const side of [-1, 1]) {
    const gaps = [...BRIDGES.map(x=>({min:x-6.4,max:x+6.4})), ...(side<0?RIVER_ENTRIES.map(x=>({min:x-3,max:x+3})):[])].sort((a,b)=>a.min-b.min);
    let start: number = RIVER.minX;
    for (const gap of [...gaps,{min:RIVER.maxX,max:RIVER.maxX}]) {
      if (gap.min > start) solid(`river:wall:${side}:${start}`, (start + gap.min) / 2, 420 + side * 24, gap.min - start, 1.0, 0.64, 'stone', 'wall', sunken ? -3.5 : -0.4);
      start = Math.max(start,gap.max);
    }
  }
  navigation(layout);
  return layout;
}

function navigation(layout: MapLayout): void {
  const node = (id: string, x: number, z: number) => {
    const ground = sampleGround(layout, x, z);
    layout.navNodes.push({ id, x, y: ground.y, z, zone: ground.zone });
  };
  const edge = (a: string, b: string, kind: 'walk' | 'crossing' | 'ramp' = 'walk', width = 3) => layout.navEdges.push({ a, b, kind, width, requiresTrafficCheck: kind === 'crossing' });
  for (const [i, z] of [-370, -245, -85, 65, 177].entries()) { node(`square:${i}`, -24, z); if (i) edge(`square:${i - 1}`, `square:${i}`, 'walk', 8); }
  node('square:south', -24, 193); edge('square:4', 'square:south', 'walk', 6);
  node('jongno:west', 84, 193); edge('square:south', 'jongno:west', 'crossing', 8);
  for (const [i, x] of [145, 300, 460, 610].entries()) { node(`jongno:north:${i}`, x, 193); edge(i ? `jongno:north:${i - 1}` : 'jongno:west', `jongno:north:${i}`, 'walk', 5); }
  node('jongno:south:west', 84, 253); edge('jongno:west', 'jongno:south:west', 'crossing', 8);
  node('jongno:south:east', 610, 253); edge('jongno:south:west', 'jongno:south:east', 'walk', 5);
  node('bosingak:court', 575, 315); node('bosingak:entry', 610, 315);
  edge('jongno:south:east', 'bosingak:entry', 'walk', 4); edge('bosingak:entry', 'bosingak:court', 'walk', 4);
  node('square:pre-crossing', -24, 199); node('square:post-crossing', -24, 251);
  edge('square:south', 'square:pre-crossing', 'walk', 5);
  edge('square:pre-crossing', 'square:post-crossing', 'crossing', 8);
  node('river:approach', -24, 380); edge('square:post-crossing', 'river:approach', 'walk', 5);
  node('river:street:west', 67, 379); edge('river:approach', 'river:street:west', 'crossing', 5);
  for (const [i, x] of RIVER_ENTRIES.entries()) {
    node(`river:ramp:${i}:top`, x, 382); node(`river:ramp:${i}:bottom`, x, 405);
    if (!i) edge('river:street:west', `river:ramp:${i}:top`);
    if (i) edge(`river:ramp:${i - 1}:top`, `river:ramp:${i}:top`, 'walk', 5);
    edge(`river:ramp:${i}:top`, `river:ramp:${i}:bottom`, 'ramp', 5);
    if (i) edge(`river:ramp:${i - 1}:bottom`, `river:ramp:${i}:bottom`, 'walk', 4);
  }
  node('river:north:east', 620, 405); edge('river:ramp:2:bottom', 'river:north:east', 'walk', 4);
  node('river:street:spine', 67, 378); edge('river:street:west', 'river:street:spine');
  for (const [i, x] of BRIDGES.entries()) {
    node(`bridge:${i}:street`, x, 378);
    edge(i ? `bridge:${i - 1}:street` : 'river:street:spine', `bridge:${i}:street`, 'walk', 4);
    node(`bridge:${i}:north`, x, 391); node(`bridge:${i}:south`, x, 449);
    edge(`bridge:${i}:street`, `bridge:${i}:north`, 'walk', 4);
    if (i) edge(`bridge:${i - 1}:south`, `bridge:${i}:south`, 'walk', 4);
    edge(`bridge:${i}:north`, `bridge:${i}:south`, 'walk', 8);
  }
  const spawnSpecs = [['square:quiet', -24, -85], ['square:south', -24, 65], ['jongno:north', 300, 193], ['bosingak:quiet', 575, 315], ['river:walk', 350, 405]] as const;
  for (const [id, x, z] of spawnSpecs) layout.spawns.push({ id, x, z, y: sampleGround(layout, x, z).y, clearance: 1.2, for: ['human', 'dog', 'cat', 'rat', 'bird'] });
}

/** Base terrain only; roofs and props are separate landing surfaces/colliders. */
export function sampleGround(layout: MapLayout, x: number, z: number, probe?: GroundProbe): GroundSample {
  const { minX, maxX, excavationMinZ: north, excavationMaxZ: south } = RIVER;
  if (x >= minX && x <= maxX) {
    if (BRIDGES.some(bx => Math.abs(x - bx) <= 5.8) && z >= north && z <= south && (!probe || 0 <= probe.feetY + (probe.maxStep ?? 0.25))) return { y: 0, surface: 'stone', walkable: true, zone: 'bridge' };
    if (RIVER_ENTRIES.some(ex => Math.abs(x - ex) <= 2.8) && z >= 382 && z <= 405) return { y: layout.promenadeY * (z - 382) / 23, surface: 'stone', walkable: true, zone: 'ramp' };
    if (z >= north && z <= south) {
      if (z > RIVER.minZ && z < RIVER.maxZ) return { y: layout.terrain === 'sunken-channel' ? layout.water.bedY : 0, surface: 'water', walkable: false, zone: 'riverbed' };
      return { y: layout.promenadeY, surface: 'stone', walkable: true, zone: 'promenade' };
    }
  }
  if(layout.proportions==='reference-scale' && Math.abs(x+12)<=14.85 && z>=-424.65 && z<=-375.95)return{y:0,surface:'granite',walkable:true,zone:'courtyard'};
  if (x >= (layout.proportions==='reference-scale'?-59:-94) && x <= 1 && z >= -372 && z <= 185) return { y: 0, surface: 'granite', walkable: true, zone: 'square' };
  if (x >= 470 && x <= 570 && z >= 258 && z <= 335) return { y: 0, surface: 'granite', walkable: true, zone: 'courtyard' };
  const avenue=sejongRoad(layout);
  const road = (x >= avenue.minX && x <= avenue.maxX && z >= (layout.proportions==='reference-scale'?-380:-530) && z<=395) || (z >= 205 && z <= 245) || (z >= -410 && z <= -380);
  return { y: 0, surface: road ? 'asphalt' : 'stone', walkable: true, zone: 'street' };
}

/** y is feet height. No arbitrary river-depth movement or buoyancy is imposed here. */
export function sampleWater(layout: MapLayout, x: number, y: number, z: number): WaterContact | null {
  const w = layout.water;
  if (![x, y, z].every(Number.isFinite)) return null;
  if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ || y > w.y + (layout.terrain==='flat-compatible'?0.12:0.02) || y < w.bedY - 0.1) return null;
  // A bridge deck at street level shields feet from water beneath it.
  if (BRIDGES.some(bx => Math.abs(x - bx) <= 6) && y >= -0.48) return null;
  return { id: w.id, y: w.y, depth: Math.max(0, w.y - y), current: { x: w.flowX * w.flowSpeed, z: w.flowZ * w.flowSpeed } };
}
export function isSpawnClear(layout: MapLayout, point: MapPoint, radius = 1.2, height = 2): boolean {
  if (![point.x, point.y, point.z, radius, height].every(Number.isFinite) || radius < 0 || height <= 0) return false;
  if (point.x - radius < BOUNDS.minX || point.x + radius > BOUNDS.maxX || point.z - radius < BOUNDS.minZ || point.z + radius > BOUNDS.maxZ) return false;
  const ground = sampleGround(layout, point.x, point.z, { feetY: point.y, height });
  if (!ground.walkable || Math.abs(ground.y - point.y) > 0.08) return false;
  if (Math.abs(point.z - 420) < 10 + radius && point.x >= RIVER.minX - radius && point.x <= RIVER.maxX + radius && ground.zone !== 'bridge') return false;
  return !layout.colliders.some(c => contains(c, point.x, point.z, radius) && c.height > point.y + 0.06 && (c.minY ?? 0) < point.y + height);
}
/** Exact pitched-roof foot support; never uses the coarse AABB band height. */
export function queryRoofSupport(layout: MapLayout, x: number, z: number, footRadius = 0, maxY = Infinity): LandingSurface | null {
  if (![x,z,footRadius].every(Number.isFinite) || footRadius<0) return null;
  let best: LandingSurface|null=null;
  for(const roof of layout.roofs){
    if(!contains(roof,x,z,-footRadius))continue;
    const u=(x-roof.x)/(roof.width/2);const v=(z-roof.z)/(roof.depth/2);
    const onRidge=Math.abs(x-roof.x)+footRadius<=roof.width*0.29 && Math.abs(z-roof.z)+footRadius<=0.35;
    const y=onRidge?roof.y+roof.rise+0.32:roofMeshHeight(roof,u,v)+0.015;
    if(y>maxY)continue;
    if(!best || y>best.y)best={id:roof.id,x:roof.x,z:roof.z,width:roof.width,depth:roof.depth,y,surface:'roof-tile',maxFootRadius:Math.min(roof.width/2-Math.abs(x-roof.x),roof.depth/2-Math.abs(z-roof.z)),approximation:0.015};
  }
  return best;
}
export const sampleRoofSupport = queryRoofSupport;
export function roofNormal(roof: RoofSpec, x: number, z: number): {x:number;y:number;z:number} {
  if(Math.abs(x-roof.x)<=roof.width*0.29 && Math.abs(z-roof.z)<=0.35)return{x:0,y:1,z:0};
  const u=(x-roof.x)/(roof.width/2); const v=(z-roof.z)/(roof.depth/2); const eps=0.005;
  const dx=(roofMeshHeight(roof,u+eps/(roof.width/2),v)-roofMeshHeight(roof,u-eps/(roof.width/2),v))/(2*eps);
  const dz=(roofMeshHeight(roof,u,v+eps/(roof.depth/2))-roofMeshHeight(roof,u,v-eps/(roof.depth/2)))/(2*eps);
  const length=Math.hypot(dx,1,dz);return {x:-dx/length,y:1/length,z:-dz/length};
}
/** Body radius defines feetY; footRadius alone defines the supported disk. */
export function surfaceAt(layout: MapLayout, actor: MapPoint, radius: number, footRadius = radius): LandingSurface | null {
  if(![actor.x,actor.y,actor.z,radius,footRadius].every(Number.isFinite)||radius<0||footRadius<0)return null;
  const feet=actor.y-radius;
  let best:LandingSurface|null=null;
  const roof=queryRoofSupport(layout,actor.x,actor.z,footRadius,feet+0.02);
  if(roof && Math.abs(roof.y-feet)<=0.02)best=roof;
  for(const surface of layout.landingSurfaces){
    if(surface.approximation>0 || footRadius>surface.maxFootRadius || !contains(surface,actor.x,actor.z,-footRadius))continue;
    if(Math.abs(surface.y-feet)<=0.01 && (!best || surface.y>best.y))best=surface;
  }
  return best;
}

/** Official 20m gate height; widths, roof depths and Bosingak envelope remain documented estimates. */
function applyReferenceScale(layout:MapLayout):void{
  const gx=LANDMARK_ANCHORS.gwanghwamun.x;const gz=LANDMARK_ANCHORS.gwanghwamun.z;
  const xScale=35/76;const zScale=14.7/19;const upperScale=(13-0.32)/(36.4-12.5);
  const gateY=(y:number)=>y<=12.5?y*7/12.5:7+(y-12.5)*upperScale;
  for(const collider of layout.colliders){
    if(collider.id.startsWith('gate:')){
      collider.x=gx+(collider.x-gx)*xScale;collider.z=gz+(collider.z-gz)*zScale;collider.width*=xScale;collider.depth*=zScale;
      collider.height=gateY(collider.height);collider.minY=gateY(collider.minY??0);
    }else if(collider.id.startsWith('bosingak:')){
      collider.x=520+(collider.x-520)*0.5;collider.z=295+(collider.z-295)*0.6;collider.width*=0.5;collider.depth*=0.6;collider.height*=17/26.86;collider.minY=(collider.minY??0)*17/26.86;
    }else if(collider.id.startsWith('palace:wall:')){
      collider.x=gx+Math.sign(collider.x-gx)*(17.5+collider.width/2);collider.height=3.6;
    }
  }
  for(const roof of layout.roofs){
    if(roof.id.startsWith('gate:')){roof.width*=xScale;roof.depth*=zScale;roof.y=gateY(roof.y);roof.rise*=upperScale;roof.eaveUpturn=0.38*upperScale;}
    else{roof.width*=0.5;roof.depth*=0.6;roof.y*=17/26.86;roof.rise*=17/26.86;roof.eaveUpturn=0.38*17/26.86;}
  }
  for(const surface of layout.landingSurfaces){
    const collider=layout.colliders.find(c=>c.id===surface.id);
    if(collider){surface.x=collider.x;surface.z=collider.z;surface.width=collider.width;surface.depth=collider.depth;surface.y=collider.height;surface.maxFootRadius=Math.min(collider.width,collider.depth)/2;}
  }
}

export function nodeById(layout: MapLayout, id: string): NavNode {
  const found = layout.navNodes.find(n => n.id === id);
  if (!found) throw new Error(`Unknown navigation node ${id}`);
  return found;
}


