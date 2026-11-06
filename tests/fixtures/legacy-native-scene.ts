// Frozen pre-species scene for two historical regression probes only.
import * as THREE from 'three';
import type { LookId } from '../../src/progress.ts';
import type { FlightInput } from '../../src/simulation.ts';
import type { PreparedNativeFrame } from '../../src/native/frame-transaction.ts';
import { buildNativeBird, measureNativeBody, nativeNear } from '../../src/native/body-profile.ts';
import { createMapCandidate } from '../../src/native/ported/map/candidate.ts';
import { queryRoofSupport, sampleGround } from '../../src/native/ported/map/layout.ts';
import type { MapQuality } from '../../src/native/ported/map/contracts.ts';
import { worldAnchors } from '../../src/native/ported/npcs/models/index.ts';
import type { NpcEvent, NpcState } from '../../src/native/ported/npcs/src/contracts.ts';
import { createNativeNpcBridge } from '../../src/native/npc-bridge.ts';
import { createMapQueries, type MapNativeQueries } from '../../src/native/ported/motion/locomotion/b2/map-queries.ts';
import { advanceNativeMotion, createNativeMotionState, nativeFeet, type NativeMotionState } from '../../src/native/ported/motion/locomotion/b2/native-motion.ts';
import type { NativeBody, NativeSupport, NativeWorldQueries, Vec3 } from '../../src/native/ported/motion/locomotion/b2/contracts.ts';
import { resolveNativeCamera, type CameraProjection, type NativeCameraResult, type ViewMode } from '../../src/native/ported/motion/controls/b2/native-camera.ts';
import type { BirdMetrics, SceneEvent, SurfaceId } from '../../src/native/ported/shared-contracts.ts';
import type { MotionEvent } from '../../src/native/ported/motion/locomotion/motion.ts';

export type NativePreset = 'plaza' | 'bench' | 'roof' | 'roof-edge' | 'roof-drop' | 'bridge' | 'under-bridge' | 'river' | 'wall';
export const NATIVE_PRESETS: readonly NativePreset[] = ['plaza', 'bench', 'roof', 'roof-edge', 'roof-drop', 'bridge', 'under-bridge', 'river', 'wall'];
export type NativeEvent = SceneEvent & { readonly rawId: string; readonly producer: 'motion' | 'map' | 'npc';
  readonly npcState?: NpcState; readonly npcLocalTime?: number };
type NativeNpcRecord = NpcEvent & { readonly rawId: string; readonly simTime: number };
const tuning = Object.freeze({ walkSpeed: 0.9, flightSpeed: 12, glideSpeed: 15 });
const surfaces = new Set<SurfaceId>(['stone', 'granite', 'asphalt', 'wood', 'metal', 'roof-tile', 'water', 'glass', 'soil', 'paving', 'grass']);
type ResolvedCamera = Extract<NativeCameraResult, { kind: 'resolved' }>;

export interface NativeSceneOptions {
  quality?: MapQuality;
  preset?: NativePreset;
  sessionId?: string;
  /** Test injection; production uses the single reviewed map adapter. */
  world?: NativeWorldQueries;
}

