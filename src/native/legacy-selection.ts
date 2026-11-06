import {unlocked,type LookId,type Progress} from '../progress.ts';
import type {CameraProjection} from './ported/motion/controls/b2/native-camera.ts';
interface LegacyScene {
  readonly look:LookId|null;
  selectLook(id:LookId,lens:Pick<CameraProjection,'verticalFovDegrees'|'aspect'>):boolean;
}
/** Existing three-look storage policy; read the actual winner after cleanup. */
export function selectNativeLegacyLook(scene:LegacyScene,progress:Progress,id:LookId,lens:Pick<CameraProjection,'verticalFovDegrees'|'aspect'>):boolean{
  if(!unlocked(id,progress.activeSeconds)||!scene.selectLook(id,lens))return false;
  const winner=scene.look;
  if(winner===null||!unlocked(winner,progress.activeSeconds))return false;
  progress.look=winner;return true;
}
