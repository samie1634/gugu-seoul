import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { showProceduralLocalPlayer, retryFailedLocalVisual } from '../src/player-render-policy.ts';
import { createGroundPigeon, PIGEON_WALK, PIGEON_PECK, PIGEON_REST } from '../src/pigeon-ground.ts';
import { useIntegratedScene } from '../src/entry-mode.ts';

const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const state={ x:1,y:.1125,z:2,vx:0,vz:0,heading:0,mode:'rest',grounded:true,
  body:{heightM:.225,centreToSoleM:.1125},support:{walkable:true} };
const context={ started:false,firstPerson:false,look:'pigeon',reducedMotion:false,manualPeckAge:5,
  flirtAge:Infinity,cooAge:5,landedRecently:false,committedSeconds:0,distance:0 };

test('gray default never displays the procedural root during intro, cold load, handoff, or load failure', async () => {
  const stage=new THREE.Scene(), physical=new THREE.Group(); stage.add(physical);
  let deliver;
  const newApproved=()=>createGroundPigeon(stage,'./',()=>new Promise(resolve=>{deliver=resolve;}));
  const g=newApproved();
  const draw=(settings,flight=false)=>{
    const ground=g.update(state,settings);
    physical.visible=showProceduralLocalPlayer(settings.look,settings.firstPerson,ground,flight);
    return [ground,physical.visible];
  };
  assert.deepEqual(draw(context),[false,false]);
  assert.equal(g.snapshot().loadState,'loading');
  assert.deepEqual(draw({...context,started:true}),[false,false]);
  assert.deepEqual(draw({...context,started:true},true),[false,false]);
  deliver({scene:new THREE.Group(),animations:[PIGEON_WALK,PIGEON_PECK,PIGEON_REST].map(name=>new THREE.AnimationClip(name,2.333,[]))});
  await nextTurn();
  assert.deepEqual(draw({...context,started:true}),[true,false]);
  assert.equal(physical.parent,stage,'physical/camera root remains attached, simply invisible');
  assert.equal(showProceduralLocalPlayer('pigeon',false,false,false),false);
  assert.equal(showProceduralLocalPlayer('pigeon',true,true,false),false);
});

test('Home recovers a failed approved loader once and leaves ready/in-flight instances untouched', async () => {
  const stage=new THREE.Scene();
  const broken=createGroundPigeon(stage,'./',async()=>{throw new Error('private simulated failure');});
  broken.update(state,context);
  await nextTurn();
  assert.equal(broken.snapshot().loadState,'fallback');
  assert.equal(showProceduralLocalPlayer('pigeon',false,false,false),false);
  let creates=0;
  const factory=()=>{
    creates++;
    return createGroundPigeon(stage,'./',async()=>({scene:new THREE.Group(),
      animations:[PIGEON_WALK,PIGEON_PECK,PIGEON_REST].map(name=>new THREE.AnimationClip(name,2.333,[]))}));
  };
  const fresh=retryFailedLocalVisual(broken,factory);
  assert.equal(broken.root.parent,null); assert.equal(fresh.root.parent,stage);
  assert.equal(creates,1);
  fresh.update(state,context);
  assert.equal(retryFailedLocalVisual(fresh,factory),fresh);
  await nextTurn();
  assert.equal(fresh.ready,true);
  assert.equal(fresh.update(state,{...context,started:true}),true);
  assert.equal(retryFailedLocalVisual(fresh,factory),fresh);
  assert.equal(creates,1);
});

test('old entry may not select legacy player; white, owl and undisplayed first person stay separate', () => {
  for (const search of ['', '?native=legacy', '?map=procedural', '?native=legacy&map=procedural'])
    assert.equal(useIntegratedScene(new URLSearchParams(search)),true);
  for (const look of ['white','owl',null]) {
    assert.equal(showProceduralLocalPlayer(look,false,false,false),true);
    assert.equal(showProceduralLocalPlayer(look,true,false,false),false);
    assert.equal(showProceduralLocalPlayer(look,false,true,false),false);
  }
});
