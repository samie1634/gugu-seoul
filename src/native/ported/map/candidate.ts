import * as THREE from 'three';
import { Painter } from '../../../geometry.ts';
import type { LandingSurface, MapActor, MapLayout, MapOptions, MapSurfaceEvent, RoofSpec } from './contracts.ts';
import { BRIDGES, LANDMARK_ANCHORS, RIVER_ENTRIES, ROOF_RENDER_SEGMENTS, makeMapLayout, roofHeight, sampleGround, sampleWater, surfaceAt } from './layout.ts';
import { createMapMaterials, type MaterialKey } from './materials.ts';
import { createRiverWater } from './water.ts';
import { createPropInteractions, type PropActorGeometry } from './interactions/prop-interactions.ts';

export interface MapStats { meshes: number; triangles: number; colliders: number; landingSurfaces: number; reflectionSize: number; extraReflectionPasses: number }
export interface MapCandidate {
  root: THREE.Group;
  obstacles: MapLayout['colliders'];
  layout: MapLayout;
  landingSurfaces: LandingSurface[];
  stats: MapStats;
  update(time: number, delta: number): void;
  observeActor(actor: MapActor, time: number, geometry?: PropActorGeometry): MapSurfaceEvent[];
  forgetActor(id: string): void;
  dispose(): void;
}

