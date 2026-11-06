import * as THREE from 'three';
import type { Appearance, FrameContext, SceneEvent, SurfaceId, Vec3 } from '../native/ported/shared-contracts.ts';
import type { BirdLod } from '../native/ported/birds/rig-core/contract.ts';
import type { BirdPoseInput } from '../native/ported/birds/rig-core/pose.ts';
import type { FlightInput } from '../simulation.ts';
import type { NativeBody, NativeSupport, NativeWorldQueries } from '../native/ported/motion/locomotion/b2/contracts.ts';
import { advanceNativeMotion, createNativeMotionState, nativeFeet, type NativeMotionState } from '../native/ported/motion/locomotion/b2/native-motion.ts';
import type { MotionEvent } from '../native/ported/motion/locomotion/motion.ts';
import { resolveNativeCamera, type CameraProjection, type NativeCameraResult, type ViewMode } from '../native/ported/motion/controls/b2/native-camera.ts';
import { nativeNear } from '../native/body-profile.ts';
import { appearanceForLegacy, normalizeAppearance, validateLod } from './appearance.ts';
import { buildNativeAppearance, localGeometryBounds, type AssetDependencies, type BirdAsset } from './assets.ts';
import { toBirdPoseInput, toNativeBirdRootPlacement } from './upstream/pose-input.ts';
import { resolveFirstPersonPoseRebind } from './first-person-rebind.ts';

/** Existing game assumptions, not measured species flight/mass/lift data. */
export const SHARED_GAME_TUNING = Object.freeze({ walkSpeed: .9, flightSpeed: 12, glideSpeed: 15 });
export interface CandidateView { readonly mode: ViewMode; readonly verticalFovDegrees: number; readonly aspect: number }
export interface SpeciesCursor { readonly lastFrame:number; readonly batchSequence:number; readonly seq:number }
export interface CandidateDependencies extends AssetDependencies {
  readonly near?: typeof nativeNear;
  readonly camera?: typeof resolveNativeCamera;
}
export interface SpeciesOptions {
  readonly world: NativeWorldQueries;
  readonly appearance?: Appearance;
  readonly legacyLook?: 'pigeon' | 'white' | 'owl';
  readonly lod?: BirdLod;
  readonly feet?: Vec3;
  readonly initialState?: Readonly<NativeMotionState>;
  readonly view?: CandidateView;
  readonly lastLandedAt?: number;
  readonly calledAt?: number;
  readonly sessionId?: string;
  readonly actorId?: string;
  /** The application owns the one combined motion/map/NPC canonical envelope. */
  readonly canonicalEvents?: boolean;
  readonly hideInFirstPerson?: boolean;
  /** Explicit CPU/adoption seed; never reset an existing owner's canonical IDs. */
  readonly initialCursor?: SpeciesCursor;
  readonly dependencies?: CandidateDependencies;
}
export interface SpeciesEmission {
  readonly raw: Readonly<MotionEvent>;
  readonly appearance: Appearance;
  /** Internal metadata, including for land/step whose shared schema has no speciesId. */
  readonly speciesId: Appearance['speciesId'];
  readonly anchor: 'body' | 'sole';
  readonly sourceTime: number;
  readonly canonical?: SceneEvent;
  readonly contact?: Readonly<NativeSupport>|null;
}
export type Blocked = { readonly kind: 'blocked'; readonly reason: string };
type ResolvedCamera = Extract<NativeCameraResult, {kind:'resolved'}>;
export interface SpeciesFrame {
  readonly kind: 'ready';
  readonly pose: Readonly<BirdPoseInput>;
  readonly landedAt: number | undefined;
  readonly previewEmissions: readonly SpeciesEmission[];
  isCurrent(): boolean;
  commit(): void;
  cancel(): void;
}
export interface SpeciesSwap {
  readonly kind: 'ready';
  readonly appearance: Appearance;
  readonly lod: BirdLod;
  readonly cameraOperation: 'appearance-rebind'|'third-person-appearance';
  isCurrent(): boolean;
  commit(): void;
  cancel(): void;
}
const surfaces = new Set<SurfaceId>(['stone','granite','asphalt','wood','metal','roof-tile','water','glass','soil','paving','grass']);
const point = ([x,y,z]: readonly number[]): Vec3 => ({x,y,z});
const sameAppearance = (a: Appearance,b: Appearance) => a.speciesId===b.speciesId&&a.skinId===b.skinId;
const copyState = (s: NativeMotionState): NativeMotionState => ({...s, support:s.support?{...s.support,normal:{...s.support.normal}}:null});
function fail(reason: string): never { throw new Error(reason); }
function identityParent(parent: THREE.Object3D): void {
  parent.updateWorldMatrix(true,false);
  if (!parent.matrixWorld.equals(new THREE.Matrix4())) fail('non-identity-parent');
}
function validSupport(value: NativeSupport): boolean {
  return !!value && typeof value.id==='string' && !!value.id && typeof value.layerId==='string' && !!value.layerId &&
    Number.isFinite(value.height) && !!value.normal && Object.values(value.normal).every(Number.isFinite) &&
    Math.abs(Math.hypot(value.normal.x,value.normal.y,value.normal.z)-1)<.001 && surfaces.has(value.surface as SurfaceId) &&
    typeof value.walkable==='boolean' && typeof value.landable==='boolean';
}

