import type { NativeCameraRequest, NativeCameraResult, CameraPoint } from '../native/ported/motion/controls/b2/native-camera.ts';
import { resolveNativeCamera } from '../native/ported/motion/controls/b2/native-camera.ts';
import { cameraNearRadius } from '../native/ported/motion/controls/camera-resolver.ts';
import type { Vec3 } from '../native/ported/motion/locomotion/b2/contracts.ts';

export type FirstPersonPoseRebindRequest =
  Omit<NativeCameraRequest, 'mode'|'acceptedSeconds'|'previousPosition'|'posedEyeWorld'> & {
    readonly reason: 'appearance-rebind';
    readonly previousPosition: CameraPoint;
    readonly posedEyeWorld: Vec3;
  };
export type PoseRebindResult =
  | { readonly kind:'ready'; readonly operation:'appearance-rebind';
      readonly camera:Extract<NativeCameraResult,{kind:'resolved'}> }
  | { readonly kind:'blocked'; readonly reason:string };
const SKIN_M=.001; // The fixed upstream resolver's clearance skin, not a new lens size.
const worldPoint=([x,y,z]:CameraPoint):Vec3=>({x,y,z});

/** Explicit same-time pose placement, never an ordinary zero-second camera tick. */
export function resolveFirstPersonPoseRebind(request: FirstPersonPoseRebindRequest): PoseRebindResult {
  try{
    if(!request||request.reason!=='appearance-rebind')return{kind:'blocked',reason:'invalid-rebind-intent'};
    const {previousPosition,posedEyeWorld,reason:operation,...base}=request;
    if(!Array.isArray(previousPosition)||previousPosition.length!==3||!previousPosition.every(Number.isFinite)||
      !posedEyeWorld||![posedEyeWorld.x,posedEyeWorld.y,posedEyeWorld.z].every(Number.isFinite))return{kind:'blocked',reason:'invalid-rebind-position'};
    const radius=cameraNearRadius(base.projection)+SKIN_M;
    if(!Number.isFinite(radius)||radius<=SKIN_M)return{kind:'blocked',reason:'invalid-rebind-lens'};
    // This no-previous solve computes ONLY the new placement. It is not adopted
    // until the required real previous endpoint and full chord pass below.
    const placement=resolveNativeCamera({...base,mode:'first',acceptedSeconds:0,posedEyeWorld});
    if(placement.kind==='blocked')return{kind:'blocked',reason:'rebind-placement:'+placement.reason};
    if(!placement.position.every(Number.isFinite)||Math.hypot(placement.position[0]-posedEyeWorld.x,
      placement.position[1]-posedEyeWorld.y,placement.position[2]-posedEyeWorld.z)>1e-6)return{kind:'blocked',reason:'rebind-eye-not-reached'};
    const start=base.world.sphereClear(worldPoint(previousPosition),radius);
    if(start!==true)return{kind:'blocked',reason:start===false?'rebind-start-overlap':'unverified-rebind-start'};
    const end=base.world.sphereClear(posedEyeWorld,radius);
    if(end!==true)return{kind:'blocked',reason:end===false?'rebind-eye-overlap':'unverified-rebind-eye'};
    const path=base.world.sweepSphere(worldPoint(previousPosition),posedEyeWorld,radius);
    if(path!==null)return{kind:'blocked',reason:path===undefined?'unverified-rebind-path':'rebind-path-not-clear'};
    // Preserve cut:true from the placement solve and identify the explicit
    // operation. It must never masquerade as a continuous ordinary zero-dt tick.
    return{kind:'ready',operation,camera:placement};
  }catch{return{kind:'blocked',reason:'rebind-query-exception'};}
}
