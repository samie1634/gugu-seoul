import { gwanghwamunCollision, isReplacedGwanghwamun } from '../../../map/real-map/gwanghwamun.ts';
import { realMapData } from '../../../map/real-map/data.ts';
import { channelSolids, channelTerraces, channelExcavations, CHEONGGYE_LEVELS, inChannelExcavation } from '../../../map/real-map/cheonggye-channel.ts';
import { ShapeUtils, Vector2 } from 'three';
import type { MapLayout } from '../../../map/contracts.ts';
import { sampleWater } from '../../../map/layout.ts';
import type { MapNativeQueries } from './map-queries.ts';
import type { NativeBody, NativeSupport, NativeSupportProbe, NativeSweepHit, Vec3 } from './contracts.ts';
import { face, overlaps, pointAt, segmentBounds, sweepEllipsoidFace, sweepSphereFace, type Box, type Contact, type Face } from './collision.ts';

type Polygon = { id: string; rings: number[][][]; height: number; minY: number; surface: string };
type Prism = Polygon & { box: Box; faces: Face[] };
const EPS = 1e-7;
const UP = { x: 0, y: 1, z: 0 };
const CELL = 32;
function ringContains(ring: number[][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function contains(p: { rings: number[][][] }, x: number, z: number): boolean {
  return !!p.rings[0] && ringContains(p.rings[0], x, z) && !p.rings.slice(1).some(r => ringContains(r, x, z));
}
function edgeDistance(p: { rings: number[][][] }, x: number, z: number): number {
  let nearest = Infinity;
  for (const ring of p.rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    nearest = Math.min(nearest, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
  }
  return nearest;
}
function disk(p: { rings: number[][][] }, x: number, z: number, radius: number): boolean {
  return contains(p, x, z) && edgeDistance(p, x, z) >= radius - EPS;
}
function prism(p: Polygon): Prism {
  const rings = p.rings.map(r => {
    const points = r.map(v => new Vector2(v[0], v[1]));
    if (points.length > 1 && points[0].equals(points[points.length - 1])) points.pop();
    return points;
  });
  const points = rings.flat();
  const faces: Face[] = [];
  const at = (v: Vector2, y: number) => ({ x: v.x, y, z: v.y });
  for (const triangle of ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
    const [a, b, c] = triangle.map(i => points[i]);
    faces.push(face(at(a, p.height), at(c, p.height), at(b, p.height)));
    faces.push(face(at(a, p.minY), at(b, p.minY), at(c, p.minY)));
  }
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    faces.push(face(at(a, p.minY), at(b, p.minY), at(a, p.height)), face(at(b, p.minY), at(b, p.height), at(a, p.height)));
  }
  return { ...p, faces, box: { min: { x: Math.min(...points.map(v => v.x)), y: p.minY, z: Math.min(...points.map(v => v.y)) }, max: { x: Math.max(...points.map(v => v.x)), y: p.height, z: Math.max(...points.map(v => v.y)) } } };
}
class Grid<T extends { box: Box }> {
  private cells = new Map<string, T[]>();
  constructor(items: T[]) {
    for (const item of items) this.visit(item.box, key => {
      const cell = this.cells.get(key) ?? [];
      cell.push(item); this.cells.set(key, cell);
    });
  }
  private visit(box: Box, run: (key: string) => void): void {
    for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++)
      for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) run(x + ',' + z);
  }
  query(box: Box): T[] {
    const found = new Set<T>();
    this.visit(box, key => { for (const item of this.cells.get(key) ?? []) if (overlaps(item.box, box)) found.add(item); });
    return [...found];
  }
}
const validPosition = (v: Vec3) => !!v && [v.x, v.y, v.z].every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
const validRadius = (r: number) => Number.isFinite(r) && r >= 0.001 && r <= 10;
const validBody = (b: NativeBody) => !!b && validRadius(b.horizontalRadiusM) && Number.isFinite(b.heightM) && b.heightM <= 20 && Number.isFinite(b.centreToSoleM) && b.centreToSoleM > 0 && b.heightM > b.centreToSoleM && Number.isFinite(b.footSupportRadiusM) && b.footSupportRadiusM >= 0 && b.footSupportRadiusM <= 10 && validPosition(b.eyeFromSoleM);

