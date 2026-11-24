import type { TrafficState } from './road-traffic.ts';
import type { NativeBody, NativeSupport, NativeSupportProbe, NativeSweepHit, NativeWorldQueries, Vec3 } from './ported/motion/locomotion/b2/contracts.ts';
import type { NativeMotionWorld } from './ported/motion/locomotion/b2/native-motion.ts';
import { nativeFeet } from './ported/motion/locomotion/b2/native-motion.ts';
import { sweepVehicleParts } from './vehicle-collision.ts';

export interface VehicleImpact {
  readonly id: string; readonly time: number; readonly position: Vec3; readonly velocity: Vec3; readonly groundY: number;
}
export interface VehicleSample { seconds: number; states: readonly TrafficState[] }
const EPS = 2e-6;
const ROOF = { height: 1.51, halfWidth: .775, halfDepth: .88, z: -.16 };
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
const turn = (a: number, b: number) => Math.atan2(Math.sin(b-a),Math.cos(b-a));
const local = (p: Vec3, car: TrafficState): Vec3 => {
  const c=Math.cos(car.heading),s=Math.sin(car.heading),x=p.x-car.x,z=p.z-car.z;
  return {x:c*x-s*z,y:p.y-car.y,z:s*x+c*z};
};
const direction = (p: Vec3, car: TrafficState): Vec3 => {
  const c=Math.cos(car.heading),s=Math.sin(car.heading);return{x:c*p.x+s*p.z,y:p.y,z:-s*p.x+c*p.z};
};
const global = (p: Vec3, car: TrafficState): Vec3 => { const v=direction(p,car);return{x:v.x+car.x,y:v.y+car.y,z:v.z+car.z}; };
function roof(car: TrafficState): NativeSupport { return {id:car.id+':roof',layerId:car.id+':roof',height:car.y+ROOF.height,normal:{x:0,y:1,z:0},surface:'metal',walkable:true,landable:true}; }
function onRoof(at: Vec3, radius: number, car: TrafficState): boolean {
  const p=local(at,car);return Math.abs(p.x)+radius<=ROOF.halfWidth+EPS && Math.abs(p.z-ROOF.z)+radius<=ROOF.halfDepth+EPS;
}
function validSupport(value: NativeSupport|null|undefined, probe: NativeSupportProbe): boolean {
  if(value===null)return true;
  if(!value||typeof value.id!=='string'||!value.id||typeof value.layerId!=='string'||!value.layerId||
    typeof value.surface!=='string'||!value.surface||typeof value.landable!=='boolean'||typeof value.walkable!=='boolean'||
    !value.normal||![value.height,value.normal.x,value.normal.y,value.normal.z].every(Number.isFinite)||
    value.normal.y<=0||Math.abs(Math.hypot(value.normal.x,value.normal.y,value.normal.z)-1)>.001)return false;
  return value.height>=Math.min(probe.previousFeetY,probe.at.y)-probe.maxDropM-EPS&&value.height<=probe.previousFeetY+probe.maxRiseM+EPS;
}
function select(a: NativeSweepHit|null|undefined,b: NativeSweepHit|null|undefined) {
  const valid=(hit:NativeSweepHit|null|undefined)=>hit===null||!!hit&&Number.isFinite(hit.fraction)&&hit.fraction>=0&&hit.fraction<=1&&
    !!hit.point&&!!hit.normal&&[hit.point.x,hit.point.y,hit.point.z,hit.normal.x,hit.normal.y,hit.normal.z].every(Number.isFinite)&&
    Math.abs(Math.hypot(hit.normal.x,hit.normal.y,hit.normal.z)-1)<.001&&typeof hit.colliderId==='string'&&!!hit.colliderId&&(hit.layerId===undefined||typeof hit.layerId==='string')&&
    (hit.edgeSlide===undefined||!!hit.edgeSlide&&[hit.edgeSlide.x,hit.edgeSlide.y,hit.edgeSlide.z].every(Number.isFinite)&&Math.abs(hit.edgeSlide.y)<1e-7&&Math.abs(Math.hypot(hit.edgeSlide.x,hit.edgeSlide.y,hit.edgeSlide.z)-1)<.001);
  if(!valid(a)||!valid(b))return undefined;
  return !a ? b : !b || a.fraction<=b.fraction ? a : b;
}
function checked(hit: NativeSweepHit|null|undefined, from:Vec3, to:Vec3) {
  if(hit===null)return null;
  if(select(hit,null)===undefined)return undefined;
  const p=lerp(from,to,hit!.fraction);
  return Math.hypot(p.x-hit!.point.x,p.y-hit!.point.y,p.z-hit!.point.z)<=EPS?hit:undefined;
}
function vehicleSweep(from: Vec3,to: Vec3,body: NativeBody|number,a: TrafficState,b=a): NativeSweepHit|null|undefined {
  const start=local(from,a),end=local(to,b);let best: NativeSweepHit|null=null;
  const contact=sweepVehicleParts(start,end,body);
  if(contact===undefined)return undefined;
  if(contact) {
    const heading=a.heading+turn(a.heading,b.heading)*contact.fraction;
    best={fraction:contact.fraction,point:lerp(from,to,contact.fraction),normal:direction(contact.normal,{...a,heading}),colliderId:a.id,layerId:a.id+':roof'};
  }
  return best;
}