/** Standalone STATIC-map replacement candidate. Does not attach itself to a scene. */
export function createMapCandidate(options: MapOptions = {}): MapCandidate {
  const layout = makeMapLayout(options);
  const reference=layout.proportions==='reference-scale';
  const sessionId=options.eventSessionId ?? globalThis.crypto.randomUUID();
  let sequence=0;
  const root = new THREE.Group(); root.name = 'Gugu Seoul map candidate';
  const materials = createMapMaterials(layout);
  const painters = new Map<MaterialKey, Painter>();
  const used = new Set<MaterialKey>();
  const p = (key: MaterialKey) => { used.add(key); let painter = painters.get(key); if (!painter) { painter = new Painter(); painters.set(key, painter); } return painter; };
  const box = (key: MaterialKey, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation) => p(key).box(x,y,z,w,h,d,color);
  const plane = (key: MaterialKey, x: number, y: number, z: number, w: number, h: number, angle: number, color: THREE.ColorRepresentation) => p(key).add(new THREE.PlaneGeometry(w,h),color,new THREE.Vector3(x,y,z),undefined,new THREE.Euler(0,angle,0));

  // Split the terrain: a negative-height river is not hidden by a giant ground box.
  box('paving', -737, -1.5, 0, 1526, 3, 3000, '#b9beb0'); // Right edge X=26.
  box('paving', 1075, -1.5, 0, 850, 3, 3000, '#b9beb0'); // Left edge X=650.
  box('paving', 338, -1.5, -559, 624, 3, 1882, '#b9beb0'); // Ends at Z=382.
  let rampCutStart = 26;
  for (const rampCutEnd of [...RIVER_ENTRIES.map(x=>x-2.8),650]) {
    box('paving',(rampCutStart+rampCutEnd)/2,-1.5,388.5,rampCutEnd-rampCutStart,3,13,'#b9beb0');
    rampCutStart=rampCutEnd+5.6;
  }
  box('paving', 338, -1.5, 972.5, 624, 3, 1055, '#b9beb0'); // Starts at Z=445.
  // Roads, stone paving and markings are painted into these non-overlapping terrain faces.

  for (const b of layout.buildings) {
    const base = b.palette === 'limestone' ? '#c9c2af' : b.palette === 'brick' ? '#8e776a' : '#b4b9b5';
    const material: MaterialKey = b.palette === 'brick' ? 'masonry' : 'concrete';
    box(material,b.x,b.height/2,b.z,b.width,b.height,b.depth,base);
    box('masonry',b.x,b.height+0.225,b.z,b.width+0.5,0.45,b.depth+0.5,'#c6c6bc');
    box('metal',b.x+b.width*0.16,b.height+1.725,b.z-b.depth*0.12,b.width*0.25,2.55,b.depth*0.24,'#848e8a');
    // Opaque, original glass panes; no photographic windows or advertising.
    const levels = Math.floor((b.height - 2.5) / 3.7);
    for (let floor = 0; floor < levels; floor += 1) {
      const y = 3.8 + floor*3.7; const paneH = b.facade === 'curtain' ? 2.9 : 2.25;
      for (let side = 0; side < 4; side += 1) {
        const span = side < 2 ? b.width : b.depth;
        const panes = Math.max(1,Math.floor((span - 3)/5.8)); const pitch = (span - 3)/panes;
        for (let i = 0; i < panes; i += 1) {
          const offset = -span/2+1.5+(i+0.5)*pitch;
          const tint = (i+floor+side)%7 === 0 ? '#667d7e' : (i+floor)%4 ? '#718586' : '#879798';
          const x = side < 2 ? b.x+offset : b.x+(side===2?1:-1)*(b.width/2+0.035);
          const z = side < 2 ? b.z+(side===0?1:-1)*(b.depth/2+0.035) : b.z+offset;
          const angle = [0,Math.PI,Math.PI/2,-Math.PI/2][side];
          plane('glass',x,y,z,pitch*(b.facade==='curtain'?0.93:0.62),paneH,angle,tint);
        }
      }
      if (b.facade === 'curtain') {
        box('metal',b.x,y-1.55,b.z+b.depth/2+0.075,b.width,0.12,0.15,'#abb6b4');
        box('metal',b.x,y-1.55,b.z-b.depth/2-0.075,b.width,0.12,0.15,'#abb6b4');
      }
    }
    if (b.id === 'sejong-center') {
      for (let z = b.z-b.depth/2+6; z < b.z+b.depth/2; z+=9) box('masonry',b.x+b.width/2+1.8,12.5,z,3.6,25,2.2,'#d4cbb8');
      box('masonry',b.x,27.9,b.z,126,1.4,147,'#dad1bb');
    }
    if (b.id.startsWith('jongno-shop:')) {
      box('wood',b.x,3.4,b.z-16.16,b.width-2,0.2,0.28,'#655447');
      box('metal',b.x,6.3,b.z-16.6,b.width-1,0.18,1.4,'#72766b');
    }
  }
  // Elevated top floor and supporting columns leave the silhouette's void open.
  box('metal',514,100,112,84,14,78,'#a2afac');
  for (const x of [489,539]) p('metal').cylinder(x,80,112,2.4,26,'#8f9e9c',12);

  const gx = LANDMARK_ANCHORS.gwanghwamun.x; const gz = LANDMARK_ANCHORS.gwanghwamun.z;
  const shape = new THREE.Shape(); shape.moveTo(-38,0); shape.lineTo(38,0); shape.lineTo(38,11.5); shape.lineTo(-38,11.5); shape.closePath();
  for (const cx of [-22,0,22]) {
    const rx=reference && cx===0?6:4.8;const ry=reference?cx===0?5:4.4:4.8;const jamb=reference?cx===0?4.5:4.2:6.25;
    const h = new THREE.Path();h.moveTo(cx-rx,0);h.lineTo(cx-rx,jamb);h.absellipse(cx,jamb,rx,ry,Math.PI,0,true);h.lineTo(cx+rx,0);h.closePath();shape.holes.push(h);
  }
  p('masonry').add(new THREE.ExtrudeGeometry(shape,{depth:15,bevelEnabled:false,curveSegments:12}),'#d2cec2',new THREE.Vector3(gx,0,gz-(reference?7.5*14.7/19:7.5)),new THREE.Vector3(reference?35/76:1,reference?7/12.5:1,reference?14.7/19:1));
  for (const collider of layout.colliders) {
    if (collider.id === 'gate:stone-deck') {
      box('masonry',collider.x,(collider.height+(collider.minY??0))/2,collider.z,collider.width,collider.height-(collider.minY??0),collider.depth,'#c8c5b9');
    }
    if(collider.id.startsWith('palace:wall:')) {
      box('masonry',collider.x,(collider.height-0.2)/2,collider.z,collider.width,collider.height-0.2,collider.depth,'#c8c5b9');
      box('roof',collider.x,collider.height-0.1,collider.z,collider.width,0.2,collider.depth+0.8,'#555f5b');
    }
    if (collider.id.startsWith('gate:column:') || collider.id.startsWith('bosingak:column:')) p('wood').cylinder(collider.x,((collider.minY??0)+collider.height)/2,collider.z,collider.width/2,collider.height-(collider.minY??0),'#915443',10);
    if (collider.id.endsWith('pavilion')) {
      box('wood',collider.x,((collider.minY??0)+collider.height)/2,collider.z,collider.width,collider.height-(collider.minY??0),collider.depth,'#48624e');
      for (let x=collider.x-collider.width/2+2;x<collider.x+collider.width/2;x+=3) box('wood',x,collider.height-1.2,collider.z+collider.depth/2+0.02,0.4,1.8,0.16,'#a47459');
    }
  }
  for (const roof of layout.roofs) makeRoof(roof,p('roof'),p('wood'));
  const bell=layout.colliders.find(c=>c.id==='bosingak:bell')!;
  const bellHeight=bell.height-(bell.minY??0);const bellRadius=bell.width/2;
  const bellProfile=[[1,0],[1,0.05],[0.91,0.12],[0.87,0.7],[0.75,0.94],[0.2,1]].map(([r,y])=>new THREE.Vector2(r*bellRadius,y*bellHeight));
  p('metal').add(new THREE.LatheGeometry(bellProfile,24),'#82734e',new THREE.Vector3(bell.x,bell.minY??0,bell.z));
  // Hand-built sculptural studies, sized to official total/pedestal heights; fine relief remains pending.
  makeMonuments(p);

  for (const prop of layout.props) {
    const {x,y,z} = prop;
    if (prop.kind==='bench') {
      for (let i=0;i<4;i+=1) box('wood',x,y+0.42,z-0.33+i*0.22,2.8,0.16,0.18,'#8b7050');
      box('wood',x,y+0.75,z+0.39,2.8,0.5,0.12,'#92795b');
      for (const side of [-1,1]) box('metal',x+side*1.0,y+0.17,z,0.12,0.34,0.65,'#626d65');
    } else if (prop.kind==='planter') {
      box('masonry',x,y+0.225,z,9,0.45,12,'#aaa99b');
      box('concrete',x,y+0.455,z,8.5,0.03,11.5,'#6e745b');
      tree(p('wood'),p('foliage'),x,z,1);
    } else if (prop.kind==='bollard') {
      p('metal').cylinder(x,y+0.43,z,0.2,0.86,'#67726d',10);
      p('metal').cylinder(x,y+0.77,z,0.205,0.07,'#bbb7a4',10);
    } else {
      p('metal').cylinder(x,y+4.25,z,0.17,8.5,'#636e6b',10);
      box('metal',x+1.4,y+8.4,z,2.8,0.16,0.22,'#636e6b');
      box('glass',x+2.35,y+8.35,z,1.2,0.12,0.58,'#c1bba1');
    }
  }
  for(let z=-340;z<380;z+=48) tree(p('wood'),p('foliage'),77,z,0.78);
  for(let i=0;i<5;i+=1) tree(p('wood'),p('foliage'),480+i*19,337,0.68);
  buildRiver(layout,box,p);

  for (const key of used) {
    const mesh = new THREE.Mesh(p(key).geometry(),materials[key]); mesh.name=`map:${key}`;
    mesh.castShadow=key!=='glass' && key!=='foliage' && key!=='paving'; mesh.receiveShadow=true;
    root.add(mesh);
  }
  const water = createRiverWater(layout.water,layout.quality); root.add(water.root);
  root.updateMatrixWorld(true);
  let triangles=0; root.traverse(object=>{if(object instanceof THREE.Mesh) triangles+=(object.geometry.index?.count ?? object.geometry.getAttribute('position').count)/3;});
  const stats: MapStats={meshes:used.size+1,triangles,colliders:layout.colliders.length,landingSurfaces:layout.landingSurfaces.length,reflectionSize:layout.quality==='desktop'?512:0,extraReflectionPasses:layout.quality==='desktop'?1:0};
  const propInteractions=createPropInteractions(layout.props,layout.landingSurfaces,layout.colliders);
  const propTargetIds=new Set(layout.props.flatMap(prop=>prop.kind==='bench'?[`${prop.id}:seat`,`${prop.id}:back`]:[prop.id]));
  const actors=new Map<string,{water:boolean;target:string;time:number}>();
  let disposed=false;
  return {
    root,obstacles:layout.colliders,layout,landingSurfaces:layout.landingSurfaces,stats,
    update(time,delta){if(!disposed && Number.isFinite(delta) && delta>0) water.update(time);},
    observeActor(actor,time,geometry){
      if(disposed || ![actor.x,actor.y,actor.z,actor.radius,time].every(Number.isFinite) || actor.radius<0 || time<0 || !actor.id) return [];
      if([actor.footRadius,actor.centreToSole,actor.horizontalRadius].some(v=>v!==undefined&&(!Number.isFinite(v)||v<0)))return [];
      const rawPrevious=actors.get(actor.id);
      const previous=rawPrevious && time-rawPrevious.time<=60?rawPrevious:undefined;
      if(previous && time<=previous.time)return [];
      const centreToSole=geometry?.centreToSoleM??actor.centreToSole??actor.radius;
      const feet=actor.y-centreToSole;
      const wet=sampleWater(layout,actor.x,feet,actor.z);
      const events:MapSurfaceEvent[]=[];
      const emit=(type:MapSurfaceEvent['type'],targetId:string,surface:MapSurfaceEvent['surface'],strength:number,y=feet)=>events.push({type,producer:'map',sessionId,sequence:++sequence,eventId:`${sessionId}:map:${sequence}`,actorId:actor.id,targetId,x:actor.x,y,z:actor.z,surface,strength,time});
      if(wet && !previous?.water){emit('water-enter',wet.id,'water',0.6,wet.y);water.addRipple(actor.x,actor.z,time,0.7);}
      if(!wet && previous?.water) emit('water-exit','cheonggyecheon','water',0.35,layout.water.y);
      const landing=actor.grounded?surfaceAt(layout,actor,centreToSole,geometry?.footSupportRadiusM??actor.footRadius??actor.horizontalRadius??actor.radius):null;
      const ground=sampleGround(layout,actor.x,actor.z,{feetY:feet,height:geometry?.heightM??actor.radius*2});
      const onGround=actor.grounded && Math.abs(feet-ground.y)<=0.01;
      const target=wet?wet.id:landing?.id??(onGround?`ground:${ground.zone}`:'');
      const surface=wet?'water':landing?.surface??ground.surface;
      if(target && actor.grounded && target!==previous?.target && !propTargetIds.has(target))emit('surface-contact',target,surface,0.3);
      for(const contact of propInteractions.observeActor(wet?{...actor,grounded:false}:actor,time,geometry)){
        const seq=++sequence;events.push({...contact,producer:'map',sessionId,sequence:seq,eventId:`${sessionId}:map:${seq}`});
      }
      // Step and land audio belong solely to motion. These are metadata/water transitions only.
      if(previous)actors.delete(actor.id);
      for(const [id,entry]of actors){if(time-entry.time>60)actors.delete(id);}
      while(actors.size>=256){const oldest=actors.keys().next().value;if(oldest===undefined)break;actors.delete(oldest);}
      actors.set(actor.id,{water:!!wet,target,time});
      return events;
    },
    forgetActor(id){actors.delete(id);propInteractions.forgetActor(id);},
    dispose(){if(disposed)return;disposed=true;actors.clear();propInteractions.dispose();root.removeFromParent();water.dispose();for(const child of root.children){if(child instanceof THREE.Mesh)child.geometry.dispose();}for(const material of Object.values(materials))material.dispose();root.clear();},
  };
}

