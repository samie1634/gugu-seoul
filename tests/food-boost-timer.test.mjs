import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createFoodBoost, advanceFoodBoost, foodBoostDisplay, flightTuningAfterFood, NORMAL_FLIGHT_TUNING, FED_FLIGHT_TUNING } from '../src/native/flight-feeding.ts';
import { createNativeScene } from '../src/native/scene.ts';
import { createNativeMotionState, advanceNativeMotion } from '../src/native/ported/motion/locomotion/b2/native-motion.ts';
import { nativeNear } from '../src/native/body-profile.ts';
import { PIGEON_FED_TUNING, PIGEON_PLAYER_TUNING } from '../src/pigeon-kinematics.ts';
const idle = { forward: 0, turn: 0, flapPressed: false, flapHeld: false, descend: false };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`);

test('each meal adds a full ten seconds instead of resetting or permanently enabling boost', () => {
  let state = createFoodBoost();
  assert.equal(foodBoostDisplay(state).label, '0초');
  state = advanceFoodBoost(state, .05, 1); assert.equal(state.remainingSeconds, 10);
  for (let i = 0; i < 100; i++) state = advanceFoodBoost(state, .05, 1);
  near(state.remainingSeconds, 5);
  state = advanceFoodBoost(state, .05, 2); near(state.remainingSeconds, 14.95);
  assert.equal(foodBoostDisplay(state).label, '15초'); near(state.capacitySeconds, 14.95);
  state = advanceFoodBoost(state, .05, 4); near(state.remainingSeconds, 34.9);
  for (let i = 0; i < 698; i++) state = advanceFoodBoost(state, .05, 4);
  assert.equal(state.remainingSeconds, 0); assert.equal(foodBoostDisplay(state).label, '0초');
  assert.equal(flightTuningAfterFood(state.remainingSeconds), NORMAL_FLIGHT_TUNING);
  state = advanceFoodBoost(state, .05, 5); assert.equal(state.remainingSeconds, 10);
});

test('paused, invalid, replayed or decreasing food counts cannot grant time or drain it twice', () => {
  const state = advanceFoodBoost(createFoodBoost(), .05, 2);
  for (const seconds of [0, -1, .2, NaN, Infinity]) assert.equal(advanceFoodBoost(state, seconds, 3), state);
  for (const eaten of [1, -1, 2.5, NaN, Infinity]) assert.equal(advanceFoodBoost(state, .05, eaten), state);
  near(advanceFoodBoost(state, .05, 2).remainingSeconds, 19.95);
});

test('accepted play time is frame-rate independent and the bar tracks the current accumulated duration', () => {
  for (const hz of [30, 60, 120]) {
    let state = advanceFoodBoost(createFoodBoost(), 1 / hz, 1);
    for (let i = 0; i < 10 * hz; i++) state = advanceFoodBoost(state, 1 / hz, 1);
    assert.equal(state.remainingSeconds, 0);
  }
  let state = advanceFoodBoost(createFoodBoost(), .1, 3);
  for (let i = 0; i < 100; i++) state = advanceFoodBoost(state, .1, 3);
  const display = foodBoostDisplay(state); near(display.remainingSeconds / display.capacitySeconds, 2 / 3);
  assert.equal(display.active, true);
});

test('walking speed doubles only while the boost is active, including backwards movement', () => {
  const support = { id: 'floor', layerId: 'ground', surface: 'stone', height: 0, normal: { x: 0, y: 1, z: 0 }, walkable: true, landable: true };
  const world = { supportAt: () => support, sweepBody: () => null };
  for (const forward of [-1, 1]) {
    for (const [normal, boosted] of [[NORMAL_FLIGHT_TUNING, FED_FLIGHT_TUNING], [PIGEON_PLAYER_TUNING, PIGEON_FED_TUNING]]) {
      const states = [normal, boosted].map(tuning => {
        let state = createNativeMotionState({ feet: { x: 0, y: 0, z: 0 }, tuning }); state.support = support;
        for (let i = 0; i < 30; i++) state = advanceNativeMotion(state, { ...idle, forward }, .05, world).state;
        return state;
      });
      near(Math.hypot(states[1].vx, states[1].vz), Math.hypot(states[0].vx, states[0].vz) * 2);
      near(Math.abs(states[1].z), Math.abs(states[0].z) * 2);
      assert.equal(states[0].y, states[1].y);
    }
  }
});

test('scene starts the timer only on committed food contact and preserves it through pause, Home and appearance changes', () => {
  const engine = createNativeScene(new THREE.Scene(), 'pigeon', { quality: 'mobile' });
  const prepare = (age = Infinity, seconds = .05) => engine.prepare(idle, seconds,
    { near: nativeNear(engine.state.body, 59, 16 / 9), verticalFovDegrees: 59, aspect: 16 / 9 }, 'third', 10, false, age);
  const step = age => { const p = prepare(age); assert.equal(p.kind, 'ready'); p.commit(); };
  try {
    const uncommitted = prepare(.25); assert.equal(uncommitted.kind, 'ready'); assert.equal(engine.foodBoost.remainingSeconds, 0);
    for (const age of [0, .05, .1, .15, .2, .25]) step(age);
    assert.equal(engine.foodBoost.eaten, 1); assert.equal(engine.foodBoost.remainingSeconds, 10);
    const before = engine.foodBoost;
    const preview = prepare(); assert.equal(preview.kind, 'ready'); assert.equal(engine.foodBoost, before);
    assert.equal(prepare(Infinity, 0).kind, 'blocked'); assert.equal(engine.foodBoost, before);
    engine.world.update(1000, 1000); assert.equal(engine.foodBoost, before);
    assert.equal(engine.selectLook('white'), true); assert.equal(engine.foodBoost, before);
    assert.equal(engine.home(), true); assert.equal(engine.foodBoost, before);
    assert.equal(preview.isCurrent(), false); assert.throws(() => preview.commit()); assert.equal(engine.foodBoost, before);
    step(); near(engine.foodBoost.remainingSeconds, 9.95); assert.deepEqual(engine.state.tuning, PIGEON_FED_TUNING);
    near(engine.state.tuning.walkSpeed,.38);
    near(engine.state.tuning.flightSpeed * 3.6,70); near(engine.state.tuning.glideSpeed * 3.6,60);
    for (let i = 0; i < 199; i++) step();
    assert.equal(engine.foodBoost.remainingSeconds, 0); step();
    assert.deepEqual(engine.state.tuning, PIGEON_PLAYER_TUNING, 'white pigeon returns to its calibrated ordinary speeds');
  } finally { engine.dispose(); }
});

test('the requested lower-right bar is noninteractive and does not overlap mobile touch buttons', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(html, /<progress id="food-boost-bar" max="10" value="0" aria-label="가속 잔여 시간"/);
  assert.match(css, /\.food-boost \{[^}]*position: fixed;[^}]*right:[^}]*bottom:[^}]*pointer-events: none;/);
  assert.match(main, /foodBoostDisplay\(native.foodBoost\)/); assert.match(main, /foodBoostPanel.hidden = !native/);
  // The 23px desktop bar + 4px bottom gap fits below the panel's 29px
  // bottom and the keyboard hint's lowest 28px bottom, including tablet widths.
  assert.ok(23 + 4 < 28);
  assert.match(css, /bottom: calc\(env\(safe-area-inset-bottom\) \+ 4px\); width: 156px; padding: 2px 9px 3px;/);
  for (const [width, height, safeBottom, safeRight] of [[320, 480, 0, 0], [390, 844, 34, 0], [568, 320, 21, 44], [844, 390, 21, 47]]) {
    // Analytic CSS budget, not a rendered screenshot: 10px label + 3px bar +
    // 1px gap + 5px padding + 2px border = 21px, ending 2px above the safe inset.
    const bar = { left: width - Math.max(23, safeRight) - 98, top: height - safeBottom - 2 - 21, width: 98, height: 21 };
    assert.ok(bar.left >= 0 && bar.top >= 0);
    const flapBottom = height - safeBottom - 24;
    assert.ok(bar.top > flapBottom, 'bar is below the flap touch target');
    assert.ok(bar.top + bar.height <= height - safeBottom);
  }
});
