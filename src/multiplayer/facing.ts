import type { PlayerState } from './state.ts';
/** The native/legacy models face local -Z. Airborne peers follow actual velocity, not steering intent. */
export function remoteFacing(state:PlayerState):{pitch:number;yaw:number;roll:number} {
  if (!state.grounded && state.vx!==undefined && state.vy!==undefined && state.vz!==undefined) {
    const horizontal=Math.hypot(state.vx,state.vz),speed=Math.hypot(horizontal,state.vy);
    if(speed>.08)return {pitch:Math.atan2(state.vy,horizontal),yaw:horizontal>.05?-Math.atan2(state.vx,-state.vz):-state.heading,roll:state.roll};
  }
  return {pitch:state.pitch,yaw:-state.heading,roll:state.roll};
}
