import * as THREE from 'three';
import { createWorld, locationName } from './world.ts';
import { makeBird, poseBird } from './bird.ts';
import { advanceBird, createBirdState, BODY_RADIUS } from './simulation.ts';
import { LOOKS, addPlayTime, loadProgress, freshProgress, saveProgress, unlocked, formatTime, type LookId, type StorageLike } from './progress.ts';
import { Controls } from './input.ts';
import { BirdAudio } from './audio.ts';

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
  scene.add(new THREE.HemisphereLight('#f6f6dd', '#a4b49a', 1.6));
  const sun = new THREE.DirectionalLight('#fff0ce', 2.35);
  sun.position.set(-260, 410, 260); sun.target.position.set(0, 0, -110); sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -390, right: 390, top: 420, bottom: -380, near: 20, far: 1000 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const world = createWorld(scene);
  let bird = createBirdState();
  let rig = makeBird(progress.look); scene.add(rig.root);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.65, 24), new THREE.MeshBasicMaterial({ color: '#52694e', transparent: true, opacity: 0.17, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  const camera = new THREE.PerspectiveCamera(59, innerWidth / innerHeight, 0.12, 2400);
  camera.position.set(140, 150, 310); camera.lookAt(-20, 6, -175);
  const controls = new Controls(element('joystick'), element('touch-flap'), element('touch-descend'));
  const looksDialog = element<HTMLDialogElement>('looks-dialog');
  const helpDialog = element<HTMLDialogElement>('help-dialog');
  const soundButton = element<HTMLButtonElement>('sound-button');
  const viewButton = element<HTMLButtonElement>('view-button');
  const canvas = renderer.domElement;
  let started = false;
  let firstPerson = false;
  let lastFrame = performance.now();
  let worldTime = 0;
  let savedAt = 0;
  let uiAt = 0;
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
  const playing = () => started && !anyDialog() && !document.hidden;

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
  function setLook(id: LookId): void {
    if (!unlocked(id, progress.activeSeconds)) return;
    scene.remove(rig.root); rig = makeBird(id); scene.add(rig.root);
    progress.look = id; persist(); renderLooks();
  }
  function coo(): void {
    if (!playing()) return;
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
    controls.enabled = true; lastFrame = performance.now(); void audio.start();
    canvas.focus({ preventScroll: true }); persist();
  });
  controls.onCoo = coo;
  controls.onView = setView;
  controls.onPause = () => {
    if (!started) return;
    if (anyDialog()) { looksDialog.close(); helpDialog.close(); }
    else openDialog(helpDialog);
  };
  element('touch-coo').addEventListener('click', coo);
  viewButton.addEventListener('click', setView);
  function openDialog(dialog: HTMLDialogElement): void {
    controls.enabled = false; controls.reset(); audio.setFlight(false); persist(); renderLooks();
    element('reset-confirm').hidden = true; dialog.showModal();
  }
  for (const dialog of [looksDialog, helpDialog]) {
    dialog.querySelector<HTMLButtonElement>('.close-dialog')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      controls.reset(); controls.enabled = started && !document.hidden && !anyDialog();
      lastFrame = performance.now(); canvas.focus({ preventScroll: true });
    });
  }
  element('looks-button').addEventListener('click', () => { element('unlocked-dot').hidden = true; openDialog(looksDialog); });
  element('help-button').addEventListener('click', () => openDialog(helpDialog));
  element('resume-button').addEventListener('click', () => helpDialog.close());
  element('home-button').addEventListener('click', () => {
    bird = createBirdState(); firstPerson = false;
    viewButton.setAttribute('aria-label', '비둘기 눈높이로 전환'); viewButton.setAttribute('aria-pressed', 'false');
    camera.position.set(bird.x, 5, bird.z + 8); helpDialog.close(); notify('광화문광장에 내려앉았어요.');
  });
  element('reset-button').addEventListener('click', () => { element('reset-confirm').hidden = false; element('confirm-reset').focus(); });
  element('cancel-reset').addEventListener('click', () => { element('reset-confirm').hidden = true; });
  element('confirm-reset').addEventListener('click', () => {
    const muted = progress.muted; progress = freshProgress(); progress.muted = muted;
    setLook('pigeon'); bird = createBirdState(); element('unlocked-dot').hidden = true;
    element('reset-confirm').hidden = true; helpDialog.close(); notify('산책 기록을 처음으로 돌렸어요.');
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
      button.addEventListener('click', () => { setLook(look.id); notify(`${look.name} 모습으로 바꿨어요.`); });
      container.appendChild(button);
    }
    element('playtime').textContent = formatTime(progress.activeSeconds);
  }
  renderLooks();
  const modeText = { rest: '잠깐 쉬는 중', walk: '구구, 산책 중', flap: '펄럭!', glide: '활공 중', fall: '내려오는 중' };
  function updateUI(): void {
    element('location-name').textContent = locationName(bird.x, bird.z);
    element('flight-state').textContent = modeText[bird.mode];
    element('altitude').textContent = Math.max(0, bird.y - BODY_RADIUS).toFixed(1);
    element('mode-dot').classList.toggle('flying', !bird.grounded);
    const next = LOOKS.find(look => look.seconds > progress.activeSeconds);
    element('next-look').textContent = next ? `다음 모습까지 ${formatTime(next.seconds - progress.activeSeconds)}` : '모든 새 모습을 만났어요';
    // The small map is schematic, like the handcrafted world itself.
    const x = 4 + (bird.x + 650) / 1300 * 174;
    const z = 4 + (bird.z + 680) / 1260 * 178;
    document.getElementById('map-player')!.setAttribute('transform', `translate(${x.toFixed(2)} ${z.toFixed(2)}) rotate(${bird.heading * 180 / Math.PI})`);
  }
  document.addEventListener('visibilitychange', () => {
    controls.reset(); controls.enabled = started && !document.hidden && !anyDialog();
    lastFrame = performance.now(); if (document.hidden) { persist(); audio.setFlight(false); }
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('blur', () => { controls.reset(); audio.setFlight(false); persist(); });
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); controls.enabled = false; persist(); audio.setFlight(false);
    element('fatal-error').hidden = false;
  });
  element('retry-button').addEventListener('click', () => location.reload());

  function updateCamera(dt: number, introTime: number): void {
    if (!started) {
      camera.position.set(140 + (reducedMotion ? 0 : Math.sin(introTime * 0.04) * 28), 150, 310);
      camera.lookAt(-20, 6, -175); return;
    }
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
    const dt = Math.min(0.25, Math.max(0, (timestamp - lastFrame) / 1000)); lastFrame = timestamp;
    const active = playing(); controls.enabled = active;
    if (!document.hidden && (!started || active)) worldTime += dt;
    if (active) {
      const input = controls.sample(); advanceBird(bird, input, dt, world.obstacles);
      if (input.flapPressed) audio.flap();
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
    } else audio.setFlight(false);
    world.update(worldTime, !started || active ? Math.min(dt, 0.1) : 0);
    rig.root.position.set(bird.x, bird.y + (bird.mode === 'walk' && !reducedMotion ? Math.sin(bird.steps * 8) * 0.035 : 0), bird.z);
    rig.root.rotation.set(bird.grounded ? 0 : Math.atan2(bird.vy, 22) * 0.25, -bird.heading, 0);
    rig.root.visible = !firstPerson;
    poseBird(rig, bird.mode, worldTime, bird.flapAge, bird.steps, cooAge);
    shadow.position.set(bird.x, bird.grounded ? bird.y - BODY_RADIUS + 0.025 : 0.24, bird.z);
    shadow.scale.setScalar(1 + Math.min(1.5, (bird.y - BODY_RADIUS) / 25));
    shadow.visible = !firstPerson && bird.y < 30;
    if (cooAge > 1.05) element('coo-bubble').hidden = true;
    if (timestamp > toastUntil) element('toast').hidden = true;
    if (timestamp - uiAt > 100) { updateUI(); uiAt = timestamp; }
    updateCamera(Math.min(dt, 0.1), worldTime);
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
