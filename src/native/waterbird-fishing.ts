import * as THREE from 'three';
import type { BirdPoint } from './bird-behavior.ts';
import type { StreamFish, StreamFishSchool } from './stream-fish.ts';

/** A bounded stalk/strike/carry cycle using the existing fish and the actual posed bill. */
export function createWaterbirdFishing(school: StreamFishSchool, id: string, delay: number, options: {
  root: THREE.Object3D;
  tip(): THREE.Vector3;
  pose(age: number, fish: StreamFish, walking: boolean): void;
  standAt(x: number, z: number): BirdPoint | null;
  move(goal: BirdPoint, dt: number): boolean;
  radius: number;
  tolerance: number;
}) {
  let target: StreamFish | undefined, age = 0, approachAge = 0, cooldown = delay, catches = 0;
  const cancel = () => { school.release(id, target); target = undefined; cooldown = 18 + delay; age = 0; };
  return {
    cancel,
    get active() { return !!target; },
    snapshot() { return { catches, targetId: target?.id, stage: target ? age > 0 ? 'strike' : 'stalk' : 'idle', cooldown }; },
    update(dt: number, eligible: boolean) {
      cooldown = Math.max(0, cooldown - dt);
      if (!eligible) { if (target) cancel(); return false; }
      if (!target && cooldown === 0) {
        target = school.claim(id, options.root.position, options.radius);
        if (!target) { cooldown = 4 + delay * .1; return false; }
        approachAge = 0; age = 0;
      }
      if (!target) return false;
      const p = options.root.position;
      if (age === 0) {
        approachAge += dt;
        if (approachAge > 18) { cancel(); return false; }
        // Fish pause briefly while stalked; their real position is never moved to a bill.
        target.held = true;
        const heading = Math.atan2(target.x - p.x, p.z - target.z);
        options.root.rotation.y = -heading;
        options.pose(1.2, target, false);
        const tip = options.tip(), goal = options.standAt(target.x - (tip.x - p.x), target.z - (tip.z - p.z));
        if (!goal) { cancel(); return false; }
        if (Math.hypot(goal.x - p.x, goal.z - p.z) > .018) {
          if (!options.move(goal, dt)) { cancel(); return false; }
          options.pose(0, target, true); return true;
        }
        age = dt;
      } else age += dt;
      options.pose(age, target, false);
      const tip = options.tip();
      if (age >= 1.15 && age <= 1.4 && !target.caught) school.contact(id, target, tip, options.tolerance);
      if (target.caught) {
        target.mesh.position.copy(tip); target.mesh.rotation.z = .7;
        target.mesh.scale.setScalar(age > 2 ? Math.max(0, 1 - (age - 2) / .4) : 1);
        if (age >= 2.4 && school.eat(id, target)) catches++;
      }
      if (age >= 2.6) cancel();
      return true;
    },
  };
}
