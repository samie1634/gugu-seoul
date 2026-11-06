import * as THREE from 'three';
import { createWorld, locationName } from './world.ts';
import { makeBird, poseBird } from './bird.ts';
import { advanceBird, createBirdState, BODY_RADIUS } from './simulation.ts';
import { LOOKS, addPlayTime, loadProgress, freshProgress, saveProgress, unlocked, formatTime, type LookId, type StorageLike } from './progress.ts';
import { Controls, applyControlsGate, sampleControlsFrame } from './input.ts';
import { createFrameClock, isPlaying, resetFrameClock, type PlayGate } from './frame-clock.ts';
import { BirdAudio } from './audio.ts';
import { createNativeScene, NATIVE_PRESETS, type NativePreset } from './native/scene.ts';
import { transactNativeFrame } from './native/frame-transaction.ts';
import { nativeNear } from './native/body-profile.ts';
import { selectNativeLegacyLook } from './native/legacy-selection.ts';

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
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);
  const nativeEnabled = params.get('native') === 'b2';
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
  const native = nativeEnabled ? createNativeScene(scene, progress.look, { quality: coarse || innerWidth < 700 ? 'mobile' : 'desktop', preset: preset as NativePreset }) : null;
  const world = native?.world ?? createWorld(scene);
  let bird = native?.state ?? createBirdState();
  let rig = native ? null : makeBird(progress.look); if (rig) scene.add(rig.root);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.65, 24), new THREE.MeshBasicMaterial({ color: '#52694e', transparent: true, opacity: 0.17, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  if (native) shadow.visible = false;
  const camera = new THREE.PerspectiveCamera(59, innerWidth / innerHeight, 0.12, 2400);
  camera.position.set(140, 150, 310); camera.lookAt(-20, 6, -175);
  const controls = new Controls(element('joystick'), element('touch-flap'), element('touch-descend'));
  const looksDialog = element<HTMLDialogElement>('looks-dialog');
  const helpDialog = element<HTMLDialogElement>('help-dialog');
  const soundButton = element<HTMLButtonElement>('sound-button');
  const viewButton = element<HTMLButtonElement>('view-button');
  const canvas = renderer.domElement;
  let started = false;
  let contextUsable = true;
  let focused = document.hasFocus();
  let hidden = document.hidden;
  let paused = false;
  let gate: PlayGate = { enabled: false, focused, hidden, paused, dialogOpen: false };
  let clock = createFrameClock(gate);
  let firstPerson = false;
  let introPreviousTimestamp: number | null = null;
  let introTime = 0;
  let worldTime = 0;
  let savedAt = 0;
  let uiAt = 0;
  let nativeTick: { status: string; reason?: string; acceptedSeconds: number; rawSeconds: number } | null = null;
  let cooAge = 10;
  let walkedSinceCoo = 0;
  let toastUntil = 0;
  let storageWarningShown = false;
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const hit = new THREE.Vector3();
  const box = new THREE.Box3();
  const ray = new THREE.Ray();
  const anyDialog = () => looksDialog.open || helpDialog.open;
  const nativeEvidence = native ? document.createElement('script') : null;
  if (nativeEvidence) { nativeEvidence.type = 'application/json'; nativeEvidence.id = 'native-state'; document.body.appendChild(nativeEvidence); }
  function applyGate(): void {
    gate = { enabled: started && contextUsable, focused, hidden, paused, dialogOpen: anyDialog() };
    clock = applyControlsGate(controls, clock, gate);
    introPreviousTimestamp = null;
    if (!isPlaying(gate)) audio.setFlight(false);
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
    if (!unlocked(id, progress.activeSeconds)) return false;
    if (native) {
      if (!selectNativeLegacyLook(native,progress,id,{verticalFovDegrees:camera.fov,aspect:camera.aspect})) return false;
      id=progress.look;bird=native.state;
    }
    else if (rig) { scene.remove(rig.root); rig = makeBird(id); scene.add(rig.root); }
    progress.look = id; persist(); renderLooks();
    return true;
  }
  function coo(): void {
    if (!isPlaying(gate)) return;
    cooAge = 0; walkedSinceCoo = 0;
    element('coo-bubble').textContent = progress.look === 'owl' ? '후우, 후우' : '구구구';
    element('coo-bubble').hidden = false;
    audio.coo(progress.look === 'owl');
  }
  function setView(): void {
    if (!started) return;
    firstPerson = !firstPerson;
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
  controls.onCoo = coo;
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
    firstPerson = false;
    viewButton.setAttribute('aria-label', '비둘기 눈높이로 전환'); viewButton.setAttribute('aria-pressed', 'false');
    if (!native) camera.position.set(bird.x, 5, bird.z + 8);
    closeDialog(helpDialog); notify('광화문광장에 내려앉았어요.');
  });
  element('reset-button').addEventListener('click', () => { element('reset-confirm').hidden = false; element('confirm-reset').focus(); });
  element('cancel-reset').addEventListener('click', () => { element('reset-confirm').hidden = true; });
  element('confirm-reset').addEventListener('click', () => {
    if (native && !native.home('pigeon')) return;
    const muted = progress.muted; progress = freshProgress(); progress.muted = muted;
    setLook('pigeon'); bird = native?.state ?? createBirdState(); element('unlocked-dot').hidden = true;
    element('reset-confirm').hidden = true; closeDialog(helpDialog); notify('산책 기록을 처음으로 돌렸어요.');
  });
  function renderLooks(): void {
    const container = element('look-cards'); container.replaceChildren();
    for (const look of LOOKS) {
      const available = unlocked(look.id, progress.activeSeconds);
      const selected = look.id === progress.look;
      const button = document.createElement('button'); button.className = 'look-card'; button.disabled = !available;
      button.dataset.look = look.id; button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${look.name}${selected ? ', 선택됨' : available ? ', 선택 가능' : `, ${formatTime(look.seconds - progress.activeSeconds)} 후 열림`}`);
      button.innerHTML = `${lookIcon(look.id)}<strong>${look.name}</strong><small>${look.subtitle}</small><span class="look-state">${selected ? '지금의 나 ✓' : available ? '이 모습으로' : `남은 ${formatTime(look.seconds - progress.activeSeconds)}`}</span>`;
      button.addEventListener('click', () => { if (setLook(look.id)) notify(`${look.name} 모습으로 바꿨어요.`); });
      container.appendChild(button);
    }
    element('playtime').textContent = formatTime(progress.activeSeconds);
  }
  renderLooks();
  const modeText = { rest: '잠깐 쉬는 중', walk: '구구, 산책 중', flap: '펄럭!', glide: '활공 중', fall: '내려오는 중' };
  function updateUI(): void {
    element('location-name').textContent = locationName(bird.x, bird.z);
    element('flight-state').textContent = modeText[bird.mode];
    element('altitude').textContent = (native ? bird.y - native.state.body.centreToSoleM : Math.max(0, bird.y - BODY_RADIUS)).toFixed(1);
    element('mode-dot').classList.toggle('flying', !bird.grounded);
    const next = LOOKS.find(look => look.seconds > progress.activeSeconds);
    element('next-look').textContent = next ? `다음 모습까지 ${formatTime(next.seconds - progress.activeSeconds)}` : '모든 새 모습을 만났어요';
    // The small map is schematic, like the handcrafted world itself.
    const x = 4 + (bird.x + 650) / 1300 * 174;
    const z = 4 + (bird.z + 680) / 1260 * 178;
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
    target.set(bird.x, bird.y + 0.7, bird.z);
    if (firstPerson) {
      camera.position.set(bird.x + Math.sin(bird.heading) * 0.47, bird.y + 0.66, bird.z - Math.cos(bird.heading) * 0.47);
      target.set(camera.position.x + Math.sin(bird.heading) * 40, camera.position.y + Math.max(-3, Math.min(4, bird.vy * 0.28)), camera.position.z - Math.cos(bird.heading) * 40);
      camera.lookAt(target); return;
    }
    const distance = bird.grounded ? 7.8 : 10.4;
    desired.set(bird.x - Math.sin(bird.heading) * distance, bird.y + (bird.grounded ? 3.1 : 3.7), bird.z + Math.cos(bird.heading) * distance);
    direction.subVectors(desired, target); let length = direction.length(); direction.normalize(); ray.set(target, direction);
    for (const obstacle of world.obstacles) {
      box.min.set(obstacle.x - obstacle.width / 2 - 0.3, (obstacle.minY ?? 0) - 0.1, obstacle.z - obstacle.depth / 2 - 0.3);
      box.max.set(obstacle.x + obstacle.width / 2 + 0.3, obstacle.height + 0.3, obstacle.z + obstacle.depth / 2 + 0.3);
      if (box.containsPoint(target)) continue;
      if (ray.intersectBox(box, hit)) length = Math.min(length, Math.max(0.65, target.distanceTo(hit) - 0.4));
    }
    desired.copy(target).addScaledVector(direction, length);
    camera.position.lerp(desired, reducedMotion ? 1 : 1 - Math.exp(-6 * dt));
    camera.lookAt(target);
  }
  function frame(timestamp: number): void {
    let dt = 0;
    let activeStep = false;
    let playing = isPlaying(gate);
    let input: ReturnType<Controls['sample']> | null = null;
    if (native) {
      const near = nativeNear(native.state.body, camera.fov, camera.aspect);
      if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
      const beforeClock = clock;
      const tick = transactNativeFrame(beforeClock, timestamp, controls,
        (input, seconds) => native.prepare(input, seconds,
          { near: camera.near, verticalFovDegrees: camera.fov, aspect: camera.aspect },
          firstPerson ? 'first' : 'third', cooAge + seconds, reducedMotion), () => clock === beforeClock);
      clock = clock === beforeClock ? tick.clock : resetFrameClock(clock);
      nativeTick = { status: tick.status, reason: tick.reason, acceptedSeconds: tick.acceptedSeconds, rawSeconds: tick.rawSeconds };
      dt = tick.acceptedSeconds; playing = tick.playing; activeStep = tick.status === 'committed';
      bird = native.state;
      const winningNear=nativeNear(native.state.body,camera.fov,camera.aspect);
      if(camera.near!==winningNear){camera.near=winningNear;camera.updateProjectionMatrix();}
    } else {
      const tick = sampleControlsFrame(controls, clock, timestamp); clock = tick.clock;
      dt = tick.acceptedSeconds; playing = tick.playing; input = tick.input; activeStep = input !== null;
    }
    let introDelta = 0;
    if (!started && contextUsable && focused && !hidden) {
      if (introPreviousTimestamp !== null) introDelta = Math.min(0.1, Math.max(0, (timestamp - introPreviousTimestamp) / 1000));
      introPreviousTimestamp = timestamp; introTime += introDelta;
    } else introPreviousTimestamp = null;
    if (activeStep) {
      if (!native && input) advanceBird(bird, input, dt, world.obstacles);
      worldTime += dt;
      if (native ? native.events.some(event => event.type === 'flap') : input?.flapPressed) audio.flap();
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
    if (!native && rig) {
      rig.root.position.set(bird.x, bird.y + (bird.mode === 'walk' && !reducedMotion ? Math.sin(bird.steps * 8) * 0.035 : 0), bird.z);
      rig.root.rotation.set(bird.grounded ? 0 : Math.atan2(bird.vy, 22) * 0.25, -bird.heading, 0);
      rig.root.visible = !firstPerson;
      poseBird(rig, bird.mode, visualTime, bird.flapAge, bird.steps, cooAge);
      shadow.position.set(bird.x, bird.grounded ? bird.y - BODY_RADIUS + 0.025 : 0.24, bird.z);
      shadow.scale.setScalar(1 + Math.min(1.5, (bird.y - BODY_RADIUS) / 25));
      shadow.visible = !firstPerson && bird.y < 30;
    }
    if (cooAge > 1.05) element('coo-bubble').hidden = true;
    if (timestamp > toastUntil) element('toast').hidden = true;
    if (timestamp - uiAt > 100) { updateUI(); uiAt = timestamp; }
    if (!native) updateCamera(dt, introTime);
    else {
      if (started && native.camera) {
        camera.position.set(...native.camera.position); camera.up.set(...native.camera.up); camera.lookAt(...native.camera.lookAt);
      } else if (!started) updateCamera(0, introTime);
      const extent = bird.grounded ? 6 : 40;
      Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent }); sun.shadow.camera.updateProjectionMatrix();
      sun.target.position.set(bird.x, bird.y, bird.z); sun.position.copy(sun.target.position).add(new THREE.Vector3(-150, 280, 180));
      if (nativeEvidence) nativeEvidence.textContent = JSON.stringify({ ...native.snapshot(), clock, progress: { ...progress }, worldTime, cooAge, gate, requestedView: firstPerson ? 'first' : 'third',
        projection: { near: camera.near, verticalFovDegrees: camera.fov, aspect: camera.aspect }, nativeTick, frameTimestampMs: timestamp });
    }
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
