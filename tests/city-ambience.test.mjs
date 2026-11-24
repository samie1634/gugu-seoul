import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CityAmbience,cityLevel,conversationPairs} from '../src/city-ambience.ts';
const p={x:0,y:0,z:0};
const emitter=(id,x=0)=>({...p,id,x,visible:true});
test('car gains use real visible positions and altitude; no car stays silent',()=>{
 assert.equal(cityLevel(p,[],65,.32),0);assert.equal(cityLevel(p,[emitter('a')],65,.32),.32);
 assert.ok(cityLevel(p,[emitter('a',10)],65,.32)>cityLevel(p,[emitter('a',50)],65,.32));
 assert.equal(cityLevel({...p,y:70},[emitter('a')],65,.32),0);
 assert.equal(cityLevel(p,[{...emitter('a'),visible:false}],65,.32),0);
 assert.equal(cityLevel(p,[emitter('a',NaN)],65,.32),0);
});
test('pair only nearby idle humans, one partner each; no moving/startled/other floor',()=>{
 const h=(id,x,extra={})=>({...emitter(id,x),kind:'human',speed:0,action:'idle',...extra});
 const pairs=conversationPairs([h('a',0),h('b',1),h('c',2),h('d',3),h('e',1,{y:10}),h('f',1,{action:'startle'}),h('g',1,{kind:'dog'}),h('h',1,{speed:1})]);
 assert.deepEqual(pairs.map(p=>[p.a,p.b]),[['a','b'],['c','d']]);
 assert.deepEqual(conversationPairs([h('a',0)]),[]);
});
test('recordings only; bounded loops; mute, pause, failure and dispose cleanup',()=>{
 const sources=[];const context={state:'running',currentTime:0,createBufferSource(){const n={connect(){},disconnect(){},start(){},stop(){this.stopped=true;}};sources.push(n);return n;},createGain(){return{gain:{value:0,setTargetAtTime(){}},connect(){},disconnect(){}};}};
 const sound=new CityAmbience(context,{});
 sound.update(p,[emitter('car')],[emitter('pair')],true,false);assert.equal(sources.length,0);
 for(const k of ['wind','traffic','conversation'])sound.supply(k,{duration:10});
 for(let i=0;i<100;i++)sound.update(p,[emitter('car')],[emitter('pair')],true,false);
 assert.equal(sources.length,3);assert.equal(sound.activeLoops,3);
 sound.update(p,[],[],true,false);assert.equal(sound.activeLoops,1);
 sound.update(p,[],[],true,true);assert.equal(sound.activeLoops,0);assert.ok(sources.every(s=>s.stopped));
 sound.update(p,[],[],false,false);assert.equal(sound.activeLoops,0);
 context.state='suspended';sound.update(p,[],[],true,false);assert.equal(sound.activeLoops,0);
 context.state='running';sound.update(p,[],[],true,false);assert.equal(sound.activeLoops,1);
 sound.dispose();sound.update(p,[],[],true,false);assert.equal(sound.activeLoops,0);
});

test('a failed engine graph is silent, cleans up, and does not retry or stop unrelated lanes',()=>{
 const sources=[], gains=[];
 const context={state:'running',currentTime:0,
  createBufferSource(){const source={connect(){},disconnect(){this.disconnected=true;},start(){if(this.buffer.fail)throw Error('engine unavailable');},stop(){this.stopped=true;}};sources.push(source);return source;},
  createGain(){const gain={gain:{value:0,setTargetAtTime(){}},connect(){},disconnect(){this.disconnected=true;}};gains.push(gain);return gain;}};
 const sound=new CityAmbience(context,{});
 sound.supply('wind',{duration:10});sound.supply('traffic',{duration:7.008,fail:true});sound.supply('conversation',{duration:10});
 assert.doesNotThrow(()=>sound.update(p,[emitter('car')],[emitter('pair')],true,false));
 assert.equal(sound.activeLoops,2);assert.equal(sources.length,3);
 assert.ok(sources[1].stopped&&sources[1].disconnected&&gains[1].disconnected);
 for(let i=0;i<100;i++)sound.update(p,[emitter('car')],[emitter('pair')],true,false);
 assert.equal(sources.length,3,'Broken lane is not retried on every update');
 sound.dispose();assert.ok(sources.every(s=>s.stopped&&s.disconnected));
});

test('partial graph creation errors cannot throw or cause retry loops',()=>{
 let created=0,disconnected=0;
 const context={state:'running',currentTime:0,createBufferSource(){created++;return{disconnect(){disconnected++;}};},createGain(){throw Error('gain unavailable');}};
 const sound=new CityAmbience(context,{});sound.supply('traffic',{duration:7.008});
 assert.doesNotThrow(()=>sound.update(p,[emitter('car')],[],true,false));
 assert.equal(sound.activeLoops,0);assert.equal(disconnected,1);
 sound.update(p,[emitter('car')],[],true,false);assert.equal(created,1);
});