export function createNativeScene(parent: THREE.Scene, initialLook: LookId, options: NativeSceneOptions = {}) {
  const sessionId = options.sessionId ?? crypto.randomUUID();
  const map = createMapCandidate({ quality: options.quality ?? 'desktop', terrain: 'sunken-channel', proportions: 'reference-scale', eventSessionId: sessionId });
  const waterMesh = map.root.getObjectByName('cheonggyecheon:water') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  parent.add(map.root);
  const mapQueries = createMapQueries(map.layout);
  const queries = options.world ?? mapQueries;
  let rig = buildNativeBird(initialLook);
  let body = measureNativeBody(rig);
  let look = initialLook;
  let version = 0;
  let committedCallAge = 10;
  let committedReducedMotion = false;
  let camera: ResolvedCamera | null = null;
  let lastProjection: CameraProjection | null = null;
  let cameraMode: ViewMode = 'third';
  let posedEye: Vec3 = { x: 0, y: 0, z: 0 };
  let lastFailure: string | null = null;
  let blockedFrames = 0;
  let batchSequence = 0;
  let sequence = 0;
  let lastEvents: NativeEvent[] = [];
  const recentEvents: NativeEvent[] = [];
  const rawRecent: MotionEvent[] = [];
  const npcRecent: NativeNpcRecord[] = [];
  let npcRawSequence = 0;
  let disposed = false;
  let disposedVisual: { modelMetrics: BirdMetrics; rootPosition: number[] } | null = null;
  const modeVisits: Record<NativeMotionState['mode'], number> = { rest: 0, walk: 0, flap: 0, glide: 0, fall: 0 };
  const preset = options.preset ?? 'plaza';
  const initial = spawn(preset, body);
  let state = createNativeMotionState({ body, tuning, feet: initial.feet, sourceId: 'player-bird' });
  state.heading = initial.heading;
  if (!validatePlacement(state)) throw new Error('Native spawn is not spatially verified: ' + preset);
  parent.add(rig.root);
  applyPose(state, committedCallAge);
  const npcs = createNativeNpcBridge(parent, map.layout, state.time);

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

  function validatePlacement(candidate: NativeMotionState): boolean {
    try {
      if (queries.sweepBody(candidate, candidate, candidate.body) !== null) return false;
      const feet = nativeFeet(candidate);
      const support = queries.supportAt({ at: feet, previousFeetY: feet.y, footRadiusM: candidate.body.footSupportRadiusM,
        heightM: candidate.body.heightM, maxRiseM: 0.000002, maxDropM: 0.000002 });
      if (support === undefined) return false;
      candidate.support = support;
      candidate.grounded = !!support?.landable && Math.abs(support.height - feet.y) <= 0.000002;
      candidate.mode = candidate.grounded ? 'rest' : 'fall';
      return true;
    } catch { return false; }
  }

  function applyPose(candidate: NativeMotionState, callAge: number, reducedMotion = false, targetRig = rig): void {
    const feet = nativeFeet(candidate);
    targetRig.root.position.set(feet.x, feet.y, feet.z);
    targetRig.root.rotation.set(0, -candidate.heading, 0);
    targetRig.pose({ mode: candidate.mode, time: candidate.time, flapAge: candidate.flapAge, steps: candidate.steps, callAge, reducedMotion });
    targetRig.root.updateMatrixWorld(true);
    targetRig.root.visible = cameraMode !== 'first';
  }

  function resolve(candidate: NativeMotionState, projection: CameraProjection, mode: ViewMode, dt: number, eye: Vec3, reducedMotion: boolean, previous: readonly [number, number, number] | null | undefined = camera?.position) {
    const profile = candidate.body;
    return resolveNativeCamera({ bird: candidate, mode, world: queries, projection, acceptedSeconds: dt,
      previousPosition: previous ?? undefined, posedEyeWorld: eye, reducedMotion,
      metrics: { body: profile,
        chaseTargetOffset: [0, profile.eyeFromSoleM.y - profile.centreToSoleM, 0],
        chaseGroundOffset: [0, profile.heightM * 3.2 - profile.centreToSoleM, profile.heightM * 10],
        chaseAirOffset: [0, profile.heightM * 5.2 - profile.centreToSoleM, profile.heightM * 14.5] } });
  }

  function rememberNpcEvents(raw: readonly NpcEvent[]): NativeNpcRecord[] {
    const records = raw.map(event => Object.freeze({ ...event, rawId: `${sessionId}:npc:${++npcRawSequence}`, simTime: npcs.toSharedTime(event.time) }));
    npcRecent.push(...records); if (npcRecent.length > 64) npcRecent.splice(0, npcRecent.length - 64);
    return records;
  }

  function envelope(raw: readonly MotionEvent[], contacts: ReadonlyMap<string, NativeSupport | null>, npcEvents: readonly NpcEvent[]): NativeEvent[] {
    const batch = ++batchSequence;
    const result: NativeEvent[] = [];
    const stamp = (rawId: string, producer: 'motion' | 'map' | 'npc', position: Vec3, simTime: number, actorId = 'player-bird') => ({
      id: `${sessionId}:${batch}:${result.length}`, sessionId, batchSequence: batch, itemIndex: result.length,
      seq: ++sequence, simTime, sourceId: `${producer}-stream`, actorId,
      position: { x: position.x, y: position.y, z: position.z }, rawId, producer,
    });
    for (const event of raw) {
      if (event.type === 'support-lost') continue;
      const contact = contacts.get(event.id);
      if (event.type === 'step' && !contact) continue;
      const base = stamp(event.id, 'motion', event.position, event.time);
      if (event.type === 'flap') result.push({ ...base, type: 'flap', speciesId: look === 'owl' ? 'eagle-owl' : 'pigeon' });
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

  return {
    map, queries, get state() { return state; }, get root() { return rig.root; }, get look() { return look; },
    get camera() { return camera; }, get events(): readonly NativeEvent[] { return lastEvents; },
    world: { obstacles: map.obstacles, update(_time: number, delta: number) { map.update(state.time, delta); } },
    prepare(input: Readonly<FlightInput>, seconds: number, projection: CameraProjection, mode: ViewMode, callAge: number, reducedMotion: boolean): PreparedNativeFrame {
      const before = version;
      const motion = advanceNativeMotion(state, input, seconds, queries);
      const fail = (reason: string): PreparedNativeFrame => { lastFailure = reason; blockedFrames++; return { kind: 'blocked', reason }; };
      if (motion.status !== 'advanced' || motion.acceptedSeconds !== seconds) return fail(motion.status === 'blocked' ? motion.reason : 'unaccepted-time');
      if (motion.state.support && !surfaces.has(motion.state.support.surface as SurfaceId)) return fail('unverified-surface');
      const contacts = new Map<string, NativeSupport | null>();
      try {
        for (const event of motion.events) {
          if (event.type !== 'land' && event.type !== 'step') continue;
          const contact = queries.supportAt({ at: event.position, previousFeetY: event.position.y,
            footRadiusM: body.footSupportRadiusM, heightM: body.heightM, maxRiseM: 0.000002, maxDropM: 0.000002 });
          if (contact === undefined || (contact && !surfaces.has(contact.surface as SurfaceId))) return fail('unverified-contact-event');
          if (event.type === 'land' && (!contact || !contact.landable)) return fail('unverified-land-event');
          contacts.set(event.id, contact);
        }
      } catch { return fail('contact-query-exception'); }
      let view: NativeCameraResult;
      let eye: Vec3;
      try {
        applyPose(motion.state, callAge, reducedMotion);
        const sampled = rig.getEyeWorldPosition(new THREE.Vector3());
        eye = { x: sampled.x, y: sampled.y, z: sampled.z };
        view = resolve(motion.state, projection, mode, seconds, eye, reducedMotion);
      } finally { applyPose(state, committedCallAge, committedReducedMotion); }
      if (view.kind === 'blocked') return fail('camera:' + view.reason);
      const isCurrent = () => !disposed && version === before;
      return { kind: 'ready', isCurrent, commit() {
        if (!isCurrent()) throw new Error('Stale native scene proposal');
        const coo = callAge < committedCallAge;
        state = motion.state; camera = view; cameraMode = mode; posedEye = eye; committedCallAge = callAge; committedReducedMotion = reducedMotion; lastProjection = { ...projection };
        version++; lastFailure = null;
        modeVisits[state.mode]++;
        applyPose(state, callAge, reducedMotion);
        const npcEvents = npcs.commit({ frame: version, simTime: state.time, acceptedSeconds: seconds, playing: true },
          { x: view.position[0], y: view.position[1], z: view.position[2] },
          { ...state, body, flap: motion.events.some(event => event.type === 'flap'), coo });
        lastEvents = envelope(motion.events, contacts, npcEvents);
        recentEvents.push(...lastEvents); if (recentEvents.length > 64) recentEvents.splice(0, recentEvents.length - 64);
        rawRecent.push(...motion.events); if (rawRecent.length > 64) rawRecent.splice(0, rawRecent.length - 64);
      } };
    },
    selectLook(nextLook: LookId): boolean {
      if (nextLook === look) return true;
      const nextRig = buildNativeBird(nextLook);
      const nextBody = measureNativeBody(nextRig);
      const candidate = createNativeMotionState({ body: nextBody, tuning, bird: { ...state, y: nativeFeet(state).y + nextBody.centreToSoleM },
        sourceId: state.sourceId, time: state.time, nextEventSequence: state.nextEventSequence });
      if (!validatePlacement(candidate)) { nextRig.dispose(); return false; }
      applyPose(candidate, committedCallAge, committedReducedMotion, nextRig);
      const eye = nextRig.getEyeWorldPosition(new THREE.Vector3());
      const nextProjection = lastProjection ? { ...lastProjection, near: nativeNear(nextBody, lastProjection.verticalFovDegrees, lastProjection.aspect) } : null;
      const nextCamera = nextProjection ? resolve(candidate, nextProjection, cameraMode, 0, eye, committedReducedMotion) : null;
      if (nextCamera?.kind === 'blocked') { nextRig.dispose(); return false; }
      rig.root.removeFromParent(); rig.dispose(); rig = nextRig; body = nextBody; look = nextLook; state = candidate;
      if (nextCamera) camera = nextCamera;
      lastProjection = nextProjection;
      posedEye = { x: eye.x, y: eye.y, z: eye.z };
      parent.add(rig.root); version++; applyPose(state, committedCallAge, committedReducedMotion); return true;
    },
    home(nextLook = look): boolean {
      const nextRig = buildNativeBird(nextLook);
      const nextBody = measureNativeBody(nextRig);
      const at = spawn('plaza', nextBody);
      const candidate = createNativeMotionState({ body: nextBody, tuning, feet: at.feet, sourceId: state.sourceId, time: state.time, nextEventSequence: state.nextEventSequence });
      if (!validatePlacement(candidate)) { nextRig.dispose(); return false; }
      applyPose(candidate, committedCallAge, committedReducedMotion, nextRig);
      const eye = nextRig.getEyeWorldPosition(new THREE.Vector3());
      const nextProjection = lastProjection ? { ...lastProjection, near: nativeNear(nextBody, lastProjection.verticalFovDegrees, lastProjection.aspect) } : null;
      const nextCamera = nextProjection ? resolve(candidate, nextProjection, 'third', 0, eye, committedReducedMotion, null) : null;
      if (nextCamera?.kind === 'blocked') { nextRig.dispose(); return false; }
      rig.root.removeFromParent(); rig.dispose(); rig = nextRig; body = nextBody; state = candidate; look = nextLook;
      parent.add(rig.root); camera = nextCamera; lastProjection = nextProjection; cameraMode = 'third'; posedEye = {x:eye.x,y:eye.y,z:eye.z}; version++; map.forgetActor('player-bird');
      lastEvents = []; applyPose(state, committedCallAge, committedReducedMotion); return true;
    },
    snapshot() {
      return { state: { ...state }, sole: nativeFeet(state), look, posedEye: { ...posedEye }, camera, cameraMode,
      lastFailure, blockedFrames, sessionId, sequence, batchSequence, version, modeVisits: { ...modeVisits }, events: lastEvents, recentEvents: [...recentEvents], rawEvents: [...rawRecent],
      body, tuning, mapStats: map.stats, quality: map.layout.quality,
      water: (mapQueries as MapNativeQueries).waterAt(nativeFeet(state)), waterPhase: Array.from(waterMesh.material.uniforms.uPhase.value as Float32Array),
      modelMetrics: disposedVisual?.modelMetrics ?? { ...rig.model.metrics }, rootPosition: disposedVisual?.rootPosition ?? rig.root.position.toArray(), npcs: { ...npcs.snapshot(), recentEvents: [...npcRecent] } }; },
    dispose() { if (disposed) return;
      disposedVisual = { modelMetrics: { ...rig.model.metrics }, rootPosition: rig.root.position.toArray() };
      disposed = true; rig.root.removeFromParent(); rig.dispose(); rememberNpcEvents(npcs.dispose()); map.dispose(); },
  };
}
