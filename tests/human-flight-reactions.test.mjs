import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NpcSystem} from '../src/native/ported/npcs/runtime/simulation.ts';
import {approachingPigeon} from '../src/native/ported/npcs/runtime/pigeon-approach.ts';
import {HUMAN_CHARACTERS} from '../src/native/ported/npcs/src/human-characters.ts';
import {poseAnchors,paintPose} from '../src/native/ported/npcs/models/pose.ts';
const person={kind:'human',x:0,y:0,z:0,bodyScale:1};
const flight=(position={x:0,y:1.2,z:1.4},velocity={x:0,y:0,z:-4},airborne=true,species='pigeon')=>({id:'pigeon',type:'presence',position,speed:Math.hypot(velocity.x,velocity.y,velocity.z),radius:.17,halfHeight:.12,birdFlight:{species,airborne,velocity}});

test('human alarm requires a near, body-height, moving airborne pigeon on an approaching path',()=>{
  assert.equal(approachingPigeon(person,flight()),true);
  assert.equal(approachingPigeon(person,flight({x:0,y:1.2,z:1.4},{x:0,y:0,z:4})),false);
  assert.equal(approachingPigeon(person,flight({x:0,y:5,z:1.4})),false);
  assert.equal(approachingPigeon(person,flight({x:0,y:.15,z:1.4})),false);
  assert.equal(approachingPigeon(person,flight({x:0,y:1.2,z:4})),false);
  assert.equal(approachingPigeon(person,flight(undefined,undefined,false)),false);
  assert.equal(approachingPigeon(person,flight(undefined,undefined,true,'sparrow')),false);
  assert.equal(approachingPigeon(person,flight(undefined,{x:0,y:0,z:0})),false);
  assert.equal(approachingPigeon(person,flight(undefined,{x:NaN,y:0,z:0})),false);
  assert.equal(approachingPigeon(person,flight({x:0,y:.6,z:1},{x:0,y:4,z:0})),true,'close vertical takeoff startles people');
  assert.equal(approachingPigeon(person,flight({x:0,y:.6,z:3},{x:0,y:4,z:0})),false,'a distant takeoff does not startle everyone');
  assert.equal(approachingPigeon(person,{...flight({x:0,y:1.2,z:1},{x:0,y:0,z:4}),type:'flap'}),true,'a close departing wingbeat still startles');
  assert.equal(approachingPigeon(person,{id:'presence',type:'flap',position:{x:0,y:1.2,z:1},speed:8}),false);
});
function setup(){
  const navigation={routes:[{id:'walk',kinds:['human'],points:[{x:-10,z:0},{x:10,z:0}],loop:false}],spawnZones:[{id:'plaza',routeId:'walk',kinds:['human'],center:{x:0,z:0},radius:12,capacity:12}],groundAt:()=>({height:0,walkable:true,surface:'stone'}),canTraverse:(_from,to)=>Math.abs(to.x)<14&&Math.abs(to.z)<6};
  const system=new NpcSystem(navigation,{seed:77,maxTotal:10,limits:{human:10,dog:0,cat:0,rat:0},spawnMinDistance:0,spawnMaxDistance:30,despawnDistance:50});
  for(let i=0;i<100;i++)system.update(.05,{observer:{x:0,y:0,z:0}});
  system.drainEvents();return{system,navigation};
}
test('spawned fictional humans carry authored gender metadata, not inferred appearance labels',()=>{
  const {system}=setup(),states=system.snapshot();assert.equal(states.length,10);
  assert.ok(states.some(s=>s.humanGender==='female'));assert.ok(states.some(s=>s.humanGender==='male'));
  for(const state of states)assert.equal(state.humanGender,state.humanRole==='grandmother'?'female':state.humanRole==='grandfather'?'male':HUMAN_CHARACTERS[state.variant].gender);
  system.dispose();
});
for(const gender of ['female','male'])test(`${gender} pigeon reaction uses the requested action, bounded repeat and collision-safe movement`,()=>{
  const {system,navigation}=setup(),target=system.snapshot().find(s=>s.humanGender===gender);
  const stimulus=flight({x:target.x,y:1.2,z:target.z+1.2});
  system.update(.05,{observer:target,stimuli:[stimulus]});
  const events=system.drainEvents().filter(e=>e.npcId===target.id),reaction=events.find(e=>e.type==='reaction');
  assert.equal(reaction.response,gender==='female'?'startle':'duck');
  assert.equal(events.some(e=>e.type==='audio'&&e.cue==='human-scream'),gender==='female');
  let maxSpeed=0,repeats=0,previous=system.snapshot().find(s=>s.id===target.id);
  assert.equal(previous.action,gender==='female'?'startle':'duck');
  for(let i=0;i<100;i++){
    system.update(.05,{observer:target,stimuli:[stimulus]});const current=system.snapshot().find(s=>s.id===target.id);
    assert.ok(navigation.canTraverse(previous,current));assert.equal(current.y,0);
    assert.ok(Math.hypot(current.x-previous.x,current.z-previous.z)<=3.2*.05+1e-8);maxSpeed=Math.max(maxSpeed,current.speed);
    repeats+=system.drainEvents().filter(e=>e.npcId===target.id&&e.type==='audio'&&e.cue==='human-scream').length;previous=current;
  }
  assert.equal(repeats,0);if(gender==='female')assert.ok(maxSpeed>1.85);
  system.dispose();
});
test('duck pose lowers the head, keeps planted soles and emits finite geometry',()=>{
  const base={kind:'human',variant:1,humanGender:'male',action:'idle',speed:0,gaitDistance:0,age:0,bodyScale:1};
  const upright=poseAnchors(base),duck=poseAnchors({...base,action:'duck'});
  assert.ok(duck.eye[1]<upright.eye[1]-.07);assert.ok(duck.eye[2]<upright.eye[2]-.1);
  const shoes=[];paintPose({...base,action:'duck'},{part:(shape,x,y,z,w,h,d,color,pitch=0)=>{assert.ok([x,y,z,w,h,d,pitch,color].every(Number.isFinite));if(shape==='block'&&color===0x30333a)shoes.push({y,h});},link:(...v)=>assert.ok(v.every(Number.isFinite))});
  assert.equal(shoes.length,2);assert.ok(shoes.every(s=>Math.abs(s.y-s.h/2)<1e-9));
});

