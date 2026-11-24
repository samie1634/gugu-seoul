import { validNameSeed } from './names.ts';
import type { LookId } from '../progress.ts';
import type { Appearance } from '../native/ported/shared-contracts.ts';
import { normalizeAppearance } from '../species-core/appearance.ts';
export interface PlayerState {
  x: number; y: number; z: number; heading: number; pitch: number; roll: number;
  mode: 'rest' | 'walk' | 'flap' | 'glide' | 'fall'; grounded: boolean; look: LookId;
  time: number; steps: number; flapAge: number; peckAge: number; cooAge: number;
  world?: 'native-osm' | 'native-procedural' | 'legacy'; appearance?: Appearance;
  nameSeed?: string; vx?: number; vy?: number; vz?: number;
}
export interface StateMessage { v: 1; type: 'state'; sequence: number; state: PlayerState }
export interface Peer { id: string; sequence: number; updatedAt: number; state: PlayerState }
export interface Snapshot { v: 1; type: 'snapshot'; selfId: string; serverTime: number; peers: Peer[]; staleAfterMs?: number }
const DEFAULT_PEER_AGE_MS=5000,MAX_PEER_AGE_MS=20000;
export function validState(value: unknown): value is PlayerState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as PlayerState;
  if (!['x','y','z','heading','pitch','roll','time','steps','flapAge','peckAge','cooAge'].every(k => typeof s[k as keyof PlayerState] === 'number' && Number.isFinite(s[k as keyof PlayerState]) && Math.abs(s[k as keyof PlayerState] as number) <= 1e9)) return false;
  if (!['rest','walk','flap','glide','fall'].includes(s.mode) || !['pigeon','white','owl'].includes(s.look) || typeof s.grounded !== 'boolean') return false;
  if (s.world !== undefined && !['native-osm','native-procedural','legacy'].includes(s.world)) return false;
  if (Math.abs(s.x)>10000 || Math.abs(s.z)>10000 || s.y < -500 || s.y>5000 ||
    [s.time,s.steps,s.flapAge,s.peckAge,s.cooAge].some(n=>n<0)) return false;
  try { if (s.appearance !== undefined) normalizeAppearance(s.appearance); } catch { return false; }
  if (s.nameSeed !== undefined && !validNameSeed(s.nameSeed)) return false;
  if ([s.vx,s.vy,s.vz].some(n=>n!==undefined) && ![s.vx,s.vy,s.vz].every(n=>typeof n==='number' && Number.isFinite(n) && Math.abs(n)<=2000)) return false;
  return true;
}
interface Track { previous: PlayerState; current: PlayerState; sequence: number; received: number; interval: number; updatedAt:number; expiresAt:number }
/** Arrival-clock interpolation avoids trusting another browser's wall clock. */
export class PeerBuffer {
  private tracks = new Map<string, Track>();
  // Keep the sequence floor after expiry/departure so a delayed duplicate cannot
  // recreate an expired bird. Prune only once server time makes it unreturnable.
  private sequenceFloors = new Map<string,{sequence:number;updatedAt:number}>();
  private serverTime = -Infinity;
  accept(value: unknown, now: number): boolean {
    const snapshot = value as Snapshot;
    if (!snapshot || snapshot.v !== 1 || snapshot.type !== 'snapshot' || typeof snapshot.selfId !== 'string' || !Number.isFinite(snapshot.serverTime) || !Array.isArray(snapshot.peers) || snapshot.peers.length > 24 || snapshot.serverTime < this.serverTime) return false;
    const windowMs=snapshot.staleAfterMs===undefined?DEFAULT_PEER_AGE_MS:snapshot.staleAfterMs;
    if(!Number.isInteger(windowMs)||windowMs<DEFAULT_PEER_AGE_MS||windowMs>MAX_PEER_AGE_MS)return false;
    this.serverTime = snapshot.serverTime;
    for(const [id,floor] of this.sequenceFloors)if(snapshot.serverTime-floor.updatedAt>MAX_PEER_AGE_MS)this.sequenceFloors.delete(id);
    const present = new Set<string>();
    for (const p of snapshot.peers) {
      if (!p || typeof p.id !== 'string' || !p.id.length || p.id.length > 128 || p.id === snapshot.selfId || !Number.isSafeInteger(p.sequence) || p.sequence < 0 || !Number.isFinite(p.updatedAt) || p.updatedAt > snapshot.serverTime || snapshot.serverTime - p.updatedAt > windowMs || !validState(p.state)) continue;
      present.add(p.id);
      const old = this.tracks.get(p.id);
      const expiresAt=now+windowMs-(snapshot.serverTime-p.updatedAt),floor=this.sequenceFloors.get(p.id);
      if(floor&&p.sequence<=floor.sequence){
        if(old&&p.sequence===old.sequence)old.expiresAt=Math.min(old.expiresAt,expiresAt);
        continue;
      }
      const teleport = old && (Math.hypot(p.state.x-old.current.x,p.state.y-old.current.y,p.state.z-old.current.z)>20 || p.state.time < old.current.time);
      const current={...p.state};
      if(current.vx===undefined && old && !teleport && !current.grounded && p.updatedAt>old.updatedAt){
        const seconds=(p.updatedAt-old.updatedAt)/1000;
        current.vx=(current.x-old.current.x)/seconds;current.vy=(current.y-old.current.y)/seconds;current.vz=(current.z-old.current.z)/seconds;
      }
      this.tracks.set(p.id, {previous: old && !teleport ? this.sampleTrack(old, now) : {...p.state}, current, sequence:p.sequence, received:now, updatedAt:p.updatedAt, expiresAt, interval:old ? Math.min(300,Math.max(50,now-old.received)) : 100});
      this.sequenceFloors.set(p.id,{sequence:p.sequence,updatedAt:p.updatedAt});
    }
    for (const id of this.tracks.keys()) if (!present.has(id)) this.tracks.delete(id);
    return true;
  }
  private sampleTrack(t: Track, now: number): PlayerState {
    const a = Math.min(1,Math.max(0,(now-t.received)/t.interval));
    const state = {...t.current};
    for (const key of ['x','y','z','pitch','roll','steps'] as const) state[key] = t.previous[key]+(t.current[key]-t.previous[key])*a;
    for (const key of ['vx','vy','vz'] as const) { const before=t.previous[key],after=t.current[key]; if(before!==undefined && after!==undefined)state[key]=before+(after-before)*a; }
    const elapsed = Math.min(250,Math.max(0,now-t.received))/1000;
    for (const key of ['time','flapAge','peckAge','cooAge'] as const) state[key] += elapsed;
    const turn = Math.atan2(Math.sin(t.current.heading-t.previous.heading),Math.cos(t.current.heading-t.previous.heading));
    state.heading = t.previous.heading + turn*a;
    return state;
  }
  sample(now: number): Map<string, PlayerState> {
    const result = new Map<string,PlayerState>();
    for (const [id,t] of this.tracks) {
      if (now>t.expiresAt) this.tracks.delete(id);
      else result.set(id,this.sampleTrack(t,now));
    }
    return result;
  }
  clear(): void { this.tracks.clear(); this.sequenceFloors.clear(); this.serverTime=-Infinity; }
}
