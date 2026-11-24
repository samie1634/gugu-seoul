import assert from 'node:assert/strict';
import test from 'node:test';
import { paintPose, variantScale } from '../src/native/ported/npcs/models/pose.ts';
import { PROFILES } from '../src/native/ported/npcs/src/profiles.ts';

const EPS = 1e-9;
const TYPES = ['dog', 'cat'];
const VISUAL_STRIDE = { dog: .26, cat: .245 };

test('visual pet strides leave the v41 simulation and footstep-audio stride intact', () => {
  assert.equal(PROFILES.dog.stride,.8);
  assert.equal(PROFILES.cat.stride,.58);
  for (const kind of TYPES) assert.notEqual(PROFILES[kind].stride,VISUAL_STRIDE[kind]);
});

function sample(kind, gaitDistance, speed = PROFILES[kind].walkSpeed, variant = 1, bodyScale = 1, action = 'walk') {
  const pose = { kind, gaitDistance, speed, variant, bodyScale, action, age: 0.8 };
  let region;
  const paws = [];
  let links = 0;
  paintPose(pose, {
    region(name) { region = name; },
    part(shape, x, y, z, w, h, d) {
      if (region === 'limbs' && shape === 'block') paws.push({ x, y: y - h / 2, z, d });
    },
    link() { if (region === 'limbs') links++; },
  });
  const scale = variantScale(pose);
  assert.equal(paws.length, 4);
  assert.equal(links, 8);
  return paws.map(({ x, y, z, d }) => ({ x: x * scale, y: y * scale, z: z * scale, d: d * scale }));
}

test('dog and cat maintain support and cancel straight level root travel on steady stance', () => {
  for (const kind of TYPES) for (const variant of [0, 1, 7]) for (const scale of [0.82, 1, 1.13]) {
    const stride = VISUAL_STRIDE[kind] * scale;
    const speed = PROFILES[kind].walkSpeed * scale * 0.5;
    const step = stride / 256;
    let previous = sample(kind, 0, speed, variant, scale);
    let stanceChecks = 0;
    for (let i = 1; i <= 512; i++) {
      const paws = sample(kind, i * step, speed, variant, scale);
      assert.ok(paws.filter(p => p.y <= EPS).length >= 2, `${kind} @ ${i}`);
      assert.ok(paws.every(p => Number.isFinite(p.y) && p.y >= -EPS));
      for (const [index, paw] of paws.entries()) if (paw.y <= EPS && previous[index].y <= EPS) {
        assert.ok(Math.abs(paw.z - previous[index].z - step) < EPS, `${kind} planted paw ${index} slid`);
        stanceChecks++;
      }
      previous = paws;
    }
    assert.ok(stanceChecks >= 1000);
  }
});

test('dog and cat have distinct fore/hind cadence and paw arc heights', () => {
  function measure(kind) {
    const stride = VISUAL_STRIDE[kind];
    const n = 400;
    const touched = [0, 0, 0, 0], lifts = [0, 0, 0, 0], swings = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) for (const [j, paw] of sample(kind, i * stride / n).entries()) {
      if (paw.y <= EPS) touched[j]++;
      else if (!swings[j]) swings[j] = i;
      lifts[j] = Math.max(lifts[j], paw.y);
    }
    return { touched, lifts, swingLead: (swings[0] - swings[1]) / n };
  }
  const dog = measure('dog'), cat = measure('cat');
  assert.ok(cat.touched[0] > dog.touched[0]);
  assert.ok(dog.lifts[0] > cat.lifts[0] && dog.lifts[1] > cat.lifts[1]);
  assert.ok(dog.swingLead > 0.24 && dog.swingLead < 0.26);
  assert.ok(cat.swingLead > 0.15 && cat.swingLead < 0.17);
});

test('same-side fore and hind paw meshes retain longitudinal clearance throughout the cycle', () => {
  for (const kind of TYPES) for (let variant = 0; variant < 8; variant++) {
    for (let i = 0; i < 512; i++) {
      const paws = sample(kind, i * VISUAL_STRIDE[kind] / 512, PROFILES[kind].fleeSpeed, variant, 1, 'startle');
      for (const index of [0, 2]) {
        const a = paws[index], b = paws[index + 1];
        assert.ok(b.z - a.z - (a.d + b.d) / 2 > 0.005, `${kind} same-side paw overlap`);
      }
    }
  }
});

test('paw cycles join and remain continuous through stop and startle speed thresholds', () => {
  for (const kind of TYPES) {
    const { walkSpeed } = PROFILES[kind];
    const stride = VISUAL_STRIDE[kind];
    const assertNear = (a, b, tolerance) => {
      for (const [i, p] of a.entries()) assert.ok(Math.hypot(p.y - b[i].y, p.z - b[i].z) < tolerance);
    };
    for (const fraction of [0, 0.18, 0.43, 0.71, 0.98]) {
      const distance = fraction * stride;
      const stopped = sample(kind, distance, 0);
      assert.ok(stopped.every(p => Math.abs(p.y) < EPS));
      assertNear(stopped, sample(kind, distance, 0.0001), 1e-5);
      assertNear(sample(kind, distance, walkSpeed * 1.4 - 0.0001, 1, 1, 'startle'),
        sample(kind, distance, walkSpeed * 1.4 + 0.0001, 1, 1, 'startle'), 1e-4);
    }
    assertNear(sample(kind, stride - 0.000001), sample(kind, stride + 0.000001), 1e-5);
  }
});
