import * as THREE from 'three';
import type { FlightInput } from '../simulation.ts';
import type { NpcState } from './ported/npcs/src/contracts.ts';
import { createNpcModelLayer } from './ported/npcs/models/index.ts';
import { nativeFeet, type NativeMotionState } from './ported/motion/locomotion/b2/native-motion.ts';
import { owlMovementScale } from './owl-night.ts';

type Phase = 'idle' | 'aim' | 'dive' | 'rise';
interface HuntState { phase: Phase; target: NpcState | null; returnY: number; age: number; stalled: number }
const idle = (): HuntState => ({ phase: 'idle', target: null, returnY: 0, age: 0, stalled: 0 });
const distance = (a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function nearestGroundRat(at: {x:number;y:number;z:number}, animals: readonly NpcState[]): NpcState | null {
  let nearest: NpcState | null = null, best = Infinity;
  for (const animal of animals) {
    if (animal.kind !== 'rat' || ![animal.x,animal.y,animal.z].every(Number.isFinite)) continue;
    const d = distance(at, animal);
    if (d < best || (d === best && nearest !== null && animal.id < nearest.id)) { best = d; nearest = animal; }
  }
  return nearest ? { ...nearest } : null;
}
/** One transactional player hunt. Existing NPC hunts and the rat population remain independent. */
export function createOwlHunt(parent: THREE.Scene, captureRat: (id:string, at:{x:number;y:number;z:number})=>boolean) {
  let state = idle(), carried: NpcState | null = null, captures = 0, disposed = false;
  const marker = new THREE.Group(); marker.name = 'owl-rat-aim'; marker.visible = false;
  const material = new THREE.LineBasicMaterial({ color: '#fff0a8', depthTest: false, transparent: true, opacity: .95, toneMapped: false });
  const points: THREE.Vector3[] = [];
  for (let i=0;i<24;i++) { const a=i*Math.PI/12,b=(i+1)*Math.PI/12; points.push(new THREE.Vector3(Math.sin(a)*.32,0,Math.cos(a)*.32),new THREE.Vector3(Math.sin(b)*.32,0,Math.cos(b)*.32)); }
  for (let i=0;i<4;i++) { const a=i*Math.PI/2; points.push(new THREE.Vector3(Math.sin(a)*.20,0,Math.cos(a)*.20),new THREE.Vector3(Math.sin(a)*.45,0,Math.cos(a)*.45)); }
  const geometry = new THREE.BufferGeometry().setFromPoints(points), lines = new THREE.LineSegments(geometry,material); lines.renderOrder = 100; marker.add(lines); parent.add(marker);
  const prey = createNpcModelLayer(parent, 1); prey.root.name = 'owl-carried-rat';
  function render(bird: NativeMotionState) {
    marker.visible = state.phase === 'aim' && !!state.target;
    if (state.target) marker.position.set(state.target.x,state.target.y+.035,state.target.z);
    if (carried) {
      const feet = nativeFeet(bird);
      prey.sync([{ ...carried, x: feet.x, y: feet.y-.12, z: feet.z, heading: bird.heading, action: 'idle', speed: 0, gaitDistance: 0 }]);
    } else prey.sync([]);
  }
  return {
    prepare(input: Readonly<FlightInput>, bird: NativeMotionState, species: string, animals: readonly NpcState[], seconds: number) {
      let next: HuntState = { ...state }, controls = { ...input };
      if (disposed || species !== 'eagle-owl') next = idle();
      else {
        if ((next.phase === 'idle' || next.phase === 'aim') && !bird.grounded && (input.peckHeld || input.peckReleased)) {
          next = { phase: input.peckReleased ? 'dive' : 'aim', target: nearestGroundRat(nativeFeet(bird),animals),
            returnY: nativeFeet(bird).y, age: 0, stalled: 0 };
          if (!next.target && input.peckReleased) next = idle();
        } else if (next.phase === 'aim' && (!input.peckHeld || bird.grounded)) next = idle();
        if (next.phase === 'dive') {
          const live = animals.find(a=>a.kind==='rat' && a.id===next.target?.id);
          if (!live || next.age > 12 || next.stalled > .45) next = { ...next, phase: 'rise', age: 0, stalled: 0, target: null, returnY: Math.max(next.returnY,nativeFeet(bird).y+4) };
          else next.target = { ...live };
        }
        if (next.phase === 'dive' && next.target) controls = { ...input, forward: 0, turn: 0, roll: 0, moveHeading: undefined,
          flapPressed: false, flapHeld: false, descend: true, accelerate: false,
          owlHuntMotion: { phase: 'dive', target: { x: next.target.x, y: next.target.y + bird.body.centreToSoleM + .10, z: next.target.z }, speed: 38 } };
        if (next.phase === 'rise') {
          const riseY = Math.min(178, Math.max(next.returnY, (next.target?.y ?? next.returnY-4) + 4));
          if (nativeFeet(bird).y >= riseY - .15 || next.age > 12 || next.stalled > .45) next = idle();
          else controls = { ...input, forward: 0, turn: 0, roll: 0, moveHeading: undefined, flapPressed: next.age === 0 || bird.grounded,
            flapHeld: true, descend: false, accelerate: false,
            owlHuntMotion: { phase: 'rise', target: { x: bird.x, y: riseY+bird.body.centreToSoleM, z: bird.z }, speed: 16 } };
        }
      }
      const before = { x: bird.x, y: bird.y, z: bird.z }, scaledSeconds = seconds * owlMovementScale(species,bird.time);
      return { input: controls, commit(after: NativeMotionState) {
        if (disposed) return;
        if (species !== 'eagle-owl') carried = null;
        if (next.phase === 'dive' && next.target) {
          const feet = nativeFeet(after);
          if (distance(feet,next.target) <= .25 && captureRat(next.target.id,feet)) {
            carried = { ...next.target }; captures++; next = { ...next, phase: 'rise', age: 0, stalled: 0 };
          } else if (after.grounded) next = { ...next, phase: 'rise', age: 0, stalled: 0 };
          else next = { ...next, age: next.age+scaledSeconds, stalled: distance(before,after)<.005*scaledSeconds ? next.stalled+scaledSeconds : 0 };
        } else if (next.phase === 'rise') next = { ...next, age: next.age+scaledSeconds, stalled: distance(before,after)<.005*scaledSeconds ? next.stalled+scaledSeconds : 0 };
        if (after.grounded && next.phase === 'idle') carried = null;
        state = next; render(after);
      } };
    },
    cancel() { state = idle(); marker.visible = false; },
    clear() { state = idle(); carried = null; marker.visible = false; prey.sync([]); },
    snapshot() { return { phase: state.phase, targetId: state.target?.id ?? null, carriedRatId: carried?.id ?? null, captures, markerVisible: marker.visible }; },
    dispose() { if (disposed) return; disposed = true; marker.removeFromParent(); geometry.dispose(); material.dispose(); prey.dispose(); },
  };
}
