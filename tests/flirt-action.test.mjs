import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { flirtWeight } from '../src/flirt-action.ts';
import { defaultBuildRig } from '../src/species-core/assets.ts';
import { createInputState, reduceInput } from '../src/input-reducer.ts';

const base = { mode: 'rest', time: 0, steps: 0, flapAge: 10 };
const tips = rig => ['leftWing', 'rightWing'].map(side => {
  const wing = rig.model.pivots[side], mesh = wing.children[0], p = mesh.geometry.getAttribute('position');
  let tip = 0; for (let i = 1; i < p.count; i++) if (p.getX(i) > p.getX(tip)) tip = i;
  return mesh.localToWorld(mesh.getVertexPosition(tip, new THREE.Vector3()));
});
test('T emits one flirt command, never repeats while held and respects pause/dialog', () => {
  let state = createInputState({ enabled: true, focused: true, hidden: false, paused: false, dialogOpen: false });
  const key = { type: 'key-down', code: 'KeyT', repeat: false };
  let result = reduceInput(state, key); state = result.state; assert.equal(result.command, 'flirt');
  assert.equal(reduceInput(state, key).command, null);
  state = reduceInput(state, { type: 'key-up', code: 'KeyT' }).state;
  assert.equal(reduceInput(state, { ...key, fromDialog: true }).command, null);
  state = reduceInput(state, { type: 'gate', gate: { ...state.gate, paused: true } }).state;
  assert.equal(reduceInput(state, key).command, null);
});
test('flirt raises both attached wing tips into a triangle above the head, then restores rest', () => {
  for (const lod of [0, 1, 2]) {
    const rig = defaultBuildRig({ species: 'pigeon', lod });
    rig.pose(base); const resting = rig.model.pivots.leftWing.quaternion.clone();
    const shoulders = ['leftWing', 'rightWing'].map(s => rig.model.pivots[s].position.clone());
    rig.pose({ ...base, flirtAge: .7 }); rig.root.updateMatrixWorld(true);
    const [left, right] = tips(rig), eye = rig.getEyeWorldPosition(new THREE.Vector3());
    assert.ok(left.y > eye.y + .1 && right.y > eye.y + .1);
    assert.ok(Math.abs(left.x - right.x) < .025); assert.ok(Math.abs(left.y - right.y) < 1e-6);
    // User reference is a broad triangle, not edge-on vertical feather lines.
    const lowerEdges = ['leftWing', 'rightWing'].map(side => {
      const mesh = rig.model.pivots[side].children[0], p = mesh.geometry.getAttribute('position');
      const xs = [];
      for (let i = 0; i < p.count; i++) {
        const v = mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()));
        if (v.y > .15 && v.y < .24) xs.push(v.x);
      }
      return side === 'leftWing' ? Math.min(...xs) : Math.max(...xs);
    });
    assert.ok(lowerEdges[0] < -.12 && lowerEdges[1] > .12);
    assert.ok(lowerEdges[1] - lowerEdges[0] > 6 * Math.abs(left.x - right.x));
    assert.ok(rig.model.pivots.leftWing.position.equals(shoulders[0]));
    assert.ok(rig.model.pivots.rightWing.position.equals(shoulders[1]));
    rig.setLod(lod === 2 ? 1 : 2); assert.ok(rig.model.pivots.leftWing.quaternion.angleTo(resting) > .5);
    rig.pose({ ...base, flirtAge: 1.8 }); assert.ok(rig.model.pivots.leftWing.quaternion.angleTo(resting) < 1e-7);
    rig.dispose();
  }
});
test('flirt does not replace flight, walk, food or opponent peck poses', () => {
  const rig = defaultBuildRig({ species: 'pigeon', lod: 1 });
  for (const extra of [{ mode: 'flap' }, { mode: 'walk' }, { peckAge: .2 }, { opponentPeckAge: .18 }]) {
    rig.pose({ ...base, ...extra }); const before = rig.model.pivots.leftWing.quaternion.clone();
    rig.pose({ ...base, ...extra, flirtAge: .7 }); assert.ok(before.angleTo(rig.model.pivots.leftWing.quaternion) < 1e-7);
  }
  rig.dispose();
});
test('flirt curve is finite, continuous at rise/hold/fall and ends neutrally', () => {
  assert.equal(flirtWeight(0), 0); assert.equal(flirtWeight(.7), 1); assert.equal(flirtWeight(1.8), 0);
  for (const boundary of [.45, 1.2, 1.8]) assert.ok(Math.abs(flirtWeight(boundary - 1e-6) - flirtWeight(boundary + 1e-6)) < 1e-4);
  for (const bad of [-1, NaN, Infinity]) assert.equal(flirtWeight(bad), 0);
});
