import { PigeonNames } from './multiplayer/labels.ts';
import { MultiplayerClient, httpTransport } from './multiplayer/client.ts';
import { RemoteBirds } from './multiplayer/renderer.ts';
import { drawRealMinimap, minimapPoint } from './native/ported/map/real-map/minimap.ts';
import * as THREE from 'three';
import { createWorld, locationName } from './world.ts';
import { makeBird, poseBird } from './bird.ts';
import { advanceBird, createBirdState, BODY_RADIUS } from './simulation.ts';
import { LOOKS, addPlayTime, loadProgress, freshProgress, saveProgress, unlocked, formatTime, type LookId, type StorageLike } from './progress.ts';
import { Controls, applyControlsGate, sampleControlsFrame } from './input.ts';
import { CameraOrbitControls } from './camera-orbit.ts';
import { cameraRelativeMovement, turnCameraOrbit } from './camera-relative-movement.ts';
import { resolveCamera } from './native/ported/motion/controls/camera-resolver.ts';
import { createFrameClock, isPlaying, resetFrameClock, type PlayGate } from './frame-clock.ts';
import { BirdAudio } from './audio.ts';
import { createNativeScene, NATIVE_PRESETS, type NativePreset } from './native/scene.ts';
import { transactNativeFrame } from './native/frame-transaction.ts';
import { nativeNear } from './native/body-profile.ts';
import { selectNativeLegacyLook } from './native/legacy-selection.ts';
import { useIntegratedScene } from './entry-mode.ts';
import { updateCharacterBubble } from './speech-bubble.ts';
import { foodBoostDisplay } from './native/flight-feeding.ts';
import { createDayCycle } from './day-cycle.ts';
import { isOwlNight } from './native/owl-night.ts';
import { createGroundPigeon, isGroundLandingBlend } from './pigeon-ground.ts';
import { createFlightPigeon } from './pigeon-flight.ts';
import { preparePigeonTakeoff, type PigeonTakeoffIntent } from './pigeon-takeoff-intent.ts';
import { pigeonPeckClockDelta } from './pigeon-kinematics.ts';

