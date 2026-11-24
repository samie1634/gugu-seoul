import { remoteFacing } from './facing.ts';
import type { NamedBird } from './labels.ts';
import * as THREE from 'three';
import { buildNativeAppearance, type BirdAsset } from '../species-core/assets.ts';
import { appearanceForLegacy } from '../species-core/appearance.ts';
import { makeBird, poseBird, type BirdRig } from '../bird.ts';
import type { PlayerState } from './state.ts';
interface Remote { nameSeed:string; key: string; root: THREE.Group; asset?: BirdAsset; legacy?: BirdRig }
/** Remote players are separate scene objects, never simulated as NPCs or local physics. */
export class RemoteBirds {
  readonly root = new THREE.Group();
  private birds = new Map<string, Remote>();
  private world: NonNullable<PlayerState['world']>;
  private reducedMotion: boolean;
  constructor(scene: THREE.Scene, world: NonNullable<PlayerState['world']>, reducedMotion: boolean) { this.world=world; this.reducedMotion=reducedMotion; this.root.name='remote-players'; scene.add(this.root); }
  update(states: Map<string, PlayerState>): void {
    const visible=new Set<string>();
    for (const [id,s] of states) {
      if ((s.world ?? 'native-osm')!==this.world) continue;
      visible.add(id);
      const appearance=s.appearance ?? appearanceForLegacy(s.look);
      const key=this.world==='legacy'?s.look:JSON.stringify(appearance);
      let bird=this.birds.get(id);
      if (bird?.key!==key) {
        if (bird) this.remove(id,bird);
        if (this.world==='legacy') { const legacy=makeBird(s.look); bird={key,nameSeed:s.nameSeed??id,root:legacy.root,legacy}; }
        else { const asset=buildNativeAppearance(appearance); bird={key,nameSeed:s.nameSeed??id,root:asset.rig.root,asset}; }
        bird.root.name=`remote-player-${id}`; bird.root.userData.remotePlayer=true;
        this.birds.set(id,bird); this.root.add(bird.root);
      }
      if (!bird) continue;
      bird.root.position.set(s.x,s.y-(bird.asset?.body.centreToSoleM ?? 0),s.z);
      bird.nameSeed=s.nameSeed??id;
      const facing=remoteFacing(s);
      bird.root.rotation.set(facing.pitch,facing.yaw,facing.roll,'YXZ');
      if (bird.asset) bird.asset.rig.pose({mode:s.mode,time:s.time,steps:s.steps,flapAge:s.flapAge,callAge:s.cooAge,peckAge:s.peckAge,roll:s.roll,reducedMotion:this.reducedMotion});
      else if (bird.legacy) poseBird(bird.legacy,s.mode,s.time,s.flapAge,s.steps,s.cooAge);
    }
    for (const [id,bird] of this.birds) if (!visible.has(id)) this.remove(id,bird);
  }
  namedBirds():NamedBird[] { return [...this.birds].map(([id,bird])=>({id,nameSeed:bird.nameSeed,character:bird.root,head:bird.asset?.rig.model.pivots.head??bird.legacy!.head})); }
  private remove(id: string,bird: Remote): void { bird.root.removeFromParent(); bird.asset?.dispose(); this.birds.delete(id); }
  clear(): void { for (const [id,bird] of this.birds) this.remove(id,bird); }
}