test('actual OSM NPC bridge forwards species and airborne velocity to authored women and men',async()=>{
  const THREE=await import('three');const {createNativeNpcBridge}=await import('../src/native/npc-bridge.ts');
  const {makeMapLayout}=await import('../src/native/ported/map/layout.ts');
  const bridge=createNativeNpcBridge(new THREE.Scene(),makeMapLayout({data:'osm'}));
  const player={x:-336,y:.12,z:108,vx:0,vy:0,vz:0,grounded:true,speciesId:'pigeon',body:{horizontalRadiusM:.17,heightM:.24},flap:false,coo:false};
  let frame=0;for(let i=0;i<100;i++){frame++;bridge.commit({frame,simTime:frame/10,acceptedSeconds:.1,playing:true},player,player);}
  const humans=bridge.snapshot().states.filter(s=>s.kind==='human');assert.ok(humans.length>1);
  for(const gender of ['female','male']){
    const target=bridge.snapshot().states.find(s=>s.kind==='human'&&s.humanGender===gender);assert.ok(target);
    const flying={...player,x:target.x,y:target.y+1.2,z:target.z+1.2,vz:-4,grounded:false};frame++;
    const events=bridge.commit({frame,simTime:frame/10,acceptedSeconds:.1,playing:true},flying,flying).filter(e=>e.npcId===target.id);
    assert.ok(events.some(e=>e.type==='reaction'&&e.response===(gender==='female'?'startle':'duck')));
    assert.equal(events.some(e=>e.type==='audio'&&e.cue==='human-scream'),gender==='female');
  }
  bridge.dispose();
});

for (const role of ['woman', 'man', 'grandmother', 'grandfather']) test(`${role} has an explicit identity, escapes safely and resumes the previous food cadence`, () => {
  const {system,navigation}=setup();
  const gender=role==='woman'||role==='grandmother'?'female':'male';
  const matches=s=>['woman','man'].includes(role)?s.humanRole==='walker'&&s.humanGender===gender:s.humanRole===role;
  const target=system.snapshot().find(matches);assert.ok(target,role);
  assert.equal(target.humanGender,gender);
  const before=target.foodSequence;
  system.update(.05,{observer:target,stimuli:[flight({x:target.x,y:target.y+1.2,z:target.z+1.2})]});
  const reaction=system.drainEvents().filter(e=>e.npcId===target.id);
  assert.equal(reaction.find(e=>e.type==='reaction').response,gender==='female'?'startle':'duck');
  assert.equal(reaction.some(e=>e.type==='audio'&&e.cue==='human-scream'),gender==='female');
  let previous=target,walked=0;
  for(let i=0;i<600;i++) {
    system.update(.05,{observer:target});const state=system.snapshot().find(s=>s.id===target.id);
    assert.ok(navigation.canTraverse(previous,state));assert.equal(state.y,0);
    walked+=Math.hypot(state.x-previous.x,state.z-previous.z);previous=state;
    if(!['startle','duck'].includes(state.action))break;
  }
  assert.ok(walked>(gender==='female'?10.49:.2),`walked ${walked}`);
  if(gender==='female')assert.ok(Math.hypot(previous.x-target.x,previous.z-target.z)>=10,'finishes at least 10 metres away, not by looping in place');assert.ok(!['startle','duck'].includes(previous.action));
  assert.ok(previous.foodSequence>=before);system.dispose();
});

