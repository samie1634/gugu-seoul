import * as THREE from 'three';
import type { LookId } from '../progress.ts';
import type { FlightInput } from '../simulation.ts';
import type { PreparedNativeFrame } from './frame-transaction.ts';
import { createMapCandidate } from './ported/map/candidate.ts';
import { queryRoofSupport, sampleGround } from './ported/map/layout.ts';
import type { MapQuality } from './ported/map/contracts.ts';
import { worldAnchors } from './ported/npcs/models/index.ts';
import type { NpcEvent, NpcState } from './ported/npcs/src/contracts.ts';
import { createNativeNpcBridge } from './npc-bridge.ts';
import { createMapQueries, type MapNativeQueries } from './ported/motion/locomotion/b2/map-queries.ts';
import { createNativeMotionState, nativeFeet, type NativeMotionState } from './ported/motion/locomotion/b2/native-motion.ts';
import type { NativeBody, NativeWorldQueries, Vec3 } from './ported/motion/locomotion/b2/contracts.ts';
import type { CameraProjection, ViewMode } from './ported/motion/controls/b2/native-camera.ts';
import type { Appearance, SceneEvent, SurfaceId } from './ported/shared-contracts.ts';
import type { MotionEvent } from './ported/motion/locomotion/motion.ts';
import { createSpeciesActor,buildNativeAppearance,appearanceForLegacy,normalizeAppearance,type SpeciesEmission,type CandidateDependencies } from '../species-core/index.ts';
export type NativePreset = 'plaza' | 'bench' | 'roof' | 'roof-edge' | 'roof-drop' | 'bridge' | 'under-bridge' | 'river' | 'wall';
export const NATIVE_PRESETS: readonly NativePreset[] = ['plaza','bench','roof','roof-edge','roof-drop','bridge','under-bridge','river','wall'];
export type NativeEvent = SceneEvent & { readonly rawId:string; readonly producer:'motion'|'map'|'npc';readonly npcState?:NpcState;readonly npcLocalTime?:number };
type NativeNpcRecord = NpcEvent & { readonly rawId:string;readonly simTime:number };
const tuning=Object.freeze({walkSpeed:.9,flightSpeed:12,glideSpeed:15});
export interface NativeSceneOptions {
  quality?:MapQuality; preset?:NativePreset; sessionId?:string; world?:NativeWorldQueries;
  /** Internal CPU seam only. No UI/storage/selection policy for these IDs. */
  initialAppearance?:Appearance;
  actorDependencies?:CandidateDependencies;
  /** CPU fixture placement only; still passes all normal spatial validation. */
  spawnForTest?:(preset:NativePreset,defaultPlacement:{feet:Vec3;heading:number})=>{feet:Vec3;heading:number};
}
function legacy(appearance:Appearance):LookId|null{
  if(appearance.speciesId==='pigeon')return appearance.skinId==='white'?'white':'pigeon';
  if(appearance.speciesId==='eagle-owl')return'owl';
  return null;
}
export function createNativeScene(parent:THREE.Scene,initialLook:LookId,options:NativeSceneOptions={}){
  const sessionId=options.sessionId??crypto.randomUUID();
  const map=createMapCandidate({quality:options.quality??'desktop',terrain:'sunken-channel',proportions:'reference-scale',eventSessionId:sessionId});
  const waterMesh=map.root.getObjectByName('cheonggyecheon:water') as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  parent.add(map.root);
  const mapQueries=createMapQueries(map.layout),queries=options.world??mapQueries;
  let birdOwner=new THREE.Group();birdOwner.name='player-bird-owner';parent.add(birdOwner);
  const sceneCleanupErrors:string[]=[];
  let version=0,frameIndex=0,committedCallAge=10,disposed=false,committingFrame=false;
  let lastFailure:string|null=null,blockedFrames=0,batchSequence=0,sequence=0,npcRawSequence=0;
  let lastEvents:NativeEvent[]=[];
  const recentEvents:NativeEvent[]=[],rawRecent:MotionEvent[]=[],npcRecent:NativeNpcRecord[]=[];
  const modeVisits:Record<NativeMotionState['mode'],number>={rest:0,walk:0,flap:0,glide:0,fall:0};
  type Actor=ReturnType<typeof createSpeciesActor>;
  let actor:Actor;
  function construct(appearance:Appearance,preset:NativePreset,previous?:Actor,owner=birdOwner):Actor{
    const probe=buildNativeAppearance(appearance,0,options.actorDependencies);
    const body=probe.body;probe.dispose();
    const fallback=spawn(preset,body),at=options.spawnForTest?.(preset,fallback)??fallback,old=previous?.snapshot();
    const initial=createNativeMotionState({body,tuning,feet:at.feet,sourceId:old?.state.sourceId??'player-bird',time:old?.state.time??0,nextEventSequence:old?.state.nextEventSequence??1});
    initial.heading=at.heading;
    const support=queries.supportAt({at:at.feet,previousFeetY:at.feet.y,footRadiusM:body.footSupportRadiusM,heightM:body.heightM,maxRiseM:.000002,maxDropM:.000002});
    if(support===undefined)throw new Error('Unverified native spawn support');
    initial.grounded=!!support?.landable&&Math.abs(support.height-at.feet.y)<=.000002;initial.mode=initial.grounded?'rest':'fall';initial.support=support;
    return createSpeciesActor(owner,{world:queries,appearance,initialState:initial,sessionId,actorId:'player-bird',
      initialCursor:{lastFrame:frameIndex,batchSequence:0,seq:0},canonicalEvents:false,hideInFirstPerson:true,
      view:{mode:'third',verticalFovDegrees:old?.view.verticalFovDegrees??59,aspect:old?.view.aspect??16/9},
      calledAt:old?.calledAt,dependencies:options.actorDependencies});
  }
  try{actor=construct(normalizeAppearance(options.initialAppearance??appearanceForLegacy(initialLook)),options.preset??'plaza');}
  catch(error){map.dispose();birdOwner.removeFromParent();throw error;}
  const npcs=createNativeNpcBridge(parent,map.layout,actor.state.time);

  function spawn(id: NativePreset, profile: NativeBody): { feet: Vec3; heading: number } {
    if (id === 'bench') return { feet: { x: -79.4, y: sampleGround(map.layout, -79.4, -311.3).y, z: -311.3 }, heading: Math.PI };
    if (id === 'bridge' || id === 'under-bridge') {
      const referenceY = id === 'bridge' ? 0 : map.layout.promenadeY;
      const ground = sampleGround(map.layout, 95, 405, { feetY: referenceY, maxStep: 0.05, height: profile.heightM });
      return { feet: { x: 95, y: ground.y, z: 405 }, heading: Math.PI / 2 };
    }
    if (id === 'river') {
      const ground = sampleGround(map.layout, 155, 410, { feetY: map.layout.promenadeY, maxStep: 0.05, height: profile.heightM });
      return { feet: { x: 155, y: ground.y, z: 410 }, heading: Math.PI * 0.55 };
    }
    if (id.startsWith('roof')) {
      const roof = map.layout.roofs.find(roof => roof.id === 'gate:upper-roof');
      if (!roof) throw new Error('Reviewed roof missing');
      const x = id === 'roof-edge' ? roof.x + roof.width * 0.29 - profile.footSupportRadiusM - 0.03 : roof.x + roof.width * 0.12;
      const support = queryRoofSupport(map.layout, x, roof.z, profile.footSupportRadiusM);
      if (!support) throw new Error('Precise roof support unavailable');
      return { feet: { x, y: support.y + (id === 'roof-drop' ? 0.6 : 0), z: roof.z }, heading: id === 'roof-edge' ? Math.PI / 2 : Math.PI * 1.5 };
    }
    if (id === 'wall') return { feet: { x: -176, y: sampleGround(map.layout, -176, -180.2).y, z: -180.2 }, heading: Math.PI };
    const ground = sampleGround(map.layout, -37, 8);
    return { feet: { x: -37, y: ground.y, z: 8 }, heading: 0 };
  }


  function rememberNpcEvents(raw: readonly NpcEvent[]): NativeNpcRecord[] {
    const records = raw.map(event => Object.freeze({ ...event, rawId: `${sessionId}:npc:${++npcRawSequence}`, simTime: npcs.toSharedTime(event.time) }));
    npcRecent.push(...records); if (npcRecent.length > 64) npcRecent.splice(0, npcRecent.length - 64);
    return records;
  }

  function envelope(raw: readonly SpeciesEmission[], npcEvents: readonly NpcEvent[]): NativeEvent[] {
    const state=actor.state,body=state.body;
    const batch = ++batchSequence;
    const result: NativeEvent[] = [];
    const stamp = (rawId: string, producer: 'motion' | 'map' | 'npc', position: Vec3, simTime: number, actorId = 'player-bird') => ({
      id: `${sessionId}:${batch}:${result.length}`, sessionId, batchSequence: batch, itemIndex: result.length,
      seq: ++sequence, simTime, sourceId: `${producer}-stream`, actorId,
      position: { x: position.x, y: position.y, z: position.z }, rawId, producer,
    });
    for (const emission of raw) {
      const event=emission.raw;
      if (event.type === 'support-lost') continue;
      const contact = emission.contact;
      if (event.type === 'step' && !contact) continue;
      const base = stamp(event.id, 'motion', event.position, event.time);
      if (event.type === 'flap') result.push({ ...base, type: 'flap', speciesId: emission.speciesId });
      else if (event.type === 'land' && contact) result.push({ ...base, type: 'land', surface: contact.surface as SurfaceId, supportId: contact.id, impactSpeed: event.impactSpeed });
      else if (event.type === 'step' && contact) result.push({ ...base, type: 'footstep', surface: contact.surface as SurfaceId, strength: event.intensity });
    }
    for (const event of map.observeActor({ id: 'player-bird', x: state.x, y: state.y, z: state.z,
      radius: body.horizontalRadiusM, centreToSole: body.centreToSoleM, footRadius: body.footSupportRadiusM,
      horizontalRadius: body.horizontalRadiusM, grounded: state.grounded }, state.time, body)) {
      result.push({ ...stamp(event.eventId, 'map', event, event.time), type: event.type,
        targetId: event.targetId, surface: event.surface, strength: event.strength });
    }
    for (const event of rememberNpcEvents(npcEvents)) {
      if (event.type !== 'reaction' && event.type !== 'audio') continue;
      const vocal = event.type === 'audio' && event.cue !== 'footstep' && event.cue !== 'rustle';
      const position = vocal ? worldAnchors(event.state)?.voice : event.position;
      if (!position) throw new Error('Unverified event-time NPC voice anchor');
      const base = { ...stamp(event.rawId, 'npc', position, event.simTime, event.npcId), npcState: event.state, npcLocalTime: event.time };
      if (event.type === 'reaction') result.push({ ...base, type: 'npc-reaction', targetId: event.targetId, kind: event.kind, response: event.response });
      else result.push({ ...base, type: 'npc-audio', kind: event.kind, cue: event.cue, gain: event.gain, surface: event.surface });
    }
    return result;
  }


  function prepareAppearance(value:Appearance,lens?:Pick<CameraProjection,'verticalFovDegrees'|'aspect'>){
    if(disposed)return{kind:'blocked' as const,reason:'disposed'};
    const owner=actor,before=version,proposal=owner.prepareAppearance(value,undefined,lens);
    if(proposal.kind!=='ready')return proposal;
    const isCurrent=()=>!disposed&&actor===owner&&version===before&&proposal.isCurrent();
    return{...proposal,isCurrent,commit(){
      if(!isCurrent()){proposal.cancel();throw new Error('Stale native appearance proposal');}
      version++;proposal.commit();
    }};
  }
  return{
    map,queries,get state(){return actor.state;},get root(){return actor.root;},get look(){return legacy(actor.appearance);},get appearance(){return actor.appearance;},
    get camera(){return actor.snapshot().camera;},get projection(){return actor.snapshot().projection;},get events():readonly NativeEvent[]{return lastEvents;},
    world:{obstacles:map.obstacles,update(_time:number,delta:number){if(!disposed)map.update(actor.state.time,delta);}},
    prepareAppearance,
    selectAppearance(value:Appearance,lens?:Pick<CameraProjection,'verticalFovDegrees'|'aspect'>):boolean{
      try{const p=prepareAppearance(value,lens);if(p.kind==='unchanged')return true;if(p.kind!=='ready')return false;p.commit();return true;}catch{return false;}
    },
    selectLook(value:LookId,lens?:Pick<CameraProjection,'verticalFovDegrees'|'aspect'>):boolean{
      try{return this.selectAppearance(appearanceForLegacy(value),lens);}catch{return false;}
    },
    prepare(input:Readonly<FlightInput>,seconds:number,projection:CameraProjection,mode:ViewMode,callAge:number,reducedMotion:boolean):PreparedNativeFrame{
      const fail=(reason:string):PreparedNativeFrame=>{lastFailure=reason;blockedFrames++;return{kind:'blocked',reason};};
      if(disposed)return fail('disposed');
      if(committingFrame)return fail('commit-finalization-in-progress');
      if(!Number.isFinite(callAge)||callAge<0)return fail('invalid-call-age');
      const owner=actor,before=version,current=owner.snapshot(),coo=callAge<committedCallAge;
      const callTime=coo?Math.max(0,current.state.time+seconds-callAge):current.calledAt;
      const p=owner.prepareFrame({contractVersion:1,frame:frameIndex+1,simTime:current.state.time+seconds,rawSeconds:seconds,acceptedSeconds:seconds,playing:true,
        quality:map.layout.quality,reducedMotion},input,{mode,verticalFovDegrees:projection.verticalFovDegrees,aspect:projection.aspect},callTime);
      if(p.kind!=='ready')return fail(p.reason);
      const raw=p.previewEmissions;
      const isCurrent=()=>!disposed&&!committingFrame&&actor===owner&&version===before&&p.isCurrent();
      return{kind:'ready',isCurrent,commit(){
        if(!isCurrent())throw new Error('Stale native scene proposal');
        version++;frameIndex++;committedCallAge=callAge;lastFailure=null;committingFrame=true;
        try{
          p.commit();
          if(disposed)return;
          const s=actor.snapshot(),state=s.state,body=state.body;modeVisits[state.mode]++;
          const npcEvents=npcs.commit({frame:version,simTime:state.time,acceptedSeconds:seconds,playing:true},
            {x:s.camera.position[0],y:s.camera.position[1],z:s.camera.position[2]},
            {...state,body,flap:raw.some(e=>e.raw.type==='flap'),coo});
          if(disposed)return;
          lastEvents=envelope(raw,npcEvents);
          recentEvents.push(...lastEvents);if(recentEvents.length>64)recentEvents.splice(0,recentEvents.length-64);
          rawRecent.push(...raw.map(e=>e.raw));if(rawRecent.length>64)rawRecent.splice(0,rawRecent.length-64);
        }finally{committingFrame=false;}
      }};
    },
    home(nextLook?:LookId):boolean{
      if(disposed||committingFrame)return false;
      const before=version,previous=actor;let next:Actor|undefined;
      try{
        const nextOwner=new THREE.Group();nextOwner.name='player-bird-owner';
        next=construct(nextLook===undefined?previous.appearance:appearanceForLegacy(nextLook),'plaza',previous,nextOwner);
        if(disposed||version!==before){next.dispose();return false;}
        const previousOwner=birdOwner,index=parent.children.indexOf(previousOwner);
        if(index<0||previousOwner.parent!==parent){next.dispose();return false;}
        actor=next;birdOwner=nextOwner;version++;lastEvents=[];map.forgetActor('player-bird');
        parent.children[index]=nextOwner;nextOwner.parent=parent;previousOwner.parent=null;
        for(const notify of [()=>previousOwner.dispatchEvent({type:'removed'}),()=>parent.dispatchEvent({type:'childremoved',child:previousOwner}),
          ()=>nextOwner.dispatchEvent({type:'added'}),()=>parent.dispatchEvent({type:'childadded',child:nextOwner})]){
          try{notify();}catch(error){sceneCleanupErrors.push(error instanceof Error?error.message:String(error));}
        }
        // Finalizers may adopt a newer same-time winner. No state writes follow.
        previous.dispose();return true;
      }catch{next?.dispose();return false;}
    },
    snapshot(){
      const s=actor.snapshot(),state=s.state,body=state.body;
      return{state,sole:nativeFeet(state),look:legacy(s.appearance),appearance:s.appearance,posedEye:s.eye,camera:s.camera,cameraMode:s.view.mode,projection:s.projection,
        lastFailure,blockedFrames,sessionId,sequence,batchSequence,version,frameIndex,modeVisits:{...modeVisits},events:lastEvents,recentEvents:[...recentEvents],rawEvents:[...rawRecent],
        body,tuning,mapStats:map.stats,quality:map.layout.quality,water:(mapQueries as MapNativeQueries).waterAt(nativeFeet(state)),waterPhase:Array.from(waterMesh.material.uniforms.uPhase.value as Float32Array),
        modelMetrics:s.modelMetrics,rootPosition:s.rootPosition,pose:s.pose,landedAt:s.landedAt,calledAt:s.calledAt,core:{version:s.version,lastFrame:s.lastFrame,batch:s.batch,sequence:s.sequence,cameraOperation:s.cameraOperation,cleanupErrors:[...s.cleanupErrors,...sceneCleanupErrors]},
        npcs:{...npcs.snapshot(),recentEvents:[...npcRecent]}};
    },
    dispose(){if(disposed)return;disposed=true;version++;actor.dispose();rememberNpcEvents(npcs.dispose());map.dispose();birdOwner.removeFromParent();},
  };
}