/** Real geographic footprints are collision geometry, never their broad-phase bounds. */
export function createRealMapQueries(layout: Readonly<MapLayout>): MapNativeQueries {
  const data = layout.realMap!, channel=data===realMapData;
  const buildings = data.buildings.filter(p => (!channel || !isReplacedGwanghwamun(p)) && p.height > p.minY && p.rings[0]?.length >= 3).map(prism);
  const gate=channel?gwanghwamunCollision():{solids:[],surfaces:[]};
  if(channel)buildings.push(...channelSolids.map(prism),...gate.solids.map(prism));
  const gatePanels=gate.surfaces.flatMap(surface=>surface.triangles.map(triangle=>{
    const panel=face(...triangle.map(([x,y,z])=>({x,y,z})) as [Vec3,Vec3,Vec3]);
    return {id:surface.id,surface:surface.surface,panel,box:panel.bounds};
  }));
  const gateGrid=new Grid(gatePanels);
  const gateHeight=(panel:Face,x:number,z:number):number|null=>{
    if(panel.normal.y<.12)return null;
    const {a,b,c}=panel.triangle,den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if(Math.abs(den)<1e-9)return null;
    const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
    return u>=-EPS&&v>=-EPS&&u+v<=1+EPS?u*a.y+v*b.y+(1-u-v)*c.y:null;
  };
  const grid = new Grid(buildings);
  const bridges = data.roads.filter(r => r.bridge && !r.underground);
  const wet = (x: number, z: number) => data.water.some(p => contains(p, x, z)) && (channel || !bridges.some(p => contains(p, x, z)));
  const oldDryDisk = (x: number, z: number, r: number) => bridges.some(p => disk(p, x, z, r)) ||
    !data.water.some(p => contains(p, x, z) || edgeDistance(p, x, z) < r - EPS);
  const dryDisk=(x:number,z:number,r:number)=>channel?!channelExcavations.some(p=>contains(p,x,z)||edgeDistance(p,x,z)<r-EPS):oldDryDisk(x,z,r);
  function supportAt(p: NativeSupportProbe): NativeSupport | null | undefined {
    if (!p || !validPosition(p.at) || ![p.previousFeetY, p.footRadiusM, p.heightM, p.maxRiseM, p.maxDropM].every(Number.isFinite) || p.footRadiusM < 0 || p.footRadiusM > 10 || p.heightM <= 0 || p.maxRiseM < 0 || p.maxDropM < 0) return undefined;
    const low = Math.min(p.at.y, p.previousFeetY) - p.maxDropM, high = p.previousFeetY + p.maxRiseM;
    let best: NativeSupport | null = null;
    const offer = (id: string, height: number, surface: string, walkable = true) => {
      if (height >= low - EPS && height <= high + EPS && (!best || height > best.height + EPS || height === best.height && id === p.layerId)) best = { id, layerId: id, height, surface, normal: UP, walkable, landable: walkable };
    };
    if (dryDisk(p.at.x, p.at.z, p.footRadiusM)) {
      const road = data.roads.find(r => !r.underground && disk(r, p.at.x, p.at.z, p.footRadiusM));
      offer(road?.id ?? 'terrain:real-ground', 0, road?.surface ?? 'stone');
    } else if (wet(p.at.x, p.at.z)) offer('terrain:real-waterbed', channel?CHEONGGYE_LEVELS.bed:-.5, 'soil', false);
    if(channel)for(const terrace of channelTerraces)if(disk(terrace,p.at.x,p.at.z,p.footRadiusM))offer(terrace.id,CHEONGGYE_LEVELS.promenade,'stone');
    const box = { min: { x: p.at.x - p.footRadiusM, y: low, z: p.at.z - p.footRadiusM }, max: { x: p.at.x + p.footRadiusM, y: high, z: p.at.z + p.footRadiusM } };
    for (const solid of grid.query(box)) if (disk(solid, p.at.x, p.at.z, p.footRadiusM)) offer(solid.id, solid.height, solid.surface);
    const panels=gateGrid.query(box);
    for(const entry of panels){
      const y=gateHeight(entry.panel,p.at.x,p.at.z);if(y===null||y<low-EPS||y>high+EPS||best&&y<=best.height+EPS)continue;
      // A foot disk can straddle tessellation edges but must stay on the same
      // roof surface, not balance on its outside edge or an arch hole.
      const covered=[0,1,2,3,4,5,6,7].every(i=>{
        const angle=i*Math.PI/4,x=p.at.x+Math.cos(angle)*p.footRadiusM,z=p.at.z+Math.sin(angle)*p.footRadiusM;
        return panels.some(q=>q.id===entry.id&&gateHeight(q.panel,x,z)!==null);
      });
      if(covered)best={id:entry.id,layerId:entry.id,height:y,surface:entry.surface,normal:entry.panel.normal,walkable:true,landable:true};
    }
    return best;
  }
  function sweep(from: Vec3, to: Vec3, shape: number | NativeBody): NativeSweepHit | null | undefined {
    if (!validPosition(from) || !validPosition(to) || Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > 96) return undefined;
    const body = typeof shape === 'number' ? undefined : shape;
    const r = typeof shape === 'number' ? shape : shape.horizontalRadiusM;
    if (!validRadius(r) || body && !validBody(body)) return undefined;
    const below = body?.centreToSoleM ?? r, above = body ? body.heightM - below : r;
    const bounds = segmentBounds(from, to, r, below, above);
    let best: NativeSweepHit | null = null;
    const consider = (hit: Contact | null | undefined, id: string) => {
      if (hit && (!best || hit.fraction < best.fraction - EPS || Math.abs(hit.fraction - best.fraction) <= EPS && hit.normal.y > best.normal.y)) best = { ...hit, point: pointAt(from, to, hit.fraction), colliderId: id, layerId: id };
    };
    for (const solid of grid.query(bounds)) {
      const centreY = from.y + (above - below) / 2;
      if (centreY > solid.minY + EPS && centreY < solid.height - EPS && contains(solid, from.x, from.z)) consider({ fraction: 0, normal: UP }, solid.id);
      for (const panel of solid.faces) {
        if (!overlaps(bounds, panel.bounds)) continue;
        const hit = body ? sweepEllipsoidFace(from, to, body, panel) : sweepSphereFace(from, to, r, panel);
        if (hit === undefined) return undefined;
        consider(hit, solid.id);
      }
    }
    for(const entry of gateGrid.query(bounds)){
      const hit=body?sweepEllipsoidFace(from,to,body,entry.panel):sweepSphereFace(from,to,r,entry.panel);
      if(hit===undefined)return undefined;consider(hit,entry.id);
    }
    // Flat ground is masked by exact water footprints. The lower bed is global,
    // so no synthetic rectangular bank walls leak beyond real water geometry.
    for (const y of channel?[0,CHEONGGYE_LEVELS.promenade,CHEONGGYE_LEVELS.bed]:[0,-.5]) {
      const a = from.y - below - y, b = to.y - below - y;
      const t = a < -EPS ? 0 : b < a && b <= EPS ? Math.max(0, a / (a - b)) : -1;
      if (t < 0 || t > 1) continue;
      const point = pointAt(from, to, t);
      if (y === 0 && (channel?inChannelExcavation(point.x,point.z):wet(point.x,point.z))) continue;
      if(channel&&y===CHEONGGYE_LEVELS.promenade&&!channelTerraces.some(p=>contains(p,point.x,point.z)))continue;
      if(channel&&y===CHEONGGYE_LEVELS.bed&&!inChannelExcavation(point.x,point.z))continue;
      consider({ fraction: t, normal: UP }, y === 0 ? 'terrain:real-ground' : 'terrain:real-waterbed');
    }
    return best;
  }
  return Object.freeze({ supportAt,
    sweepBody: (a: Vec3, b: Vec3, body: NativeBody) => sweep(a, b, body),
    sweepSphere: (a: Vec3, b: Vec3, radius: number) => sweep(a, b, radius),
    sphereClear: (at: Vec3, radius: number) => { const hit = sweep(at, at, radius); return hit === undefined ? undefined : hit === null; },
    waterAt: (feet: Vec3) => validPosition(feet) ? sampleWater(layout, feet.x, feet.y, feet.z) : undefined,
  });
}