test('a nearby airborne pigeon interrupts a conversation and both partners recover',()=>{
  const {system}=setup();let pair;
  for(let i=0;i<400;i++) {
    pair=system.snapshot().find(s=>s.talkPartnerId);if(pair)break;
    system.update(.05,{observer:{x:0,y:0,z:0}});
  }
  assert.ok(pair);const partner=pair.talkPartnerId;
  system.drainEvents();
  system.update(.05,{observer:pair,stimuli:[flight({x:pair.x,y:pair.y+1.2,z:pair.z+1.2})]});
  const after=system.snapshot();assert.equal(after.find(s=>s.id===pair.id).talkPartnerId,undefined);
  assert.notEqual(after.find(s=>s.id===pair.id).action,'talk');
  assert.equal(after.find(s=>s.id===partner).talkPartnerId,undefined);system.dispose();
});

for (const role of ['grandmother','grandfather']) test(`${role} pauses an unfinished feeding throw to evade, then completes it once`,()=>{
  const {system}=setup();let target;
  for(let i=0;i<2600;i++) {
    target=system.snapshot().find(s=>s.humanRole===role);
    if(Number.isFinite(target.foodThrowAge)&&target.foodThrowAge<.25)break;
    system.update(.05,{observer:{x:0,y:0,z:0}});
  }
  assert.ok(Number.isFinite(target.foodThrowAge));const sequence=target.foodSequence;
  system.update(.05,{observer:target,stimuli:[flight({x:target.x,y:target.y+1.2,z:target.z+1.2})]});
  const paused=system.snapshot().find(s=>s.id===target.id);
  assert.equal(paused.foodSequence,sequence);assert.equal(paused.foodThrowAge,target.foodThrowAge);
  for(let i=0;i<5;i++)system.update(.05,{observer:target});
  const still=system.snapshot().find(s=>s.id===target.id);assert.equal(still.foodSequence,sequence);assert.equal(still.foodThrowAge,target.foodThrowAge);
  for(let i=0;i<650;i++){system.update(.05,{observer:target});if(system.snapshot().find(s=>s.id===target.id).foodThrowAge===Infinity)break;}
  const resumed=system.snapshot().find(s=>s.id===target.id);assert.equal(resumed.foodSequence,sequence+1);assert.equal(resumed.foodThrowAge,Infinity);
  system.dispose();
});

for(const obstacle of ['open','wall','water','enclosed'])test(`female escape measures metres with safe ${obstacle} navigation`,()=>{
  const nav={routes:[{id:'escape',kinds:['human'],points:[{x:-.1,z:0},{x:.1,z:0}],loop:false}],spawnZones:[{id:'start',routeId:'escape',kinds:['human'],center:{x:0,z:0},radius:1,capacity:1}],
    groundAt:p=>({height:0,walkable:true,surface:obstacle==='water'&&p.z< -2?'water':'stone'}),
    canTraverse:(from,to)=>obstacle==='enclosed'?Math.hypot(to.x,to.z)<1:obstacle==='wall'?to.z> -2||Math.abs(to.x)>3:true};
  const system=new NpcSystem(nav,{seed:7,maxTotal:1,limits:{human:1,dog:0,cat:0,rat:0},spawnMinDistance:0,spawnMaxDistance:60,despawnDistance:80});
  system.update(.05,{observer:{x:0,y:0,z:0}});const start=system.snapshot()[0];assert.equal(start.humanGender,'female');
  system.update(.05,{observer:start,stimuli:[flight({x:start.x,y:1.2,z:start.z+1.2})]});
  let previous=start,walked=0,finished=false,maxSpeed=0;
  for(let i=0;i<650;i++){
    system.update(.05,{observer:start});const current=system.snapshot()[0];
    assert.ok(nav.canTraverse(previous,current));assert.notEqual(nav.groundAt(current).surface,'water');
    const step=Math.hypot(current.x-previous.x,current.z-previous.z);assert.ok(step<=3.2*.1+1e-8);
    walked+=step;maxSpeed=Math.max(maxSpeed,current.speed);previous=current;
    if(current.action!=='startle'){finished=true;break;}
  }
  assert.ok(finished,'even an enclosed area has a bounded, safe fallback');
  if(obstacle!=='enclosed'){assert.ok(walked>=10.5);assert.ok(Math.hypot(previous.x-start.x,previous.z-start.z)>=10);assert.ok(maxSpeed>3);}
  else assert.ok(Math.hypot(previous.x,previous.z)<1);
  assert.ok(system.stats.traversalQueries<20000,'reroute work is bounded');
  system.dispose();
});
