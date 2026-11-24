import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PeerBuffer} from '../src/multiplayer/state.ts';
import {MultiplayerClient} from '../src/multiplayer/client.ts';
const state={x:0,y:0,z:0,heading:0,pitch:0,roll:0,time:1,steps:0,flapAge:10,peckAge:10,cooAge:10,mode:'rest',grounded:true,look:'pigeon',world:'native-osm'};
const packet=(sequence=1,updatedAt=1000,serverTime=1000,extra={})=>({v:1,type:'snapshot',selfId:'self',serverTime,peers:[{id:'other',sequence,updatedAt,state}],...extra});
const flush=()=>new Promise(r=>setImmediate(r));
test('missing grace retains legacy 5-second expiry; advertised grace is strictly bounded',()=>{
 const old=new PeerBuffer();assert(old.accept(packet(),0));assert.equal(old.sample(5001).size,0);
 for(const bad of [null,'20000',NaN,Infinity,0,4999,20001,20000.5])assert.equal(new PeerBuffer().accept(packet(1,1000,1000,{staleAfterMs:bad}),0),false);
 for(const good of [5000,20000])assert(new PeerBuffer().accept(packet(1,1000,1000,{staleAfterMs:good}),0));
});
test('grace subtracts the existing server age instead of giving old state another full window',()=>{
 const b=new PeerBuffer();b.accept(packet(1,1000,12000,{staleAfterMs:20000}),500);
 assert.equal(b.sample(9500).size,1);assert.equal(b.sample(9501).size,0);
 const future=new PeerBuffer();future.accept(packet(1,1001,1000,{staleAfterMs:20000}),0);assert.equal(future.sample(0).size,0);
});
test('an 8.43-second request gap keeps last known presence, then accepts fresh movement',()=>{
 const b=new PeerBuffer();b.accept(packet(1,1000,1000,{staleAfterMs:20000}),0);
 assert.equal(b.sample(8430).size,1);assert.equal(b.sample(8430).get('other').x,0);
 const next=packet(2,9430,9430,{staleAfterMs:20000});next.peers[0].state={...state,x:3};b.accept(next,8430);
 assert.equal(b.sample(9000).get('other').x,3);assert.equal(b.sample(28431).size,0);
});
test('same or lower sequences never extend the deadline or resurrect an expired track',()=>{
 const b=new PeerBuffer();b.accept(packet(2,1000,1000,{staleAfterMs:20000}),0);
 b.accept(packet(2,1000,2000,{staleAfterMs:20000}),10000);b.accept(packet(1,1000,3000,{staleAfterMs:20000}),15000);
 assert.equal(b.sample(20001).size,0);
 b.accept(packet(2,1000,4000,{staleAfterMs:20000}),20002);assert.equal(b.sample(20002).size,0);
 b.accept(packet(2,1000,21001,{staleAfterMs:20000}),25000);assert.equal(b.sample(25000).size,0);
 b.accept(packet(3,21002,21002,{staleAfterMs:20000}),25001);assert.equal(b.sample(25001).size,1);
});
test('shorter advertised grace reduces an existing deadline without extending it later',()=>{
 const b=new PeerBuffer();b.accept(packet(1,1000,1000,{staleAfterMs:20000}),0);
 b.accept(packet(1,1000,4000,{staleAfterMs:5000}),3000);b.accept(packet(1,1000,5000,{staleAfterMs:20000}),4000);
 assert.equal(b.sample(5001).size,0);
});
test('explicit disappearance removes immediately and a delayed duplicate cannot bring it back',()=>{
 const b=new PeerBuffer();b.accept(packet(1,1000,1000,{staleAfterMs:20000}),0);
 b.accept(packet(1,1000,2000,{staleAfterMs:20000,peers:[]}),1000);assert.equal(b.sample(1000).size,0);
 b.accept(packet(1,1000,2001,{staleAfterMs:20000}),1001);assert.equal(b.sample(1001).size,0);
 b.clear();b.accept(packet(1,1000,1000,{staleAfterMs:20000}),0);assert.equal(b.sample(0).size,1);
});
test('request timeout is bounded at 15 seconds and retries remain paced with one outstanding request',async(t)=>{
 const timers=[];t.mock.method(globalThis,'setTimeout',(callback,ms)=>{const token={callback,ms};timers.push(token);return token;});t.mock.method(globalThis,'clearTimeout',()=>{});
 let now=0,calls=0,signal;
 const c=new MultiplayerClient({exchange(_m,s){calls++;signal=s;return new Promise((_resolve,reject)=>s.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));},leave(){}},()=>now,()=> 'key');
 c.update(state,true);assert.equal(timers[0].ms,15000);now=12000;c.update(state,true);assert.equal(calls,1);assert.equal(signal.aborted,false);
 now=15000;timers[0].callback();await flush();now=15499;c.update(state,true);assert.equal(calls,1);now=15500;c.update(state,true);assert.equal(calls,2);assert.equal(timers[1].ms,15000);c.pause();await flush();
});
test('pause clears visible peers immediately and ignores a delayed pre-pause snapshot',async()=>{
 let resolve,now=0;const c=new MultiplayerClient({exchange(){return new Promise(r=>{resolve=r;});},leave(){}},()=>now,()=> 'key');
 c.update(state,true);resolve(packet(1,1000,1000,{staleAfterMs:20000}));await flush();assert.equal(c.peers.sample(now).size,1);
 now=250;c.update(state,true);c.pause();assert.equal(c.peers.sample(now).size,0);resolve(packet(2,1250,1250,{staleAfterMs:20000}));await flush();assert.equal(c.peers.sample(now).size,0);
});