const element = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing interface element: ${id}`);
  return value as T;
};

function boot(): void {
  let storage: StorageLike | null = null;
  try { storage = window.localStorage; } catch { /* Storage may be disabled. */ }
  let progress = loadProgress(storage);
  const audio = new BirdAudio(); audio.muted = progress.muted;
  let heardPigeonFlockTakeoff = 0;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);
  // The integrated scene is the normal experience. Keep an explicit legacy
  // route for comparison and recovery without changing saved progress.
  const nativeEnabled = useIntegratedScene(params);
  const preset = params.get('native-preset') ?? 'plaza';
  if (nativeEnabled && !NATIVE_PRESETS.includes(preset as NativePreset)) throw new Error('Unknown native QA preset');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.35 : 1.65));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '비둘기로 걷고 나는 서울 3D 화면');
  element('world').appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#c1d6d3');
  scene.fog = new THREE.Fog('#c8d7c9', 380, 1850);
  const sky = new THREE.HemisphereLight('#f6f6dd', '#a4b49a', 1.6); scene.add(sky);
  const sun = new THREE.DirectionalLight('#fff0ce', 2.35);
  sun.position.set(-260, 410, 260); sun.target.position.set(0, 0, -110); sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -390, right: 390, top: 420, bottom: -380, near: 20, far: 1000 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  if (nativeEnabled) {
    scene.background = new THREE.Color('#c0cdd1'); scene.fog = new THREE.Fog('#c0cdd1', 280, 1700);
    sky.color.set('#e6f0f4'); sky.groundColor.set('#797867'); sky.intensity = 1.15;
    sun.color.set('#fff0dc'); sun.intensity = 3.2;
    sun.shadow.bias = -0.000001; sun.shadow.normalBias = 0.0005;
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 900 });
    sun.shadow.camera.updateProjectionMatrix();
  }
  const native = nativeEnabled ? createNativeScene(scene, progress.look, { mapData: params.get('map')==='procedural'?'procedural':'osm', quality: coarse || innerWidth < 700 ? 'mobile' : 'desktop', preset: preset as NativePreset }) : null;
  if(native?.map.layout.realMap)drawRealMinimap(document.getElementById('map') as unknown as SVGSVGElement,native.map.layout.realMap);
  const world = native?.world ?? createWorld(scene);
  const multiplayerWorld = native ? (params.get('map') === 'procedural' ? 'native-procedural' : 'native-osm') : 'legacy';
  const multiplayer = new MultiplayerClient(httpTransport(import.meta.env.VITE_MULTIPLAYER_URL || 'https://gugu-seoul-multiplayer.idea-dental.chatgpt.site/api/multiplayer'));
  const remoteBirds = new RemoteBirds(scene, multiplayerWorld, reducedMotion);
  const pigeonNames = new PigeonNames(document.body);
  const pauseMultiplayer = () => { multiplayer.pause(); remoteBirds.clear(); pigeonNames.clear(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseMultiplayer(); });
  window.addEventListener('pagehide', pauseMultiplayer);
  let bird = native?.state ?? createBirdState();
  const groundPigeon = native ? createGroundPigeon(scene, import.meta.env.BASE_URL) : null;
  const flightPigeon = native ? createFlightPigeon(scene, import.meta.env.BASE_URL) : null;
  let committedDescent = false;
  let takeoffIntent: PigeonTakeoffIntent | null = null;
  let previousGroundSteps = bird.steps, lastGroundLanding = -Infinity;
  let rig = native ? null : makeBird(progress.look); if (rig) scene.add(rig.root);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.65, 24), new THREE.MeshBasicMaterial({ color: '#52694e', transparent: true, opacity: 0.17, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  if (native) shadow.visible = false;
  const camera = new THREE.PerspectiveCamera(59, innerWidth / innerHeight, 0.12, 2400);
  const dayCycle = native ? createDayCycle(scene, sky, sun, { quality: native.map.layout.quality, reducedMotion, layout: native.map.layout, clouds: native.clouds.platforms }) : null;
  void dayCycle?.load();
  camera.position.set(140, 150, 310); camera.lookAt(-20, 6, -175);
  const controls = new Controls(element('joystick'), element('touch-flap'), element('touch-descend'), element('touch-peck'));
  const looksDialog = element<HTMLDialogElement>('looks-dialog');
  const helpDialog = element<HTMLDialogElement>('help-dialog');
  const soundButton = element<HTMLButtonElement>('sound-button');
  const viewButton = element<HTMLButtonElement>('view-button');
  const canvas = renderer.domElement;
  const cooBubble = element('coo-bubble');
  const foodBoostPanel = element('food-boost');
  const foodBoostBar = element<HTMLProgressElement>('food-boost-bar');
  const foodBoostTime = element('food-boost-time');
  foodBoostPanel.hidden = !native;
  let started = false;
  let contextUsable = true;
  let focused = document.hasFocus();
  let hidden = document.hidden;
  let paused = false;
  let gate: PlayGate = { enabled: false, focused, hidden, paused, dialogOpen: false };
  let clock = createFrameClock(gate);
  let firstPerson = false, committedGroundFirstPerson = false;
  let introPreviousTimestamp: number | null = null;
  let introTime = 0;
  let worldTime = 0;
  let savedAt = 0;
  let uiAt = 0;
  let nextFlockAudioCheck = 0;
  let nextCityAudioCheck = 0;
  let nativeTick: { status: string; reason?: string; acceptedSeconds: number; rawSeconds: number } | null = null;
  let cooAge = 10;
  let peckAge = 10, flirtAge = Infinity, manualPeckSerial = 0;
  let walkedSinceCoo = 0;
  let toastUntil = 0;
  let storageWarningShown = false;
  const direction = new THREE.Vector3();
  const cameraOrbit = new CameraOrbitControls(canvas, () => {
    camera.getWorldDirection(direction);
    return Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
  });
  const anyDialog = () => looksDialog.open || helpDialog.open;
  const nativeEvidence = native ? document.createElement('script') : null;
  if (nativeEvidence) { nativeEvidence.type = 'application/json'; nativeEvidence.id = 'native-state'; document.body.appendChild(nativeEvidence); }
  function applyGate(): void {
    gate = { enabled: started && contextUsable, focused, hidden, paused, dialogOpen: anyDialog() };
    audio.setActive(isPlaying(gate));
    clock = applyControlsGate(controls, clock, gate);
    cameraOrbit.setEnabled(isPlaying(gate));
    introPreviousTimestamp = null;
    if (!isPlaying(gate)) { takeoffIntent = null; audio.setFlight(false); native?.cancelHunt(); }
  }
  applyGate();

  function notify(message: string, duration = 3): void {
    element('toast').textContent = message; element('toast').hidden = false;
    toastUntil = performance.now() + duration * 1000;
  }
  function persist(): void {
    const saved = saveProgress(storage, progress);
    if (!saved && started && !storageWarningShown) {
      storageWarningShown = true; notify('이 브라우저에서는 산책 기록이 저장되지 않아요.', 5);
    }
  }
  function setLook(id: LookId): boolean {
    if (!unlocked(id, progress.activeSeconds) || (id === 'owl' && progress.look !== 'owl' && !isOwlNight(native?.state.time ?? worldTime))) return false;
    if (native) {
      if (!selectNativeLegacyLook(native,progress,id,{verticalFovDegrees:camera.fov,aspect:camera.aspect})) return false;
      id=progress.look;bird=native.state;
    }
    else if (rig) { scene.remove(rig.root); rig = makeBird(id); scene.add(rig.root); }
    audio.cancelPigeonCoo(); takeoffIntent = null;
    progress.look = id; peckAge = 10; committedDescent = false; groundPigeon?.reset(); previousGroundSteps = bird.steps; lastGroundLanding = -Infinity; persist(); renderLooks();
    return true;
  }
  function coo(): void {
    if (!isPlaying(gate)) return;
    if (!progress.muted && audio.needsUnlock) void audio.start();
    if (audio.pigeonCooMotion) { walkedSinceCoo = 0; return; }
    cooAge = 0; walkedSinceCoo = 0;
    cooBubble.textContent = progress.look === 'owl' ? '후우, 후우' : '구구구';
    audio.coo(progress.look === 'owl');
  }
  function setView(): void {
    if (!started) return;
    cameraOrbit.cancel();
    firstPerson = !firstPerson; takeoffIntent = null;
    viewButton.setAttribute('aria-label', firstPerson ? '뒤에서 보는 시점으로 전환' : '비둘기 눈높이로 전환');
    viewButton.setAttribute('aria-pressed', String(firstPerson));
    canvas.focus({ preventScroll: true });
  }
  function updateSoundButton(): void {
    soundButton.setAttribute('aria-pressed', String(progress.muted));
    soundButton.setAttribute('aria-label', progress.muted ? '소리 켜기' : '소리 끄기');
    soundButton.title = progress.muted ? '소리 켜기' : '소리 끄기';
  }
  updateSoundButton();
  soundButton.addEventListener('click', () => {
    progress.muted = !progress.muted; audio.setMuted(progress.muted); updateSoundButton(); persist();
    if (started) { void audio.start(); canvas.focus({ preventScroll: true }); }
  });
  element('start-button').addEventListener('click', () => {
    started = true; document.body.dataset.started = 'true'; element('intro').hidden = true;
    canvas.focus({ preventScroll: true }); focused = document.hasFocus();
    applyGate(); void audio.start(); persist();
  });
  document.addEventListener('pointerup', event => {
    if (event.isTrusted && started && !progress.muted && audio.needsUnlock) void audio.start();
  }, { capture: true, passive: true });
  controls.onCoo = coo;
  controls.onPeck = () => { if (isPlaying(gate) && bird.grounded) { peckAge = 0; manualPeckSerial++; flirtAge = Infinity; } };
  const flirt = () => {
    if (isPlaying(gate) && native && bird.grounded && bird.mode === 'rest' && progress.look !== 'owl' && peckAge >= .5 && flirtAge >= 1.8) flirtAge = 0;
  };
  controls.onFlirt = flirt;
  element('touch-flirt').addEventListener('click', flirt);
  controls.onView = setView;
  controls.onPause = () => {
    if (!started) return;
    if (anyDialog()) { closeDialog(looksDialog); closeDialog(helpDialog); }
    else openDialog(helpDialog);
  };
  element('touch-coo').addEventListener('click', coo);
  viewButton.addEventListener('click', setView);
  function openDialog(dialog: HTMLDialogElement): void {
    persist(); renderLooks(); element('reset-confirm').hidden = true;
    dialog.showModal(); applyGate();
  }
  function closeDialog(dialog: HTMLDialogElement): void {
    if (!dialog.open) return;
    dialog.close();
    // The native close event is queued; clear the gate synchronously as well.
    canvas.focus({ preventScroll: true }); focused = document.hasFocus(); applyGate();
  }
  for (const dialog of [looksDialog, helpDialog]) {
    dialog.querySelector<HTMLButtonElement>('.close-dialog')!.addEventListener('click', () => closeDialog(dialog));
    dialog.addEventListener('close', () => {
      canvas.focus({ preventScroll: true }); focused = document.hasFocus(); applyGate();
    });
  }
  element('looks-button').addEventListener('click', () => { element('unlocked-dot').hidden = true; openDialog(looksDialog); });
  element('help-button').addEventListener('click', () => openDialog(helpDialog));
  element('resume-button').addEventListener('click', () => closeDialog(helpDialog));
  element('home-button').addEventListener('click', () => {
    if (native) { if (!native.home()) return; bird = native.state; }
    else bird = createBirdState();
    groundPigeon?.reset(); previousGroundSteps = bird.steps; lastGroundLanding = -Infinity;
    firstPerson = false; committedGroundFirstPerson = false; committedDescent = false; peckAge = 10; takeoffIntent = null;
    cameraOrbit.reset();
    viewButton.setAttribute('aria-label', '비둘기 눈높이로 전환'); viewButton.setAttribute('aria-pressed', 'false');
    if (!native) camera.position.set(bird.x, 5, bird.z + 8);
    closeDialog(helpDialog); notify('광화문광장에 내려앉았어요.');
  });
  element('reset-button').addEventListener('click', () => { element('reset-confirm').hidden = false; element('confirm-reset').focus(); });
  element('cancel-reset').addEventListener('click', () => { element('reset-confirm').hidden = true; });
  element('confirm-reset').addEventListener('click', () => {
    if (native && !native.home('pigeon')) return;
    cameraOrbit.reset();
    const muted = progress.muted; progress = freshProgress(); progress.muted = muted;
    setLook('pigeon'); bird = native?.state ?? createBirdState(); element('unlocked-dot').hidden = true;
    element('reset-confirm').hidden = true; closeDialog(helpDialog); notify('산책 기록을 처음으로 돌렸어요.');
  });
  function renderLooks(): void {
    const container = element('look-cards'); container.replaceChildren();
    for (const look of LOOKS) {
      const available = unlocked(look.id, progress.activeSeconds) && (look.id !== 'owl' || look.id === progress.look || isOwlNight(native?.state.time ?? worldTime));
      const selected = look.id === progress.look;
      const nightLocked = look.id === 'owl' && !selected && unlocked(look.id, progress.activeSeconds) && !isOwlNight(native?.state.time ?? worldTime);
      const button = document.createElement('button'); button.className = 'look-card'; button.disabled = !available;
      button.dataset.look = look.id; button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${look.name}${selected ? ', 선택됨' : nightLocked ? ', 밤에 선택 가능' : available ? ', 선택 가능' : `, ${formatTime(look.seconds - progress.activeSeconds)} 후 열림`}`);
      button.innerHTML = `${lookIcon(look.id)}<strong>${look.name}</strong><small>${look.subtitle}</small><span class="look-state">${selected ? '지금의 나 ✓' : nightLocked ? '밤에 선택 가능' : available ? '이 모습으로' : `남은 ${formatTime(look.seconds - progress.activeSeconds)}`}</span>`;
      button.addEventListener('click', () => { if (setLook(look.id)) notify(`${look.name} 모습으로 바꿨어요.`); });
      container.appendChild(button);
    }
    element('playtime').textContent = formatTime(progress.activeSeconds);
  }
  renderLooks();
  const modeText = { rest: '잠깐 쉬는 중', walk: '구구, 산책 중', flap: '펄럭!', glide: '활공 중', fall: '내려오는 중' };
  function updateUI(): void {
    element('location-name').textContent = (native?.map.layout.realMap ? realLocationName(bird.x,bird.z) : locationName(bird.x, bird.z));
    element('flight-state').textContent = modeText[bird.mode];
    element('altitude').textContent = (native ? bird.y - native.state.body.centreToSoleM : Math.max(0, bird.y - BODY_RADIUS)).toFixed(1);
    element('speed').textContent = (Math.hypot(bird.vx,bird.vy,bird.vz)*3.6).toFixed(1);
    element('mode-dot').classList.toggle('flying', !bird.grounded);
    if (native) {
      const boost = foodBoostDisplay(native.foodBoost);
      foodBoostPanel.classList.toggle('active', boost.active);
      foodBoostBar.max = boost.capacitySeconds;
      foodBoostBar.value = boost.remainingSeconds;
      foodBoostBar.setAttribute('aria-valuetext', boost.label);
      foodBoostTime.textContent = boost.label;
    }
    const next = LOOKS.find(look => look.seconds > progress.activeSeconds);
    element('next-look').textContent = next ? `다음 모습까지 ${formatTime(next.seconds - progress.activeSeconds)}` : '모든 새 모습을 만났어요';
    // The geographic scene and minimap share one metric coordinate transform.
    const [x,z] = native?.map.layout.realMap ? minimapPoint(native.map.layout.realMap,bird.x,bird.z) : [4+(bird.x+650)/1300*174,4+(bird.z+680)/1260*178];
    document.getElementById('map-player')!.setAttribute('transform', `translate(${x.toFixed(2)} ${z.toFixed(2)}) rotate(${bird.heading * 180 / Math.PI})`);
  }
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden; focused = document.hasFocus(); applyGate();
    if (hidden) persist();
  });
  window.addEventListener('focus', () => { focused = true; applyGate(); });
  window.addEventListener('blur', () => { focused = false; applyGate(); persist(); });
  window.addEventListener('pagehide', () => { paused = true; applyGate(); persist(); });
  window.addEventListener('pageshow', () => {
    paused = false; hidden = document.hidden; focused = document.hasFocus(); applyGate();
  });
  window.addEventListener('resize', () => {
    cameraOrbit.cancel();
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); contextUsable = false; applyGate(); persist();
    element('fatal-error').hidden = false;
  });
  element('retry-button').addEventListener('click', () => location.reload());

  function updateCamera(dt: number, introTime: number): void {
    if (!started) {
      camera.position.set(140 + (reducedMotion ? 0 : Math.sin(introTime * 0.04) * 28), 150, 310);
      camera.lookAt(-20, 6, -175); return;
    }
    if (dt <= 0) return;
    const resolved = resolveCamera({ bird, mode: firstPerson ? 'first' : 'third', obstacles: world.obstacles,
      dt, previousPosition: camera.position.toArray(), reducedMotion, orbit: cameraOrbit.angles,
      projection: { near: camera.near, verticalFovDegrees: camera.fov, aspect: camera.aspect } });
    if (resolved.kind === 'resolved') {
      camera.position.set(...resolved.position); camera.up.set(0, 1, 0); camera.lookAt(...resolved.lookAt);
    }
  }
  const movementView = new THREE.Vector3();
  function frame(timestamp: number): void {
    const movementHeadingBefore = bird.heading;
    camera.getWorldDirection(movementView);
    const manualInput = (sample: ReturnType<Controls['sample']>) => cameraRelativeMovement(sample, movementView.toArray(), movementHeadingBefore);
    let dt = 0;
    let activeStep = false;
    let cameraTurn = 0;
    let playing = isPlaying(gate);
    let input: ReturnType<Controls['sample']> | null = null;
    if (native) {
      const near = nativeNear(native.state.body, camera.fov, camera.aspect);
      if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
      const beforeClock = clock;
      let candidateDescent = committedDescent, candidateTakeoff = takeoffIntent;
      const tick = transactNativeFrame(beforeClock, timestamp, controls,
        (input, seconds) => {
          cameraTurn = input.cameraTurn ?? 0;
          candidateDescent = input.descend;
          const takeoff = preparePigeonTakeoff(input, takeoffIntent, {
            eligible: !!flightPigeon && native.look === 'pigeon' && !firstPerson && !reducedMotion,
            atRest: native.state.grounded || native.state.mode === 'rest',
            readiness: flightPigeon?.readiness ?? 'fallback', simTime: native.state.time,
          });
          candidateTakeoff = takeoff.pending;
          return native.prepare(manualInput(takeoff.input), seconds,
          { near: camera.near, verticalFovDegrees: camera.fov, aspect: camera.aspect },
          firstPerson ? 'first' : 'third', cooAge + seconds, reducedMotion, peckAge + pigeonPeckClockDelta(native.look, seconds),
          turnCameraOrbit(cameraOrbit.angles, cameraTurn, seconds), flirtAge + seconds,
          !!groundPigeon?.ready && !firstPerson && !reducedMotion && native.look === 'pigeon' &&
            bird.mode === 'rest' && !isGroundLandingBlend(native.state.time - lastGroundLanding));
        }, () => clock === beforeClock);
      clock = clock === beforeClock ? tick.clock : resetFrameClock(clock);
      nativeTick = { status: tick.status, reason: tick.reason, acceptedSeconds: tick.acceptedSeconds, rawSeconds: tick.rawSeconds };
      dt = tick.acceptedSeconds; playing = tick.playing; activeStep = tick.status === 'committed';
      bird = native.state;
      if (activeStep) {
        committedDescent = candidateDescent; takeoffIntent = candidateTakeoff;
        cameraOrbit.rebaseHeading(movementHeadingBefore, bird.heading, cameraTurn, dt);
      }
      const winningNear=nativeNear(native.state.body,camera.fov,camera.aspect);
      if(camera.near!==winningNear){camera.near=winningNear;camera.updateProjectionMatrix();}
    } else {
      const tick = sampleControlsFrame(controls, clock, timestamp); clock = tick.clock;
      dt = tick.acceptedSeconds; playing = tick.playing; input = tick.input ? manualInput(tick.input) : null; activeStep = input !== null;
    }
    let introDelta = 0;
    if (!started && contextUsable && focused && !hidden) {
      if (introPreviousTimestamp !== null) introDelta = Math.min(0.1, Math.max(0, (timestamp - introPreviousTimestamp) / 1000));
      introPreviousTimestamp = timestamp; introTime += introDelta;
    } else introPreviousTimestamp = null;
    if (activeStep) {
      if(native && worldTime >= nextFlockAudioCheck){
        nextFlockAudioCheck=worldTime+2;
        audio.flockCall(native.snapshot().flock.birds,bird,worldTime);
      }
      if(native && worldTime >= nextCityAudioCheck){
        nextCityAudioCheck = worldTime + .2;
        const humans=native.snapshot().npcs.states;
        const pairs=humans.filter(a=>a.action==='talk'&&a.talkPartnerId&&a.id<a.talkPartnerId).flatMap(a=>{
          const b=humans.find(b=>b.id===a.talkPartnerId&&b.action==='talk'&&b.talkPartnerId===a.id);
          return b?[{id:a.id+':'+b.id,visible:true,x:(a.x+b.x)/2,y:(a.y+b.y)/2+1.4,z:(a.z+b.z)/2}]:[];
        });
        audio.cityAmbience(bird,pairs,native.traffic.snapshot().states);
      }
      peckAge += pigeonPeckClockDelta(native?.look, dt);
      flirtAge = bird.grounded && bird.mode === 'rest' ? flirtAge + dt : Infinity;
      if (!native && input) {
        advanceBird(bird, input, dt, world.obstacles, progress.look === 'owl' && !isOwlNight(worldTime) ? .5 : 1);
        cameraOrbit.rebaseHeading(movementHeadingBefore, bird.heading, input.cameraTurn, dt);
      }
      worldTime += dt;
      if (native ? native.events.some(event => event.type === 'flap') : input?.flapPressed) audio.flap();
      if (native?.events.some(event => event.type === 'water-enter')) audio.splash();
      for (const event of native?.events ?? []) {
        if (event.type === 'npc-audio' && event.cue === 'human-scream' && event.npcState?.humanGender === 'female') audio.humanScream(event.id, event.actorId, event.position, bird);
      }
      if (native && native.pigeonFlockTakeoffSequence !== heardPigeonFlockTakeoff) {
        heardPigeonFlockTakeoff = native.pigeonFlockTakeoffSequence;
        audio.flockTakeoff();
      }
      const newLooks = addPlayTime(progress, dt, true);
      if (newLooks.length) {
        const name = LOOKS.find(look => look.id === newLooks[0])!.name;
        notify(`${name} 모습이 열렸어요. ‘모습’에서 골라보세요.`, 5);
        element('unlocked-dot').hidden = false; persist();
      }
      cooAge += dt;
      if (bird.mode === 'walk') walkedSinceCoo += dt;
      if (walkedSinceCoo > 5.5) coo();
      audio.setFlight(!bird.grounded);
      if (timestamp - savedAt > 2000) { persist(); savedAt = timestamp; }
    } else if (!playing || native) audio.setFlight(false);
    const visualTime = introTime + worldTime;
    world.update(visualTime, started ? dt : introDelta);
    let groundVisual = false, flightVisual = false;
    if (native && groundPigeon) {
      // A blocked native transaction must not hide the last committed player/camera view.
      if (activeStep) committedGroundFirstPerson = firstPerson;
      if (activeStep && native.events.some(event => event.type === 'land')) lastGroundLanding = native.state.time;
      const distance = Math.max(0, bird.steps - previousGroundSteps);
      previousGroundSteps = bird.steps;
      const backward = bird.vx * Math.sin(bird.heading) - bird.vz * Math.cos(bird.heading) < 0;
      groundVisual = groundPigeon.update(native.state, {
        committedSeconds: activeStep ? dt : 0, distance: backward ? -distance : distance,
        started, firstPerson: committedGroundFirstPerson, look: native.look, reducedMotion, cooAge,
        cooMotion: audio.pigeonCooMotion,
        manualPeckAge: peckAge, manualPeckSerial, manualPeckKind:native.peckKind, flirtAge, landedRecently: isGroundLandingBlend(native.state.time - lastGroundLanding),
      });
      flightVisual = flightPigeon?.update(native.state, native.root, {
        started, firstPerson: committedGroundFirstPerson, look: native.look, reducedMotion, descend: committedDescent,
        preload: groundPigeon.ready || groundPigeon.snapshot().loadState === 'fallback', committedSeconds: activeStep ? dt : 0,
      }) ?? false;
      native.root.visible = !committedGroundFirstPerson && !groundVisual && !flightVisual;
    }
    if (!native && rig) {
      rig.root.position.set(bird.x, bird.y + (bird.mode === 'walk' && !reducedMotion ? Math.sin(bird.steps * 8) * 0.035 : 0), bird.z);
      rig.root.rotation.set(bird.grounded ? 0 : Math.atan2(bird.vy, 22) * 0.25, -bird.heading, 0);
      rig.root.visible = !firstPerson;
      poseBird(rig, bird.mode, visualTime, bird.flapAge, bird.steps, cooAge);
      shadow.position.set(bird.x, bird.grounded ? bird.y - BODY_RADIUS + 0.025 : 0.24, bird.z);
      shadow.scale.setScalar(1 + Math.min(1.5, (bird.y - BODY_RADIUS) / 25));
      shadow.visible = !firstPerson && bird.y < 30;
    }
    if (timestamp > toastUntil) element('toast').hidden = true;
    if (timestamp - uiAt > 100) { updateUI(); uiAt = timestamp; }
    if (!native) {
      updateCamera(dt, introTime);
    }
    else {
      if (started && native.camera) {
        camera.position.set(...native.camera.position); camera.up.set(...native.camera.up); camera.lookAt(...native.camera.lookAt);
      } else if (!started) updateCamera(0, introTime);
      const extent = bird.grounded ? 6 : 40;
      Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent }); sun.shadow.camera.updateProjectionMatrix();
      dayCycle?.update(native.state.time, camera, bird);
      if (nativeEvidence) nativeEvidence.textContent = JSON.stringify({ ...native.snapshot(), dayCycle: dayCycle?.snapshot(), cloudCount: native.clouds.platforms.length, groundPigeon: groundPigeon?.snapshot(), flightPigeon: flightPigeon?.snapshot(), clock, progress: { ...progress }, worldTime, cooAge, gate, motionControls: { reducedMotion, manualPeckSerial, peckAge,
          takeoffQueued: !!takeoffIntent, takeoffSecondsLeft: takeoffIntent ? Math.max(0, takeoffIntent.expiresAt - native.state.time) : 0 }, requestedView: firstPerson ? 'first' : 'third',
        displayedCamera: { position: camera.position.toArray(), direction: camera.getWorldDirection(direction).toArray(), orbit: cameraOrbit.angles },
        projection: { near: camera.near, verticalFovDegrees: camera.fov, aspect: camera.aspect }, nativeTick, frameTimestampMs: timestamp });
    }
    updateCharacterBubble(cooBubble, native?.root ?? rig?.root ?? null, camera, canvas.getBoundingClientRect(), started && !firstPerson && cooAge <= 1.05);
    multiplayer.update({ x: bird.x, y: bird.y, z: bird.z, heading: bird.heading,
      pitch: native ? native.root.rotation.x : (bird.grounded ? 0 : Math.atan2(bird.vy, 22) * .25),
      roll: native?.root.rotation.z ?? 0, mode: bird.mode, grounded: bird.grounded, look: progress.look,
      time: native?.state.time ?? visualTime, vx:bird.vx,vy:bird.vy,vz:bird.vz, steps: bird.steps, flapAge: bird.flapAge, peckAge, cooAge,
      world: multiplayerWorld, ...(native ? {appearance: native.appearance} : {}),
    }, playing && !document.hidden);
    remoteBirds.update(multiplayer.peers.sample(performance.now()));
    const namedBirds=remoteBirds.namedBirds();
    const localRoot=native?.root??rig?.root;
    if(!firstPerson && localRoot)namedBirds.push({id:'local-player',nameSeed:multiplayer.nameSeed,character:groundVisual && groundPigeon ? groundPigeon.root : flightVisual && flightPigeon ? flightPigeon.root : localRoot,head:native?localRoot.getObjectByName('head')??localRoot:rig!.head});
    pigeonNames.update(namedBirds,camera,canvas.getBoundingClientRect(),playing&&!document.hidden);
    renderer.render(scene, camera); requestAnimationFrame(frame);
  }
  updateUI(); requestAnimationFrame(frame);
  console.info('Gugu Seoul ready: handcrafted map and local synthesized audio.');
}

