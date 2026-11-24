"""Reproducible offline adapter; requires GDAL Python, no network or site changes."""
import json, pathlib, sys, collections
from osgeo import ogr
root=pathlib.Path(__file__).resolve().parents[1]
source=pathlib.Path(sys.argv[1])
runtime=json.loads((source/'derived/runtime-with-reviewed-heights.json').read_text())
estimates=json.loads((source/'derived/height-estimate-proposals.json').read_text())
runtime.pop('deployment_authorized',None)
features=runtime['features']; est={p['id']:p for p in estimates['proposals'] if p.get('estimate_m')}
def geom(f): return ogr.CreateGeometryFromJson(json.dumps(f['geometry']))
def parts(g):
 if g.IsEmpty(): return
 if g.GetGeometryName()=='POLYGON': yield json.loads(g.ExportToJson())['coordinates']
 elif g.GetGeometryName() in ['MULTIPOLYGON','GEOMETRYCOLLECTION']:
  for i in range(g.GetGeometryCount()): yield from parts(g.GetGeometryRef(i))
def rounded(rings): return [[[round(v,3) for v in p] for p in ring] for ring in rings]
def bbox(g):
 a,b,c,d=g.GetEnvelope();return a,b,c,d
part_features=[f for f in features if 'building-parts' in f['categories']]
part_geoms=[(f,geom(f)) for f in part_features]
# A reviewed overall maximum can constrain only the highest existing part, not fill its void.
reviewed_parts={}
for parent in features:
 if not parent['height']['status'].startswith('published_'):continue
 pg=geom(parent);members=[]
 for pf,part in part_geoms:
  if part.GetArea()>0 and pg.Intersects(part):
   intersect=pg.Intersection(part)
   if intersect.GetGeometryName() in ['POLYGON','MULTIPOLYGON'] and intersect.GetArea()/part.GetArea()>.95 and pf['height']['value_m'] is not None:members.append(pf)
 if members:
  top=max(members,key=lambda f:f['height']['value_m'])
  reviewed_parts[top['id']]={'height':parent['height']['value_m'],'parent':parent['id'],'sources':parent['height'].get('source_urls',[])}
counts=collections.Counter(); buildings=[]; suppressed=[]
for f in features:
 if not any(c in f['categories'] for c in ['buildings','building-parts']):continue
 g=geom(f); h=f['height']['value_m']; status=f['height']['status']; miny=f['min_height_m'] or 0
 if h is None and f['id'] in est: h=est[f['id']]['estimate_m'];status='estimated_not_measured'
 # Unconfirmed vertical extent remains only a 12cm footprint marker, never a claimed building height.
 if h is None: h=.12; miny=0;status='unconfirmed_footprint_only'
 if h<=miny: h=miny+.12;status='unconfirmed_footprint_only'
 counts[status]+=1
 if 'building-parts' not in f['categories']:
  matches=[]
  for pf,pg in part_geoms:
   if pf['id']==f['id']:continue
   if not g.Intersects(pg):continue
   intersection=g.Intersection(pg)
   if pg.GetArea()>0 and intersection.GetGeometryName() in ['POLYGON','MULTIPOLYGON'] and intersection.GetArea()/pg.GetArea()>.95:matches.append(pg)
  if matches:
   # Parts describe volumes. Never extrude the full parent outline through their voids.
   for pg in matches:g=g.Difference(pg)
   suppressed.append(f['id'])
   if not g.IsEmpty():h=.12;miny=0;status='unconfirmed_outline_remainder'
 if f['id'] in reviewed_parts:
  h=reviewed_parts[f['id']]['height'];status='published_maximum_applied_to_top_part'
 for i,rings in enumerate(parts(g)):
  buildings.append(dict(id=f['id']+':'+str(i),sourceId=f['id'],rings=rounded(rings),height=h,minY=miny,surface='stone',heightStatus=status,name=f['name'] or '',sourceHeight=f['height']['value_m'],measured=False))
water=[];roads=[]
for f in features:
 g=geom(f)
 if 'water' in f['categories']:
  for i,rings in enumerate(parts(g)):
   water.append(dict(id=f['id']+':'+str(i),sourceId=f['id'],rings=rounded(rings),height=.02,minY=-.5,surface='water',heightStatus='unconfirmed_visual_water_level',sourceHeight=None,measured=False))
 if 'roads' not in f['categories']:continue
 tags=f['tags']; highway=tags.get('highway',''); underground=tags.get('tunnel') not in [None,'no'] or float(tags.get('layer','0'))<0
 walkable=highway in ['footway','pedestrian','path','steps','living_street']
 explicit=tags.get('width','')
 try:width=float(explicit.rstrip(' m'));width_status='osm_tag_unverified'
 except ValueError:
  try:lanes=float(tags.get('lanes',''))
  except ValueError:lanes=0
  width=lanes*3.0 if lanes else (2.5 if walkable else 6 if highway in ['residential','service'] else 9)
  width_status='estimated_not_measured'
 width=max(.5,min(width,50)); polygon=g.GetGeometryName() in ['POLYGON','MULTIPOLYGON']
 lines=[]
 if g.GetGeometryName()=='LINESTRING': lines=[f['geometry']['coordinates']]
 elif g.GetGeometryName()=='MULTILINESTRING': lines=f['geometry']['coordinates']
 if not polygon:g=g.Buffer(width/2,3)
 for i,rings in enumerate(parts(g)):
  road=dict(id=f['id']+':'+str(i),sourceId=f['id'],rings=rounded(rings),width=width,walkable=walkable,surface='stone' if walkable else 'asphalt',bridge=tags.get('bridge') not in [None,'no'],underground=underground,widthStatus='osm_polygon' if polygon else width_status,highway=highway)
  if lines:road['centerline']=lines[min(i,len(lines)-1)]
  roads.append(road)
data=dict(buildings=buildings,water=water,roads=roads,origin=runtime['coordinate_system']['origin_lonlat'],bounds=dict(minX=-574.4,maxX=574.4,minZ=-555.1,maxZ=555.1),sourceDate='2026-11-06T08:16:47Z',license='ODbL-1.0',heightCounts=dict(counts))
(root/'src/native/ported/map/real-map/data.ts').write_text("// Generated by tools/prepare-real-map.py. OSM contributors, ODbL-1.0.\nimport type { RealMapData } from './types.ts';\nexport const realMapData: RealMapData = "+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
export=dict(runtime=runtime,height_estimates=estimates,render_adapter=data,license='https://opendatacommons.org/licenses/odbl/1-0/',attribution='© OpenStreetMap contributors',source='https://www.openstreetmap.org/copyright',suppressed_parent_outlines=suppressed,reviewed_top_parts=reviewed_parts,limitations=['No field-survey-certified heights. Flat terrain and water vertical levels are visual approximations.','Only footprints with published/tagged/estimated heights are extruded; unknowns are 0.12m footprint markers.','Parent outlines covered by building parts are not extruded. Residual uncovered outlines remain footprint markers.','Road centerline buffers are approximate widths, not surveyed curb boundaries. Underground road data is retained but not rendered.'])
(root/'public/data/seoul-osm.json').write_text(json.dumps(export,ensure_ascii=False,separators=(',',':')))
print(json.dumps(dict(polygons=len(buildings),water=len(water),roads=len(roads),height_counts=counts,suppressed_parents=len(suppressed)),ensure_ascii=False,indent=2))