/** One bird-only staging seam; map, motion, camera, rig and accepted clock stay upstream-owned. */
export function createSpeciesActor(parent: THREE.Object3D, options: SpeciesOptions) {
  identityParent(parent);
  if (options.appearance && options.legacyLook) fail('ambiguous-initial-identity');
  const dependencies=options.dependencies??{},world=options.world;
  const sessionId=options.sessionId??crypto.randomUUID(),actorId=options.actorId??'player-bird';
  const cursor=options.initialCursor??{lastFrame:-1,batchSequence:0,seq:0};
  if(!Number.isSafeInteger(cursor.lastFrame)||cursor.lastFrame< -1||!Number.isSafeInteger(cursor.batchSequence)||cursor.batchSequence<0||
    !Number.isSafeInteger(cursor.seq)||cursor.seq<0)fail('invalid-species-cursor');
  let asset=buildNativeAppearance(options.appearance??appearanceForLegacy(options.legacyLook??'pigeon'),options.lod??0,dependencies);
  let state: NativeMotionState;
  let view: CandidateView={...(options.view??{mode:'third',verticalFovDegrees:59,aspect:16/9})};
  let projection: CameraProjection;
  let camera: ResolvedCamera;
  let eye: Vec3;
  let pose: BirdPoseInput;
  let landedAt=options.lastLandedAt;
  let calledAt=options.calledAt;
  let version=0,lastFrame=cursor.lastFrame,batch=cursor.batchSequence,sequence=cursor.seq,disposed=false;
  let emissions: readonly SpeciesEmission[]=Object.freeze([]);
  let cameraOperation: 'initial-placement'|'frame-update'|'appearance-rebind'|'third-person-appearance'='initial-placement';
  const reason=(error: unknown)=>error instanceof Error?error.message:String(error);
  type Pending={invalidate():BirdAsset|undefined};
  const pending=new Set<Pending>(),finalizers:(()=>void)[]=[],cleanupErrors:string[]=[];
  let finalizing=false;
  const invalidatePending=()=>{const retired:BirdAsset[]=[];for(const ticket of [...pending]){const old=ticket.invalidate();if(old)retired.push(old);}return retired;};
  function finalize(tasks:(()=>void)[]):void {
    finalizers.push(...tasks);if(finalizing)return;
    finalizing=true;
    try{while(finalizers.length){try{finalizers.shift()!();}catch(error){cleanupErrors.push(reason(error));}}}
    finally{finalizing=false;}
  }
  const release=(retired:BirdAsset)=>()=>{retired.dispose();cleanupErrors.push(...retired.cleanupErrors);};
  // Publish the owned scene-graph links without synchronous event callbacks.
  // Deliver the normal Three events only after every logical/visual field agrees.
  function detach(root:THREE.Object3D,tasks:(()=>void)[]):void {
    const owner=root.parent;if(!owner)return;
    const index=owner.children.indexOf(root);if(index>=0)owner.children.splice(index,1);root.parent=null;
    tasks.push(()=>root.dispatchEvent({type:'removed'}),()=>owner.dispatchEvent({type:'childremoved',child:root}));
  }
  function attach(root:THREE.Object3D,tasks:(()=>void)[]):void {
    detach(root,tasks);root.parent=parent;parent.children.push(root);
    tasks.push(()=>root.dispatchEvent({type:'added'}),()=>parent.dispatchEvent({type:'childadded',child:root}));
  }

  function support(candidate: NativeMotionState): NativeSupport|null {
    const feet=nativeFeet(candidate);
    const value=world.supportAt({at:feet,previousFeetY:feet.y,footRadiusM:candidate.body.footSupportRadiusM,
      heightM:candidate.body.heightM,maxRiseM:.000002,maxDropM:.000002,layerId:candidate.support?.layerId});
    if(value===undefined)fail('unverified-support');
    if(value!==null&&!validSupport(value))fail('malformed-support');
    return value;
  }
  function placement(candidate: NativeMotionState): void {
    const hit=world.sweepBody(candidate,candidate,candidate.body);
    if(hit!==null)fail(hit===undefined?'unverified-body':'body-overlap');
    const verified=support(candidate);
    if(candidate.grounded&&(!verified?.landable||Math.abs(verified.height-nativeFeet(candidate).y)>.000002))fail('grounded-support-required');
    // A known air miss is valid. It must not reset mode/velocity or synthesize land/fall.
    candidate.support=candidate.grounded?verified:null;
  }
  function apply(target: BirdAsset,candidate: NativeMotionState,nextPose: BirdPoseInput): Vec3 {
    const placement=toNativeBirdRootPlacement(candidate,candidate.body);
    target.rig.root.position.set(placement.position.x,placement.position.y,placement.position.z);
    target.rig.root.rotation.set(0,placement.yaw,0);
    target.rig.pose(nextPose);target.rig.root.updateMatrixWorld(true);
    const sampled=target.rig.getEyeWorldPosition(new THREE.Vector3());
    if(![sampled.x,sampled.y,sampled.z].every(Number.isFinite))fail('invalid-posed-eye');
    return{x:sampled.x,y:sampled.y,z:sampled.z};
  }
  function lens(body: NativeBody,nextView: CandidateView): CameraProjection {
    const near=(dependencies.near??nativeNear)(body,nextView.verticalFovDegrees,nextView.aspect);
    if(!Number.isFinite(near)||near<=.001)fail('invalid-near');
    return{near,verticalFovDegrees:nextView.verticalFovDegrees,aspect:nextView.aspect};
  }
  function cameraMetrics(body: NativeBody) {
    return{body,chaseTargetOffset:[0,body.eyeFromSoleM.y-body.centreToSoleM,0] as const,
      chaseGroundOffset:[0,body.heightM*3.2-body.centreToSoleM,body.heightM*10] as const,
      chaseAirOffset:[0,body.heightM*5.2-body.centreToSoleM,body.heightM*14.5] as const};
  }
  function resolve(candidate: NativeMotionState,nextView: CandidateView,nextProjection: CameraProjection,seconds: number,nextEye: Vec3,reducedMotion: boolean,previous?:readonly[number,number,number]): ResolvedCamera {
    const body=candidate.body;
    const result=(dependencies.camera??resolveNativeCamera)({bird:candidate,mode:nextView.mode,world,projection:nextProjection,
      acceptedSeconds:seconds,previousPosition:previous,posedEyeWorld:nextEye,reducedMotion,
      metrics:cameraMetrics(body)});
    if(result.kind==='blocked')fail('camera:'+result.reason);
    if(nextView.mode==='first'&&Math.hypot(result.position[0]-nextEye.x,result.position[1]-nextEye.y,result.position[2]-nextEye.z)>1e-6)
      fail(seconds===0?'zero-time-first-person-swap-policy':'first-person-eye-unreachable');
    return result;
  }
  function eventPreview(raw: readonly MotionEvent[],candidate: NativeMotionState,appearance: Appearance): {events:readonly SpeciesEmission[];nextSequence:number} {
    let seq=sequence,item=0;
    const events: SpeciesEmission[]=[];
    for(const event of raw){
      const copy=Object.freeze({...event,position:Object.freeze({...event.position})});
      let contact: NativeSupport|null=null;
      if(event.type==='step'||event.type==='land'){
        const value=world.supportAt({at:event.position,previousFeetY:event.position.y,footRadiusM:candidate.body.footSupportRadiusM,
          heightM:candidate.body.heightM,maxRiseM:.000002,maxDropM:.000002,layerId:candidate.support?.layerId});
        if(value===undefined||(value!==null&&!validSupport(value)))fail('unverified-event-contact');
        contact=value;
        if(event.type==='land'&&!contact?.landable)fail('unverified-land-contact');
      }
      let canonical: SceneEvent|undefined;
      const stamp=()=>({id:sessionId+':'+(batch+1)+':'+item++,sessionId,batchSequence:batch+1,itemIndex:item-1,seq:++seq,
        simTime:event.time,sourceId:'motion-stream',actorId,position:copy.position});
      if(options.canonicalEvents!==false){
        if(event.type==='flap')canonical={...stamp(),type:'flap',speciesId:appearance.speciesId};
        else if(event.type==='land'&&contact)canonical={...stamp(),type:'land',surface:contact.surface as SurfaceId,supportId:contact.id,impactSpeed:event.impactSpeed};
        else if(event.type==='step'&&contact)canonical={...stamp(),type:'footstep',surface:contact.surface as SurfaceId,strength:event.intensity};
      }
      events.push(Object.freeze({raw:copy,appearance,speciesId:appearance.speciesId,anchor:event.type==='flap'?'body':'sole',sourceTime:event.time,
        contact:contact?Object.freeze({...contact,normal:Object.freeze({...contact.normal})}):null,...(canonical?{canonical:Object.freeze(canonical)}:{})}));
    }
    return{events:Object.freeze(events),nextSequence:seq};
  }

  try{
    const initial=options.initialState;
    state=initial?createNativeMotionState({bird:{...initial,y:nativeFeet(initial).y+asset.body.centreToSoleM},body:asset.body,tuning:initial.tuning,
      sourceId:initial.sourceId,time:initial.time,nextEventSequence:initial.nextEventSequence}):
      createNativeMotionState({body:asset.body,tuning:SHARED_GAME_TUNING,feet:options.feet??{x:0,y:0,z:0},sourceId:actorId});
    if(landedAt!==undefined&&(!Number.isFinite(landedAt)||landedAt>state.time||landedAt<0))fail('invalid-landing-time');
    placement(state);pose=toBirdPoseInput(state,{simTime:state.time,landedAt,calledAt});
    eye=apply(asset,state,pose);projection=lens(state.body,view);camera=resolve(state,view,projection,0,eye,false);
    if(options.hideInFirstPerson)asset.rig.root.visible=view.mode!=='first';
    parent.add(asset.rig.root);
  }catch(error){asset.dispose();throw error;}

  function prepareAppearance(value: Appearance,lodValue: BirdLod=asset.lod,lensView?:Pick<CandidateView,'verticalFovDegrees'|'aspect'>): SpeciesSwap|Blocked|{readonly kind:'unchanged'} {
    if(disposed)return{kind:'blocked',reason:'disposed'};
    const before=version,currentState=state,currentPose=pose,currentView={...view,...lensView,mode:view.mode},currentCamera=camera,currentAppearance=asset.appearance;
    let next: BirdAsset|undefined;
    try{
      identityParent(parent);
      const appearance=normalizeAppearance(value),lod=validateLod(lodValue);
      if(sameAppearance(appearance,asset.appearance)&&lod===asset.lod)return{kind:'unchanged'};
      next=buildNativeAppearance(appearance,lod,dependencies);
      const body=sameAppearance(appearance,currentAppearance)?currentState.body:next.body;
      const candidate=createNativeMotionState({bird:{...currentState,y:nativeFeet(currentState).y+body.centreToSoleM},body,
        tuning:currentState.tuning,sourceId:currentState.sourceId,time:currentState.time,nextEventSequence:currentState.nextEventSequence});
      candidate.support=currentState.support;
      placement(candidate);
      const nextEye=apply(next,candidate,currentPose),nextProjection=lens(body,currentView);
      if(options.hideInFirstPerson)next.rig.root.visible=currentView.mode!=='first';
      let nextCamera: ResolvedCamera;
      const nextOperation=currentView.mode==='first'?'appearance-rebind':'third-person-appearance';
      if(currentView.mode==='first'){
        const rebound=resolveFirstPersonPoseRebind({reason:'appearance-rebind',bird:candidate,metrics:cameraMetrics(body),world,
          projection:nextProjection,previousPosition:currentCamera.position,posedEyeWorld:nextEye,reducedMotion:currentPose.reducedMotion??false});
        if(rebound.kind==='blocked')fail(rebound.reason);
        nextCamera=rebound.camera;
      }else nextCamera=resolve(candidate,currentView,nextProjection,0,nextEye,currentPose.reducedMotion??false,currentCamera.position);
      const sight=world.sweepSphere(point(nextCamera.position),nextEye,.001);
      if(sight!==null)fail(sight===undefined?'unverified-swap-eye-sight':'occluded-swap-eye');
      if(disposed||version!==before)fail('stale-appearance-during-preview');
      const staged=next;let used=false;
      const isCurrent=()=>!used&&!disposed&&version===before;
      const ticket:Pending={invalidate(){if(used)return;used=true;pending.delete(ticket);return staged;}};
      const cancel=()=>{const retired=ticket.invalidate();if(retired)finalize([release(retired)]);};pending.add(ticket);
      return{kind:'ready',appearance,lod,cameraOperation:nextOperation,isCurrent,cancel,commit(){
        if(!isCurrent()){cancel();fail('stale-appearance-proposal');}
        used=true;pending.delete(ticket);const retired=invalidatePending(),tasks:(()=>void)[]=[];
        const previous=asset;asset=staged;state=candidate;projection=nextProjection;camera=nextCamera;eye=nextEye;view={...currentView};cameraOperation=nextOperation;version++;
        detach(previous.rig.root,tasks);attach(staged.rig.root,tasks);
        // No state writes after callbacks. A successful nested same-time swap wins.
        finalize([...tasks,...retired.map(release),release(previous)]);
      }};
    }catch(error){next?.dispose();return{kind:'blocked',reason:reason(error)};}
  }

  return{
    get root(){return asset.rig.root;},
    get state(){return Object.freeze(copyState(state));},
    get appearance(){return asset.appearance;},
    get events(){return emissions;},
    prepareAppearance,
    prepareLegacy(look: 'pigeon'|'white'|'owl',lod: BirdLod=asset.lod){try{return prepareAppearance(appearanceForLegacy(look),lod);}catch(error){return{kind:'blocked' as const,reason:reason(error)};}},
    prepareLod(lod: BirdLod){return prepareAppearance(asset.appearance,lod);},
    prepareFrame(context: FrameContext,input: Readonly<FlightInput>,nextView: CandidateView=view,callTime: number|undefined=calledAt): SpeciesFrame|Blocked {
      if(disposed)return{kind:'blocked',reason:'disposed'};
      // A post-commit callback may change appearance at the adopted time, but it
      // cannot advance time before the external clock/input owner returns.
      if(finalizing)return{kind:'blocked',reason:'commit-finalization-in-progress'};
      const before=version,currentAsset=asset,currentState=state,proposedView=Object.freeze({...nextView});
      context=Object.freeze({...context});
      const seconds=context.acceptedSeconds;
      if(context.contractVersion!==1||!context.playing||typeof context.reducedMotion!=='boolean'||
        (context.quality!=='desktop'&&context.quality!=='mobile')||!Number.isInteger(context.frame)||context.frame<0||context.frame<=lastFrame||
        !Number.isFinite(seconds)||seconds<=0||seconds>.1||!Number.isFinite(context.rawSeconds)||context.rawSeconds<seconds||context.rawSeconds>.25||
        !Number.isFinite(context.simTime)||Math.abs(context.simTime-currentState.time-seconds)>1e-8)return{kind:'blocked',reason:'invalid-or-inactive-frame'};
      try{
        identityParent(parent);
        const motion=advanceNativeMotion(currentState,input,seconds,world);
        if(motion.status!=='advanced'||motion.acceptedSeconds!==seconds)fail('motion:'+(motion.status==='blocked'?motion.reason:motion.status));
        let nextLandedAt=landedAt;for(const event of motion.events)if(event.type==='land')nextLandedAt=event.time;
        if(callTime!==undefined&&(!Number.isFinite(callTime)||callTime<0||callTime>motion.state.time))fail('invalid-call-time');
        const nextPose=toBirdPoseInput(motion.state,{simTime:motion.state.time,landedAt:nextLandedAt,calledAt:callTime,reducedMotion:context.reducedMotion});
        const eventStage=eventPreview(motion.events,motion.state,asset.appearance);
        const nextProjection=lens(motion.state.body,proposedView);
        let nextEye: Vec3,nextCamera: ResolvedCamera;
        const transforms: {object:THREE.Object3D;position:THREE.Vector3;quaternion:THREE.Quaternion;scale:THREE.Vector3;matrix:THREE.Matrix4}[]=[];
        try{
          nextEye=apply(currentAsset,motion.state,nextPose);nextCamera=resolve(motion.state,proposedView,nextProjection,seconds,nextEye,context.reducedMotion,camera.position);
          currentAsset.rig.root.traverse(object=>transforms.push({object,position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone(),matrix:object.matrix.clone()}));
        }finally{if(!disposed&&asset===currentAsset)apply(currentAsset,state,pose);}
        if(disposed||version!==before)fail('stale-species-during-preview');
        const frame=context.frame;let used=false;
        const isCurrent=()=>!used&&!disposed&&version===before;
        return{kind:'ready',pose:Object.freeze({...nextPose}),landedAt:nextLandedAt,previewEmissions:eventStage.events,isCurrent,
          cancel(){used=true;},commit(){
            if(!isCurrent())fail('stale-species-frame');used=true;const retired=invalidatePending();
            // Commit the already validated pose transforms; no posing/collision
            // query is rerun after the external input/clock owner accepts this ticket.
            for(const t of transforms){t.object.position.copy(t.position);t.object.quaternion.copy(t.quaternion);t.object.scale.copy(t.scale);t.object.matrix.copy(t.matrix);t.object.matrixWorldNeedsUpdate=true;}
            currentAsset.rig.root.updateMatrixWorld(true);
            if(options.hideInFirstPerson)currentAsset.rig.root.visible=proposedView.mode!=='first';
            state=motion.state;pose=nextPose;eye=nextEye;camera=nextCamera;projection=nextProjection;view={...proposedView};
            landedAt=nextLandedAt;calledAt=callTime;lastFrame=frame;emissions=eventStage.events;sequence=eventStage.nextSequence;if(options.canonicalEvents!==false)batch++;version++;
            cameraOperation='frame-update';
            finalize(retired.map(release));
          }};
      }catch(error){return{kind:'blocked',reason:reason(error)};}
    },
    snapshot(){return{appearance:asset.appearance,lod:asset.lod,state:copyState(state),body:state.body,measurement:asset.measurement,modelMetrics:asset.modelMetrics,
      rootPosition:asset.rig.root.position.toArray(),rootScale:asset.rig.root.scale.toArray(),eye:{...eye},pose:{...pose},landedAt,calledAt,
      camera:{...camera,position:[...camera.position] as [number,number,number],lookAt:[...camera.lookAt] as [number,number,number]},projection:{...projection},view:{...view},
      version,lastFrame,batch,sequence,events:emissions,cameraOperation,disposed,cleanupErrors:[...cleanupErrors]};},
    localBounds(){if(disposed)fail('disposed');return localGeometryBounds(asset.rig);},
    dispose(){if(disposed)return;disposed=true;const retired=invalidatePending(),active=asset,tasks:(()=>void)[]=[];detach(active.rig.root,tasks);finalize([...tasks,...retired.map(release),release(active)]);},
  };
}
