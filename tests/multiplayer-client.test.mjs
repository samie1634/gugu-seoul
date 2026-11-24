import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PeerBuffer, validState } from '../src/multiplayer/state.ts';
import { MultiplayerClient, createSessionKey, httpTransport } from '../src/multiplayer/client.ts';
import { RemoteBirds } from '../src/multiplayer/renderer.ts';
const state=(extra={})=>({x:0,y:.2,z:0,heading:0,pitch:0,roll:0,mode:'rest',grounded:true,look:'pigeon',time:10,steps:0,flapAge:10,peckAge:10,cooAge:10,world:'native-osm',...extra});
const snap=(sequence=1,s=state(),extra={})=>({v:1,type:'snapshot',selfId:'self',serverTime:1000+sequence,peers:[{id:'other',sequence,updatedAt:1000+sequence,state:s}],...extra});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('validates states and discards malformed, self and stale peers',()=>{
  assert.equal(validState(state({x:Infinity})),false);
  assert.equal(validState(state({appearance:{speciesId:'unknown',skinId:'default'}})),false);
  const b=new PeerBuffer();b.accept(snap(1,state(),{peers:[{id:'self',sequence:1,updatedAt:1001,state:state()}]}),0);
  assert.equal(b.sample(0).size,0);
  b.accept(snap(),0);assert.equal(b.sample(5001).size,0);
});
test('interpolates position and shortest yaw, rejects out-of-order, snaps reset, removes departed peers',()=>{
  const b=new PeerBuffer();b.accept(snap(1,state({heading:3.1})),0);
  b.accept(snap(2,state({x:10,heading:-3.1})),250);
  assert.equal(b.sample(375).get('other').x,5);
  assert.ok(Math.abs(b.sample(375).get('other').heading-Math.PI)<.001);
  b.accept(snap(1,state({x:-9})),400);assert.equal(b.sample(500).get('other').x,10);
  b.accept(snap(3,state({x:100,time:0})),600);assert.equal(b.sample(600).get('other').x,100);
  b.accept(snap(4,state(),{peers:[]}),700);assert.equal(b.sample(700).size,0);
});
test('call and peck resets arrive without blending away their onset',()=>{
  const b=new PeerBuffer();b.accept(snap(),0);b.accept(snap(2,state({cooAge:0,peckAge:0})),250);
  assert.equal(b.sample(250).get('other').peckAge,0);
  assert.equal(b.sample(350).get('other').cooAge,.1);
});
test('single exchange, 250ms pacing, hidden leave, fresh key and obsolete completion guard',async()=>{
  let now=0,resolve,keys=0;const sent=[],left=[];
  const c=new MultiplayerClient({exchange(m){sent.push(m);return new Promise(r=>{resolve=r;});},leave(...args){left.push(args);}},()=>now,()=>`key-${++keys}`);
  c.update(state(),true);c.update(state(),true);assert.equal(sent.length,1);
  c.pause();assert.equal(left.length,1);resolve(snap());await flush();assert.equal(c.peers.sample(now).size,0);
  c.update(state(),true);assert.equal(sent[1].sessionKey,'key-2');resolve(snap());await flush();
  now=249;c.update(state(),true);assert.equal(sent.length,2);
  now=250;c.update(state(),true);assert.equal(sent.length,3);resolve(snap(2));await flush();c.pause();
});
test('failure backs off and does not spin; session keys are anonymous random hex',async()=>{
  let now=0,calls=0;const c=new MultiplayerClient({async exchange(){calls++;throw Error('offline');},leave(){}},()=>now,()=> 'key');
  c.update(state(),true);await flush();now=499;c.update(state(),true);assert.equal(calls,1);
  now=500;c.update(state(),true);await flush();assert.equal(calls,2);c.pause();
  const a=createSessionKey(),b=createSessionKey();assert.match(a,/^[0-9a-f]{64}$/);assert.notEqual(a,b);
});
test('native remote rigs use physical centre-to-sole, exact appearance and dispose on disappearance',()=>{
  const scene=new THREE.Scene(),r=new RemoteBirds(scene,'native-osm',false);
  r.update(new Map([['a',state({y:4,appearance:{speciesId:'pigeon',skinId:'white'}})]]));
  const first=r.root.children[0];assert.equal(first.userData.remotePlayer,true);assert.ok(first.position.y<4);assert.equal(first.scale.x,1);
  r.update(new Map([['a',state({appearance:{speciesId:'eagle-owl',skinId:'default'}})]]));assert.notEqual(r.root.children[0],first);assert.equal(first.parent,null);
  r.update(new Map([['b',state({world:'legacy'})]]));assert.equal(r.root.children.length,0);
});

test('HTTP transport sends bounded anonymous POSTs without cookies and uses keepalive only for leave',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,...init});return {ok:true,json:async()=>snap()};};
  try {
    const t=httpTransport('https://example.invalid/api/multiplayer');
    await t.exchange({v:1,type:'state',sessionKey:'a'.repeat(64),sequence:1,state:state()},new AbortController().signal);
    t.leave('a'.repeat(64),2);await flush();
    assert.equal(calls[0].headers['Content-Type'],'text/plain;charset=UTF-8');assert.equal(calls[1].headers['Content-Type'],'text/plain;charset=UTF-8');
    assert.equal(calls[0].credentials,'omit');assert.equal(calls[0].cache,'no-store');assert.equal(calls[0].method,'POST');
    assert.ok(calls[0].body.length<2048);assert.equal(calls[0].keepalive,false);
    assert.equal(calls[1].keepalive,true);assert.equal(JSON.parse(calls[1].body).type,'leave');
  } finally { globalThis.fetch=original; }
});

test('malformed appearances and impossible coordinates never reach the render path',()=>{
  for (const appearance of [null,false,0,'',[],{speciesId:'pigeon',skinId:'invalid'}]) {
    const s=state({appearance});assert.equal(validState(s),false);
    const b=new PeerBuffer();b.accept(snap(1,s),0);assert.equal(b.sample(0).size,0);
  }
  for (const bad of [{x:10001},{y:5001},{y:-501},{cooAge:-1}]) assert.equal(validState(state(bad)),false);
  const b=new PeerBuffer();assert.equal(b.accept(snap(1,state(),{peers:Array(25).fill(snap().peers[0])}),0),false);
});
test('removing remote legacy birds never disposes shared local geometry or material',()=>{
  const scene=new THREE.Scene(),r=new RemoteBirds(scene,'legacy',false);
  r.update(new Map([['a',state({world:'legacy'})]]));
  let disposals=0;
  r.root.children[0].traverse(o=>{if(o.isMesh){o.geometry.addEventListener('dispose',()=>disposals++);o.material.addEventListener('dispose',()=>disposals++);}});
  r.clear();assert.equal(disposals,0);assert.equal(r.root.children.length,0);
});
