import * as THREE from 'three';
import {createNativeScene} from '../src/native/scene.ts';
import {nativeNear} from '../src/native/body-profile.ts';
const e=createNativeScene(new THREE.Scene(),'owl',{mapData:'osm',quality:'mobile'}),neutral={forward:0,turn:0,flapHeld:false,flapPressed:false,descend:false};
let maxHeight=0,failed=[],hunted=false,phases=[],evidence=[];
const tick=(input)=>{const p=e.prepare(input,.05,{near:nativeNear(e.state.body,59,16/9),verticalFovDegrees:59,aspect:16/9},'third',10+e.state.time+.05,false);if(p.kind!=='ready'){failed.push(p.reason);return false;}p.commit();e.world.update(e.state.time,.05);const s=e.snapshot();maxHeight=Math.max(maxHeight,s.sole.y);if(phases.at(-1)!==s.owlHunt.phase){phases.push(s.owlHunt.phase);evidence.push({t:s.state.time,at:s.sole,hunt:s.owlHunt,rats:s.npcs.states.filter(r=>r.kind==='rat').length});}return true;};
try{
for(let i=0;i<70;i++)if(!tick({...neutral,flapHeld:true,flapPressed:i%13===0}))break;
const rats=e.snapshot().npcs.states.filter(r=>r.kind==='rat');
if(rats.length){tick({...neutral,flapHeld:true,peckHeld:true});tick({...neutral,peckReleased:true});for(let i=0;i<400;i++){if(!tick(neutral))break;const s=e.snapshot();if(s.owlHunt.captures>0)hunted=true;if(hunted&&s.owlHunt.phase==='idle')break;}}
console.log(JSON.stringify({actualScene:'osm/mobile',failed,maxHeight,hunted,phases,evidence,final:e.snapshot().owlHunt,finalSole:e.snapshot().sole},null,2));
}finally{e.dispose();}