function lookIcon(id: LookId): string {
  if (id === 'owl') return '<svg viewBox="0 0 100 90" aria-hidden="true"><ellipse cx="50" cy="62" rx="24" ry="24" fill="#967858"/><path d="m29 31-4-18 18 10h14l18-10-4 24" fill="#6a5944"/><ellipse cx="50" cy="38" rx="26" ry="23" fill="#a68a62"/><ellipse cx="38" cy="39" rx="13" ry="15" fill="#dbc99b"/><ellipse cx="62" cy="39" rx="13" ry="15" fill="#dbc99b"/><circle cx="38" cy="38" r="7" fill="#d3a34e"/><circle cx="62" cy="38" r="7" fill="#d3a34e"/><circle cx="38" cy="38" r="4" fill="#30463b"/><circle cx="62" cy="38" r="4" fill="#30463b"/><path d="m46 47 4 7 4-7" fill="#66543d"/><path d="m39 66 3 8m16-8-3 8m-6-10v12" stroke="#dac398" stroke-width="3" stroke-linecap="round"/></svg>';
  const white = id === 'white';
  return `<svg viewBox="0 0 100 90" aria-hidden="true"><path d="m20 65-10 7 16 2" fill="${white ? '#d6d4c6' : '#586875'}"/><ellipse cx="46" cy="58" rx="28" ry="22" fill="${white ? '#faf6e7' : '#9ca9af'}"/><ellipse cx="43" cy="60" rx="21" ry="13" transform="rotate(-17 43 60)" fill="${white ? '#e6e4d6' : '#778c96'}"/><path d="m48 43 8-15 15 5 1 20" fill="${white ? '#f6f0df' : '#5c8c78'}"/><circle cx="67" cy="30" r="15" fill="${white ? '#faf6e7' : '#859da4'}"/><path d="m80 31 10 5-12 3" fill="#bf9d7f"/><circle cx="71" cy="28" r="3.4" fill="#cf9957"/><circle cx="71" cy="28" r="1.8" fill="#29483e"/><path d="m43 78-1 7m18-8 2 7" stroke="#b98373" stroke-width="2.6" stroke-linecap="round"/></svg>`;
}

try { boot(); }
catch (error) {
  console.error('Unable to initialize Gugu Seoul', error);
  element('fatal-error').hidden = false; element('intro').hidden = true;
  element('retry-button').addEventListener('click', () => location.reload());
}

function realLocationName(x:number,z:number):string{
  if(z>390)return'청계천';
  if(x<-260&&z<-240)return'광화문';
  if(x<-260)return'광화문광장';
  return'종로';
}