function tree(wood:Painter,foliage:Painter,x:number,z:number,scale:number):void{
  wood.cylinder(x,3.4*scale,z,0.34*scale,6.8*scale,'#756b5a',9);
  foliage.ellipsoid(x,8.1*scale,z,3.8*scale,4.1*scale,3.4*scale,'#7c8d63',10);
  foliage.ellipsoid(x+1.5*scale,7.2*scale,z+1.1*scale,2.8*scale,2.9*scale,2.5*scale,'#8f9a6e',9);
}
function makeRoof(roof:RoofSpec,roofPainter:Painter,wood:Painter):void{
  const vertices:number[]=[]; const cols=ROOF_RENDER_SEGMENTS; const rows=ROOF_RENDER_SEGMENTS;
  const point=(u:number,v:number)=>[roof.x+u*roof.width/2,roofHeight(roof,u,v),roof.z+v*roof.depth/2];
  for(let j=0;j<rows;j+=1)for(let i=0;i<cols;i+=1){const u=i/cols*2-1;const v=j/rows*2-1;const du=2/cols;const dv=2/rows;const a=point(u,v);const b=point(u+du,v);const c=point(u,v+dv);const d=point(u+du,v+dv);vertices.push(...a,...c,...b,...b,...c,...d);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();roofPainter.add(g,'#4a5553',new THREE.Vector3());
  roofPainter.box(roof.x,roof.y+roof.rise+0.16,roof.z,roof.width*0.58,0.32,0.7,'#68716b');
  for(const side of[-1,1]){
    wood.box(roof.x,roof.y+0.14,roof.z+side*roof.depth/2,roof.width,0.28,0.38,'#745744');
    wood.box(roof.x,roof.y-0.15,roof.z+side*(roof.depth/2-1.2),roof.width*0.95,0.32,0.4,'#526b54');
    for(let x=roof.x-roof.width*0.43;x<roof.x+roof.width*0.44;x+=2.5)wood.box(x,roof.y-0.45,roof.z+side*(roof.depth/2-2.0),0.8,0.55,1.8,'#745c43');
  }
}

type BoxFn=(key:MaterialKey,x:number,y:number,z:number,w:number,h:number,d:number,color:THREE.ColorRepresentation)=>void;
function buildRiver(layout:MapLayout,box:BoxFn,p:(key:MaterialKey)=>Painter):void{
  const w=layout.water;const centre=(w.minX+w.maxX)/2;const length=w.maxX-w.minX;
  box('masonry',centre,w.bedY-0.12,420,length,0.24,50,'#777e6b');
  for(const side of[-1,1]){
    box('masonry',centre,layout.promenadeY-0.13,420+side*17.0,length,0.26,16,'#b4b2a4');
    box('masonry',centre,(layout.promenadeY+w.bedY)/2,420+side*9.2,length,layout.promenadeY-w.bedY,0.4,'#8f9786');
    // Wet line is below the promenade; geometry is original and consistent with the water surface.
    box('masonry',centre,w.y-0.035,420+side*9.0,length,0.12,0.22,'#687d68');
  }
  for(const collider of layout.colliders.filter(c=>c.id.startsWith('river:wall:'))){
    box('masonry',collider.x,(collider.height+(collider.minY??0))/2,collider.z,collider.width,collider.height-(collider.minY??0),collider.depth,'#aaa99c');
    box('masonry',collider.x,collider.height-0.06,collider.z,collider.width,0.12,1.3,'#c2bfb0');
  }
  for(const ex of RIVER_ENTRIES){
    const y0=0;const y1=layout.promenadeY;const z0=382;const z1=405;
    const vertices=[ex-2.8,y0,z0,ex-2.8,y1,z1,ex+2.8,y0,z0,ex+2.8,y0,z0,ex-2.8,y1,z1,ex+2.8,y1,z1];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();p('masonry').add(g,'#bcb9ab',new THREE.Vector3());
  }
  for(const bx of BRIDGES){
    box('masonry',bx,-0.24,420,12,0.48,50,'#b9b7ab');
    for(const rail of layout.colliders.filter(c=>c.id.startsWith(`bridge:${bx}:rail:`))){
      box('metal',rail.x,1.03,rail.z,0.28,0.18,rail.depth,'#7b8580');
      for(let z=rail.z-rail.depth/2+0.6;z<rail.z+rail.depth/2;z+=3.2)p('metal').cylinder(rail.x,0.52,z,0.065,1.04,'#7b8580',6);
    }
  }
  for(let x=40;x<645;x+=33)for(const side of[-1,1]){
    // Deterministic, hand-generated bank stones; never loose interactive projectiles.
    p('masonry').ellipsoid(x,w.bedY+0.18,420+side*8.3,0.8,0.45,0.55,'#89917c',7);
  }
}


function makeMonuments(p:(key:MaterialKey)=>Painter):void{
  const stone=p('masonry');const bronze=p('metal');const gold='#a78d50';const dark='#4d5f56';
  stone.box(-45,2.1,-172,10,4.2,10,'#b9b4a3');
  for(let y=0.35;y<4.1;y+=0.55)stone.box(-45,y,-166.99,9.8,0.018,0.025,'#9c9a8b');
  // Seated anatomy and layered robe, with adult head/body proportions and a south-facing book.
  const robe=[new THREE.Vector2(1.9,0),new THREE.Vector2(2.0,0.35),new THREE.Vector2(1.7,1.1),new THREE.Vector2(1.1,2.0),new THREE.Vector2(0.95,3.7),new THREE.Vector2(1.18,4.1)];
  bronze.add(new THREE.LatheGeometry(robe,32),gold,new THREE.Vector3(-45,4.2,-172.1),new THREE.Vector3(1,1,0.7));
  bronze.ellipsoid(-45,7.5,-172.2,1.25,1.35,0.7,gold,18);
  bronze.cylinder(-45,8.75,-172.0,0.32,0.55,gold,16);
  bronze.ellipsoid(-45,9.38,-171.97,0.52,0.63,0.45,gold,20);
  bronze.ellipsoid(-45,9.26,-171.52,0.16,0.18,0.16,'#9c8347',12);
  bronze.ellipsoid(-45,8.86,-171.63,0.38,0.52,0.19,'#957e47',16);
  for(const side of[-1,1]){
    bronze.ellipsoid(-45+side*0.53,9.32,-172.0,0.1,0.18,0.12,gold,10);
    limb(bronze,[-45+side*1.0,8.0,-172.1],[-45+side*1.55,7.35,-170.8],0.38,0.29,gold);
    limb(bronze,[-45+side*1.55,7.35,-170.8],[-45+side*1.85,7.8+(side<0?0.2:0),-170.25],0.27,0.18,gold);
    bronze.ellipsoid(-45+side*1.85,7.8+(side<0?0.2:0),-170.2,0.3,0.2,0.14,gold,12);
    bronze.ellipsoid(-45+side*0.8,4.4,-170.3,0.42,0.23,0.65,gold,14);
  }
  bronze.box(-43.35,7.92,-170.0,0.82,0.1,0.6,'#b19a63');
  bronze.box(-45,10.24,-172.0,1.4,0.32,0.9,gold);
  for(const side of[-1,1])bronze.box(-45+side*1.08,10.13,-172.05,0.8,0.16,0.3,gold);
  // Yi Sun-sin: 10.5m granite pedestal plus a 6.5m bronze figure.
  stone.box(-45,5.25,117,5.6,10.5,5.6,'#aaa99e');
  stone.box(-45,0.22,117,7.5,0.44,7.5,'#b7b4a7');
  for(const side of[-1,1]){
    bronze.ellipsoid(-45+side*0.6,10.85,117.35,0.36,0.35,0.6,dark,14);
    limb(bronze,[-45+side*0.6,11.1,117.1],[-45+side*0.57,13.25,117],0.3,0.4,dark);
    limb(bronze,[-45+side*0.95,14.85,117],[-45+side*1.22,13.75,117.22],0.3,0.25,dark);
    limb(bronze,[-45+side*1.22,13.75,117.22],[-45+side*1.0,13.05,117.5],0.22,0.16,dark);
    bronze.ellipsoid(-45+side*1.0,13.05,117.5,0.19,0.24,0.17,dark,12);
  }
  const armour=[new THREE.Vector2(1.03,0),new THREE.Vector2(0.95,0.7),new THREE.Vector2(0.85,2.2),new THREE.Vector2(1.12,2.65),new THREE.Vector2(0.4,2.9)];
  bronze.add(new THREE.LatheGeometry(armour,28),dark,new THREE.Vector3(-45,12.4,117),new THREE.Vector3(1,1,0.65));
  for(let y=12.5;y<14.7;y+=0.25)bronze.box(-45,y,117.65,1.5,0.035,0.035,'#627369');
  bronze.cylinder(-45,15.58,117,0.24,0.3,dark,12);
  bronze.ellipsoid(-45,16.17,117.03,0.43,0.51,0.38,dark,18);
  bronze.ellipsoid(-45,16.08,117.4,0.12,0.14,0.13,dark,10);
  bronze.box(-45,16.85,117,1.35,0.3,1.05,dark);
  bronze.box(-43.58,12.25,117.4,0.11,3.1,0.16,'#586a60');
}
function limb(painter:Painter,a:[number,number,number],b:[number,number,number],bottom:number,top:number,color:THREE.ColorRepresentation):void{
  const va=new THREE.Vector3(...a);const vb=new THREE.Vector3(...b);const axis=vb.clone().sub(va);const length=axis.length();
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize());
  painter.add(new THREE.CylinderGeometry(top,bottom,length,12),color,va.add(vb).multiplyScalar(0.5),undefined,new THREE.Euler().setFromQuaternion(q));
}
