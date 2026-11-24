import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HumanReactionAudio,HUMAN_SCREAM_CLIP} from '../src/human-reaction-audio.ts';
const at={x:0,y:1,z:0};
const bytes=()=>{const b=fs.readFileSync(new URL('../public/'+HUMAN_SCREAM_CLIP.path,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
function setup(t,mode='valid'){
  const oldFetch=globalThis.fetch,oldLocation=globalThis.location;
  let requests=0,decodes=0;const sources=[];
  globalThis.location={href:'https://example.test/99seoul/index.html'};
  globalThis.fetch=async(url,init)=>{requests++;assert.equal(String(url),'https://example.test/99seoul/'+HUMAN_SCREAM_CLIP.path);assert.equal(init.mode,'same-origin');assert.equal(init.redirect,'error');return{ok:mode!=='missing',arrayBuffer:async()=>mode==='corrupt'?new Uint8Array([1,2]).buffer:bytes()};};
  t.after(()=>{globalThis.fetch=oldFetch;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;});
  const node=()=>({connect(next){return next;},disconnect(){this.disconnected=true;}});
  const context={currentTime:0,state:'running',decodeAudioData:async b=>{decodes++;assert.equal(b.byteLength,56064);return{duration:1.752};},createGain:()=>({...node(),gain:{value:0}}),createBufferSource:()=>{const source={...node(),playbackRate:{value:1},starts:[],stop(){this.stopped=true;},start(...args){this.starts.push(args);}};sources.push(source);return source;},createOscillator:()=>assert.fail('Synthetic voice is forbidden')};
  return{context,output:node(),sources,get requests(){return requests;},get decodes(){return decodes;}};
}
test('verified Pixabay human recording loads only when requested and plays at original speed',async t=>{
  const f=setup(t),audio=new HumanReactionAudio();assert.equal(f.requests,0);assert.equal(audio.state,'idle');
  assert.equal(audio.play(f.context,f.output,'early','npc',at,at),false);
  await audio.load(f.context);assert.equal(audio.state,'ready');assert.equal(f.requests,1);assert.equal(f.decodes,1);
  assert.equal(audio.play(f.context,f.output,'early','npc',at,at),false,'no delayed replay');
  assert.equal(audio.play(f.context,f.output,'one','npc',at,at),true);assert.equal(f.sources[0].playbackRate.value,1);assert.deepEqual(f.sources[0].starts,[[0,0]]);
});
test('scream playback deduplicates events, limits the crowd and the same person, and stops on mute',async t=>{
  const f=setup(t),audio=new HumanReactionAudio();await audio.load(f.context);
  assert.equal(audio.play(f.context,f.output,'a','one',at,at),true);
  assert.equal(audio.play(f.context,f.output,'a','one',at,at),false);assert.equal(audio.play(f.context,f.output,'b','two',at,at),false);
  f.sources[0].onended();f.context.currentTime=3;assert.equal(audio.play(f.context,f.output,'c','two',at,at),false);
  f.context.currentTime=5;assert.equal(audio.play(f.context,f.output,'d','two',at,at),true);f.sources[1].onended();
  f.context.currentTime=10;assert.equal(audio.play(f.context,f.output,'e','one',at,at),false);
  f.context.currentTime=13;assert.equal(audio.play(f.context,f.output,'f','one',at,at),true);audio.stop();assert.equal(f.sources[2].stopped,true);
  f.context.currentTime=30;assert.equal(audio.play(f.context,f.output,'g','one',at,at,false),false);assert.equal(audio.play(f.context,f.output,'g','one',at,at,true),false);
  assert.equal(audio.play(f.context,f.output,'h','three',{x:50,y:0,z:0},at),false);
});
for(const mode of ['missing','corrupt'])test(`${mode} voice stays silent without a synthesized substitute`,async t=>{
  const f=setup(t,mode),audio=new HumanReactionAudio();await audio.load(f.context);assert.equal(audio.state,'unavailable');
  assert.equal(f.decodes,0);assert.equal(audio.play(f.context,f.output,'voice','npc',at,at),false);assert.equal(f.sources.length,0);
});
