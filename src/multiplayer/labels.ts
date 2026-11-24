import * as THREE from 'three';
import type { BubbleViewport } from '../speech-bubble.ts';
import { pigeonName } from './names.ts';
export interface NamedBird { id: string; nameSeed: string; character: THREE.Object3D; head: THREE.Object3D }
export function namePosition(head: THREE.Object3D, camera: THREE.PerspectiveCamera, viewport: BubbleViewport): {left:number;top:number} | null {
  if (![viewport.left,viewport.top,viewport.width,viewport.height].every(Number.isFinite) || viewport.width<=0 || viewport.height<=0) return null;
  camera.updateWorldMatrix(true,false); head.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(head);
  if (bounds.isEmpty()) return null;
  const point=new THREE.Vector3((bounds.min.x+bounds.max.x)/2,bounds.max.y+Math.max(.035,(bounds.max.y-bounds.min.y)*.2),(bounds.min.z+bounds.max.z)/2);
  point.applyMatrix4(camera.matrixWorldInverse);
  if (point.z>=-camera.near || point.z<=-camera.far) return null;
  point.applyMatrix4(camera.projectionMatrix);
  const left=(point.x+1)*viewport.width/2,top=(1-point.y)*viewport.height/2;
  if (![left,top].every(Number.isFinite) || left<0 || left>viewport.width || top<0 || top>viewport.height) return null;
  return {left:viewport.left+left,top:viewport.top+top};
}
export class PigeonNames {
  private labels=new Map<string,HTMLElement>();
  private container:HTMLElement;
  constructor(container:HTMLElement) { this.container=container; }
  update(birds:readonly NamedBird[],camera:THREE.PerspectiveCamera,viewport:BubbleViewport,active:boolean):void {
    const seen=new Set<string>();
    for (const bird of active?birds:[]) {
      seen.add(bird.id);
      let label=this.labels.get(bird.id);
      if (!label) { label=document.createElement('span');label.className='pigeon-name';this.labels.set(bird.id,label);this.container.appendChild(label); }
      label.textContent=pigeonName(bird.nameSeed);
      const point=bird.character.visible?namePosition(bird.head,camera,viewport):null;
      label.hidden=point===null;
      if(point){label.style.left=`${point.left}px`;label.style.top=`${point.top}px`;}
    }
    for(const [id,label] of this.labels)if(!seen.has(id)){label.remove();this.labels.delete(id);}
  }
  clear():void { for(const label of this.labels.values())label.remove();this.labels.clear(); }
}