/** Shared body, roof and camera geometry. All mutable preview data is private to one proposal. */
export function createVehicleWorld<T extends NativeWorldQueries>(base: T, readCars: ()=>readonly TrafficState[]) {
  type Stage = { samples: readonly VehicleSample[]; start: number; cursor: number; end: number; cooldown: number; sequence: number; hits: VehicleImpact[]; carried: string|null; carrierVelocity: Vec3|null; released: string|null; releaseStart: number; releaseUntil: number };
  let active: Stage|null=null, cooldown=0,sequence=0,revision=0,released:string|null=null,releaseStart=0,releaseUntil=0;
  function at(time: number): readonly TrafficState[] {
    if(!active)return readCars();
    const samples=active.samples,t=Math.max(0,time-active.start);
    let i=1;while(i<samples.length-1&&samples[i].seconds<t)i++;
    const a=samples[Math.max(0,i-1)],b=samples[Math.min(i,samples.length-1)],f=Math.max(0,Math.min(1,(t-a.seconds)/(b.seconds-a.seconds||1)));
    return a.states.map((car,j)=>{const other=b.states[j];return{...car,...lerp(car,other,f),heading:car.heading+turn(car.heading,other.heading)*f,speed:car.speed+(other.speed-car.speed)*f};});
  }
  const cars = () => at(active?.cursor??0);
  function swept(from:Vec3,to:Vec3,body:NativeBody|number,previous=cars(),next=previous,skip?:string|null) {
    let hit:NativeSweepHit|null|undefined=null;
    for(let i=0;i<previous.length;i++) {
      const car=previous[i];if(car.id===skip)continue;
      if(Math.hypot(from.x-car.x,from.z-car.z)>Math.hypot(to.x-from.x,to.z-from.z)+5+(typeof body==='number'?body:body.horizontalRadiusM)+Math.hypot(next[i].x-car.x,next[i].z-car.z))continue;
      hit=select(hit,vehicleSweep(from,to,body,car,next[i]));if(hit===undefined)return undefined;
    }
    return hit;
  }
  const world: T & NativeMotionWorld = { ...base,
    supportAt(probe) {
      let support=base.supportAt(probe);if(!validSupport(support,probe))return undefined;
      const low=Math.min(probe.previousFeetY,probe.at.y)-probe.maxDropM,high=probe.previousFeetY+probe.maxRiseM;
      for(const car of cars()) {
        if(active&&active.released===car.id&&active.cursor>=active.releaseStart&&active.cursor<active.releaseUntil)continue;
        const value=roof(car);
        if(value.height<low-EPS||value.height>high+EPS||support&&support.height>=value.height||!onRoof(probe.at,probe.footRadiusM,car))continue;
        support=value;
      }
      return support;
    },
    supportAtTime(probe,time) {
      if(!active)return world.supportAt(probe);
      const previous=active.cursor;active.cursor=time;
      try{return world.supportAt(probe);}finally{active.cursor=previous;}
    },
    sweepBody(from,to,body) { return select(checked(base.sweepBody(from,to,body),from,to),swept(from,to,body)); },
    sweepSphere(from,to,radius) { return select(checked(base.sweepSphere(from,to,radius),from,to),swept(from,to,radius)); },
    sweepCameraMotion(from,to,radius) {
      if(!active||base.sphereClear(from,radius)!==true||swept(from,from,radius,at(active.start))!==null)return undefined;
      let hit=checked(base.sweepSphere(from,to,radius),from,to);
      const total=active.samples[active.samples.length-1].seconds;
      for(let i=1;i<active.samples.length;i++) {
        const a=active.samples[i-1],b=active.samples[i],low=a.seconds/total,high=b.seconds/total;
        const moving=swept(lerp(from,to,low),lerp(from,to,high),radius,a.states,b.states);
        if(moving===undefined)return undefined;
        if(moving){const fraction=low+(high-low)*moving.fraction;hit=select(hit,{...moving,fraction,point:lerp(from,to,fraction)});}
      }
      return hit;
    },
    sphereClear(point,radius) {
      const clear=base.sphereClear(point,radius);if(clear!==true)return clear;
      const hit=swept(point,point,radius);return hit===undefined?undefined:hit===null;
    },
    beginSubstep(state,dt) {
      if(!active)return;
      active.carried=null;active.carrierVelocity=null;
      const previous=at(state.time),next=at(state.time+dt);
      active.cursor=state.time+dt;active.end=state.time+dt;
      if(!state.grounded||!state.support)return;
      const index=previous.findIndex(car=>state.support?.id===car.id+':roof');
      if(index<0)return;
      const old=previous[index],car=next[index],feet=nativeFeet(state);
      if(!onRoof(feet,state.body.footSupportRadiusM,old))return;
      const carried=global(local(state,old),car);
      // Never carry through static world geometry or another vehicle.
      const hit=select(base.sweepBody(state,carried,state.body),swept(state,carried,state.body,next,next,car.id));
      if(hit===undefined)throw new Error('unverified-vehicle-carry');
      if(hit) {state.grounded=false;state.support=null;return;}
      active.carrierVelocity={x:(carried.x-state.x)/dt,y:(carried.y-state.y)/dt,z:(carried.z-state.z)/dt};
      state.x=carried.x;state.y=carried.y;state.z=carried.z;// Traffic uses +Z-forward/yaw, while native bird headings use -Z-forward.
      state.heading-=turn(old.heading,car.heading);
      const velocity=direction({x:state.vx,y:0,z:state.vz},{...car,heading:turn(old.heading,car.heading)});
      state.vx=velocity.x;state.vz=velocity.z;state.support=roof(car);active.carried=car.id;
    },
    leaveSupport(state) {
      if(!active||!state.grounded||!state.support)return;
      const cars=at(state.time),index=cars.findIndex(car=>state.support?.id===car.id+':roof');
      if(index<0)return;
      const dt=Math.min(1/240,active.start+active.samples[active.samples.length-1].seconds-state.time);
      if(dt<=0)return;
      const car=cars[index],next=at(state.time+dt)[index],carried=global(local(state,car),next);
      // Actual contact-point velocity includes translation AND cornering. This is
      // inherited momentum, never new Space-only thrust from a stationary floor.
      state.vx+=(carried.x-state.x)/dt;state.vz+=(carried.z-state.z)/dt;
      active.released=car.id;active.releaseStart=state.time;active.releaseUntil=state.time+.15;
    },
    sweepMovingBody(from,to,body,fromTime,toTime) {
      return select(checked(base.sweepBody(from,to,body),from,to),swept(from,to,body,at(fromTime),at(toTime),active?.carried));
    },
    resolveMovingContact(state,hit,time,endTime) {
      if(!active)return{handled:false};
      const car=at(time).find(car=>car.id===hit.colliderId);if(!car)return{handled:false};
      const end=at(endTime).find(other=>other.id===car.id)!;
      const feet=nativeFeet(state);
      if(!(active.released===car.id&&time>=active.releaseStart&&time<active.releaseUntil)&&hit.normal.y>.8&&state.vy<=0&&Math.abs(feet.y-(car.y+ROOF.height))<.002&&onRoof(feet,state.body.footSupportRadiusM,car)) {
        const carried=global(local(state,car),end),solid=base.sweepBody(state,carried,state.body);
        if(solid===undefined)throw new Error('unverified-vehicle-landing');
        if(solid)return{handled:false};
        const impact=Math.max(0,-state.vy);state.x=carried.x;state.z=carried.z;state.y=roof(end).height+state.body.centreToSoleM;
        state.grounded=true;state.vx=0;state.vz=0;state.vy=0;state.support=roof(end);active.carried=car.id;
        return{handled:true,landed:impact};
      }
      const velocity={x:Math.sin(car.heading)*car.speed,y:0,z:Math.cos(car.heading)*car.speed};
      // A lower tyre facet points partly into the floor. A grounded bird cannot
      // accept that downward component: resolve it along the ground plane instead
      // of zeroing vy later and leaving the car to overlap the bird next frame.
      const horizontal=Math.hypot(hit.normal.x,hit.normal.z);
      const n=state.grounded&&hit.normal.y<0&&horizontal>EPS
        ?{x:hit.normal.x/horizontal,y:0,z:hit.normal.z/horizontal}:hit.normal;
      const closing=(velocity.x-state.vx)*n.x-state.vy*n.y+(velocity.z-state.vz)*n.z;
      if(Math.abs(n.y)<.65&&car.speed>=2.5&&closing>=1&&time>=active.cooldown) {
        const dx=n.x+Math.sin(car.heading)*.35,dz=n.z+Math.cos(car.heading)*.35,length=Math.hypot(dx,dz);
        const speed=Math.min(25,14+car.speed*1.5);
        state.vx=dx/length*speed;state.vz=dz/length*speed;state.vy=Math.min(13,7+car.speed*.7);
        state.grounded=false;state.support=null;state.mode='fall';state.knockbackSeconds=2.4;state.flapAge=Math.max(.5,state.flapAge);
        active.cooldown=time+1.25;
        const probe={at:feet,previousFeetY:feet.y,footRadiusM:state.body.footSupportRadiusM,heightM:state.body.heightM,maxRiseM:0,maxDropM:100};
        const ground=base.supportAt(probe);
        if(!validSupport(ground,probe))throw new Error('unverified-vehicle-impact-ground');
        active.hits.push({id:'vehicle-impact:'+ ++active.sequence,time,position:{x:state.x,y:state.y,z:state.z},velocity:{x:state.vx,y:state.vy,z:state.vz},groundY:ground?.height??car.y});
      } else {
        if(closing<=1e-8)return{handled:false};
        // A slow car gently pushes. No launch, feathers or synthetic jump.
        state.vx+=closing*n.x;state.vy+=closing*n.y;state.vz+=closing*n.z;
      }
      state.x+=n.x*EPS;state.y+=n.y*EPS;state.z+=n.z*EPS;
      return{handled:true};
    },
    endSubstep(state,time) {
      if(!active)return;
      // Walking off keeps the platform's world momentum. Without it the moving
      // roof catches the same sole repeatedly and synthesizes dozens of lands.
      if(active.carried&&!state.grounded) {
        const car=at(time).find(car=>car.id===active?.carried);
        if(car&&active.carrierVelocity){state.vx+=active.carrierVelocity.x;state.vz+=active.carrierVelocity.z;active.released=car.id;active.releaseStart=time;active.releaseUntil=time+.15;}
      }
      active.cursor=time;active.carried=null;
    },
  };
  return { world,
    preview<R>(samples:readonly VehicleSample[],start:number,operation:()=>R) {
      if(active)throw new Error('nested-vehicle-preview');
      const before=revision,stage:Stage={samples,start,cursor:start,end:start,cooldown,sequence,hits:[],carried:null,carrierVelocity:null,released,releaseStart,releaseUntil};
      active=stage;let result:R;
      try { result=operation(); } finally { active=null; }
      let used=false;const isCurrent=()=>!used&&revision===before;
      return {result,hits:stage.hits,isCurrent,commit(){if(!isCurrent())throw new Error('Stale vehicle proposal');used=true;revision++;cooldown=stage.cooldown;sequence=stage.sequence;released=stage.released;releaseStart=stage.releaseStart;releaseUntil=stage.releaseUntil;}};
    },
    clear(){revision++;cooldown=0;released=null;releaseStart=0;releaseUntil=0;},
    snapshot(){return{cooldown,sequence};},
  };
}
