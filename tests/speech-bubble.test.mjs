import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { characterBubblePosition, updateCharacterBubble } from '../src/speech-bubble.ts';
import { createBirdRig } from '../src/native/ported/birds/rig-core/rig.ts';
import { createUrbanBird } from '../src/native/ported/birds/urban/models.ts';

const viewport = { left: 0, top: 0, width: 1200, height: 800 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function setup() {
  const camera = new THREE.PerspectiveCamera(60, 1.5, .05, 100);
  camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0);
  const character = new THREE.Mesh(new THREE.BoxGeometry(.4, .4, .4), new THREE.MeshBasicMaterial());
  return { camera, character };
}

test('bubble anchors outside the upper-right character bounds instead of at a fixed screen percentage', () => {
  const { camera, character } = setup();
  const result = characterBubblePosition(character, camera, viewport);
  assert.ok(result);
  const corner = new THREE.Vector3(.2, .2, .2).project(camera);
  near(result.left, (corner.x + 1) * viewport.width / 2 + 12);
  near(result.top, (1 - corner.y) * viewport.height / 2 - 12);
  assert.ok(result.left > viewport.width / 2); assert.ok(result.top < viewport.height / 2);
});

test('bubble follows character walking/flight translation and camera movement on the next update', () => {
  const { camera, character } = setup();
  const before = characterBubblePosition(character, camera, viewport);
  character.position.set(.6, .5, 0);
  const moved = characterBubblePosition(character, camera, viewport);
  assert.ok(moved.left > before.left); assert.ok(moved.top < before.top);
  camera.position.x = .9; camera.lookAt(.9, 0, 0);
  const cameraMoved = characterBubblePosition(character, camera, viewport);
  assert.ok(cameraMoved.left < moved.left);
});

test('camera orbit keeps the bubble above-right of a real posed pigeon rather than on its world-right side', () => {
  const rig = createBirdRig({ species: 'pigeon', lod: 0 }, createUrbanBird);
  const camera = new THREE.PerspectiveCamera(59, 1.5, .01, 100);
  try {
    rig.root.position.set(2, 3, -4);
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const mode of ['rest', 'walk', 'flap']) {
        rig.pose({ mode, time: 1, flapAge: .16, steps: .1 });
        camera.position.set(2 + Math.sin(heading) * 2, 3.7, -4 + Math.cos(heading) * 2);
        camera.lookAt(2, 3.15, -4);
        const result = characterBubblePosition(rig.root, camera, viewport); assert.ok(result);
        const centre = new THREE.Vector3(2, 3.15, -4).project(camera);
        assert.ok(result.left > (centre.x + 1) * viewport.width / 2);
        assert.ok(result.top < (1 - centre.y) * viewport.height / 2);
      }
    }
  } finally { rig.dispose(); }
});

test('resize uses CSS viewport dimensions and canvas offsets, independent of pixel ratio', () => {
  const { camera, character } = setup();
  const original = characterBubblePosition(character, camera, viewport);
  const resized = characterBubblePosition(character, camera, { left: 20, top: 30, width: 600, height: 400 });
  near(resized.left, 20 + (original.left - 12) / 2 + 12);
  near(resized.top, 30 + (original.top + 12) / 2 - 12);
});

test('hidden, off-screen, behind-camera and near-plane-crossing characters have no stray bubble', () => {
  const { camera, character } = setup();
  character.visible = false; assert.equal(characterBubblePosition(character, camera, viewport), null);
  character.visible = true;
  for (const position of [[100, 0, 0], [0, 100, 0], [0, 0, 10], [0, 0, 4.9]]) {
    character.position.set(...position);
    assert.equal(characterBubblePosition(character, camera, viewport), null);
  }
  character.position.set(0, 0, 0);
  assert.equal(characterBubblePosition(character, camera, { ...viewport, width: 0 }), null);
});

test('DOM update tracks each frame, expires cleanly, and hides first-person without changing the text', () => {
  const { camera, character } = setup();
  const bubble = { hidden: true, style: {}, textContent: '구구구' };
  updateCharacterBubble(bubble, character, camera, viewport, true);
  assert.equal(bubble.hidden, false); const before = bubble.style.left;
  character.position.x = .5;
  updateCharacterBubble(bubble, character, camera, viewport, true);
  assert.notEqual(bubble.style.left, before); assert.match(bubble.style.left, /px$/);
  updateCharacterBubble(bubble, character, camera, viewport, false); assert.equal(bubble.hidden, true);
  updateCharacterBubble(bubble, null, camera, viewport, true); assert.equal(bubble.hidden, true);
  assert.equal(bubble.textContent, '구구구');
  updateCharacterBubble(bubble, character, camera, viewport, true); assert.equal(bubble.hidden, false);
});
