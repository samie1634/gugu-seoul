import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePigeonTakeoff, PIGEON_TAKEOFF_VALID_SECONDS } from '../src/pigeon-takeoff-intent.ts';

const input={forward:.8,turn:.3,flapPressed:false,flapHeld:false,descend:false,peckHeld:true,peckReleased:true};
const flap={...input,flapPressed:true,flapHeld:true};
const ctx={eligible:true,atRest:true,readiness:'idle',simTime:1};
const plan=(controls,before=null,more={})=>preparePigeonTakeoff(controls,before,{...ctx,...more});

test('preparing an exact first takeoff queues only the flap and leaves other controls live', () => {
  const t=plan(flap);
  assert.deepEqual(t.input,{...input,flapPressed:false,flapHeld:false});
  assert.deepEqual(t.pending,{expiresAt:1+PIGEON_TAKEOFF_VALID_SECONDS});
  assert.equal(flap.flapPressed,true,'original sample and rollback input are untouched');
  assert.deepEqual(plan(input,t.pending,{readiness:'loading',simTime:4}),{input,pending:t.pending});
});

test('one queued tap on readiness uses the current hold, including release while waiting', () => {
  const p=plan(flap).pending;
  for (const flapHeld of [false,true]) {
    const current={...input,flapHeld};
    const result=plan(current,p,{readiness:'ready',simTime:5});
    assert.deepEqual(result,{input:{...current,flapPressed:true},pending:null});
    assert.strictEqual(plan(current,result.pending,{readiness:'ready',simTime:6}).input,current);
  }
  assert.deepEqual(plan(flap,p,{readiness:'ready',simTime:5}),{input:flap,pending:null});
});

test('fresh input supersedes an earlier pending touch, and a bounded stale action never launches', () => {
  const first=plan(flap).pending;
  const latest=plan(flap,first,{simTime:3,readiness:'loading'}).pending;
  assert.equal(latest.expiresAt,3+PIGEON_TAKEOFF_VALID_SECONDS);
  assert.deepEqual(plan(input,latest,{simTime:latest.expiresAt,readiness:'ready'}),{input,pending:null});
  assert.deepEqual(plan(input,latest,{simTime:latest.expiresAt,readiness:'fallback'}),{input,pending:null});
  assert.deepEqual(plan(flap,null,{simTime:20,readiness:'ready'}),{input:flap,pending:null});
});

test('failure falls back once; descent, incompatible accessibility or already airborne invalidate stale intent', () => {
  const p=plan(flap).pending;
  const fallback=plan(input,p,{readiness:'fallback'});
  assert.deepEqual(fallback,{input:{...input,flapPressed:true},pending:null});
  assert.deepEqual(plan(input,fallback.pending,{readiness:'fallback'}),{input,pending:null});
  for (const ignored of [{eligible:false},{atRest:false}]) {
    assert.deepEqual(plan(input,p,ignored),{input,pending:null});
    assert.deepEqual(plan(flap,p,ignored),{input:flap,pending:null});
  }
  const descent={...input,descend:true};
  assert.deepEqual(plan(descent,p,{readiness:'ready'}),{input:descent,pending:null});
});
