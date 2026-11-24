import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNameSeed,pigeonName,validNameSeed} from '../src/multiplayer/names.ts';
import {namePosition,PigeonNames} from '../src/multiplayer/labels.ts';
import {remoteFacing} from '../src/multiplayer/facing.ts';
import {MultiplayerClient} from '../src/multiplayer/client.ts';
import {PeerBuffer,validState} from '../src/multiplayer/state.ts';
import {RemoteBirds} from '../src/multiplayer/renderer.ts';
const state=(extra={})=>({x:0,y:.2,z:0,heading:0,pitch:0,roll:0,mode:'rest',grounded:true,look:'pigeon',time:10,steps:0,flapAge:10,peckAge:10,cooAge:10,world:'native-osm',...extra});
const flush=()=>new Promise(r=>setImmediate(r));
test('random game names are deterministic, bounded and independent of accounts',()=>{
 const a=createNameSeed(),b=createNameSeed();assert(validNameSeed(a));assert.notEqual(a,b);
 assert.equal(pigeonName(a),pigeonName(a));assert.match(pigeonName(a),/^[가-힣]+ [A-Z0-9]{5}$/);
 const names=new Set(Array.from({length:24},(_,n)=>pigeonName(n.toString(16).padStart(16,'0'))));assert.equal(names.size,24);
 for(const bad of ['private@example.com','<script>',null,0,'a'.repeat(64)])assert.equal(validNameSeed(bad),false);
});
test('the name survives pause/rejoin while private session credentials change',async()=>{
 let keys=0;const sent=[];const client=new MultiplayerClient({async exchange(m){sent.push(m);return {v:1,type:'snapshot',selfId:'self',serverTime:1,peers:[]};},leave(){}},()=>0,()=>`key-${++keys}`);
 const name=client.nameSeed;client.update(state(),true);await flush();client.pause();client.update(state(),true);await flush();
 assert.notEqual(sent[0].sessionKey,sent[1].sessionKey);assert.equal(sent[0].state.nameSeed,name);assert.equal(sent[1].state.nameSeed,name);client.pause();
});
test('only complete bounded velocities and opaque name codes pass the protocol',()=>{
 assert(validState(state({vx:1,vy:-2,vz:3,nameSeed:'0123456789abcdef'})));
 for(const bad of [{vx:1},{vx:1,vy:0,vz:Infinity},{vx:2001,vy:0,vz:0},{nameSeed:'my@email.test'}])assert.equal(validState(state(bad)),false);
});
test('airborne nose points along actual motion including turns, climbing and descent',()=>{
 for(const [vx,vy,vz] of [[0,0,-10],[10,0,0],[0,0,10],[-10,0,0],[3,4,-5],[0,5,0],[0,-5,0]]){
  const facing=remoteFacing(state({grounded:false,mode:'glide',vx,vy,vz,heading:2,roll:.7}));
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(facing.pitch,facing.yaw,facing.roll,'YXZ'));
  const nose=new THREE.Vector3(0,0,-1).applyQuaternion(q),velocity=new THREE.Vector3(vx,vy,vz).normalize();
  assert.ok(nose.dot(velocity)>.99999,`${vx}/${vy}/${vz}`);
 }
 const grounded=remoteFacing(state({vx:10,vy:0,vz:0,heading:.4}));assert.equal(grounded.yaw,-.4);
 const stopped=remoteFacing(state({grounded:false,vx:0,vy:0,vz:0,heading:.7}));assert.equal(stopped.yaw,-.7);
});
test('remote rig applies flight direction and exposes matching name/head anchors',()=>{
 const r=new RemoteBirds(new THREE.Scene(),'native-osm',false),seed='0123456789abcdef';
 r.update(new Map([['other',state({nameSeed:seed,grounded:false,mode:'flap',vx:10,vy:0,vz:0,heading:0})]]));
 const bird=r.root.children[0];assert.ok(new THREE.Vector3(0,0,-1).applyQuaternion(bird.quaternion).dot(new THREE.Vector3(1,0,0))>.99999);
 const label=r.namedBirds()[0];assert.equal(label.nameSeed,seed);assert.equal(label.character,bird);assert.equal(label.head.name,'head');r.clear();assert.equal(r.namedBirds().length,0);
});
test('older peers can derive flight direction from successive positions',()=>{
 const b=new PeerBuffer();const snap=(time,x)=>({v:1,type:'snapshot',selfId:'self',serverTime:time,peers:[{id:'old',sequence:time,updatedAt:time,state:state({x,grounded:false,mode:'glide'})}]});
 b.accept(snap(1000,0),0);b.accept(snap(1500,5),500);const s=b.sample(800).get('old');assert.equal(s.vx,10);assert.equal(s.vz,0);assert.equal(remoteFacing(s).yaw,-Math.PI/2);
});
test('name projection is above the head and rejects behind-camera/off-screen anchors',()=>{
 const head=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2)),camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);const viewport={left:10,top:20,width:100,height:100};
 const p=namePosition(head,camera,viewport);assert(p);assert.equal(p.left,60);assert.ok(p.top<70);
 head.position.z=10;assert.equal(namePosition(head,camera,viewport),null);head.position.set(1000,0,0);assert.equal(namePosition(head,camera,viewport),null);
});
test('labels use text only, do not capture input, and are removed on departure',()=>{
 const original=globalThis.document,children=[];
 globalThis.document={createElement(){return {style:{},className:'',textContent:'',hidden:false,remove(){children.splice(children.indexOf(this),1);}};}};
 try{
  const labels=new PigeonNames({appendChild(n){children.push(n);}}),head=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2)),camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);
  const bird={id:'a',nameSeed:'0123456789abcdef',character:head,head};labels.update([bird],camera,{left:0,top:0,width:100,height:100},true);
  assert.equal(children[0].textContent,pigeonName(bird.nameSeed));assert.equal(children[0].className,'pigeon-name');assert.equal(children[0].hidden,false);
  labels.update([],camera,{left:0,top:0,width:100,height:100},true);assert.equal(children.length,0);
 }finally{globalThis.document=original;}
});
test('old-client fallback ignores equal timestamps, clock resets and teleports',()=>{
 const packet=(sequence,updatedAt,s)=>({v:1,type:'snapshot',selfId:'self',serverTime:2000+sequence,peers:[{id:'old',sequence,updatedAt,state:state({grounded:false,...s})}]});
 for(const [updatedAt,extra] of [[1000,{x:5}],[900,{x:5}],[1500,{x:30}],[1500,{x:5,time:0}]]){
  const b=new PeerBuffer();b.accept(packet(1,1000,{x:0}),0);b.accept(packet(2,updatedAt,extra),500);const s=b.sample(800).get('old');assert.equal(s.vx,undefined);
 }
});
test('replacing a remote appearance refreshes its head anchor without changing its game name',()=>{
 const r=new RemoteBirds(new THREE.Scene(),'native-osm',false),seed='0123456789abcdef';r.update(new Map([['a',state({nameSeed:seed})]]));const before=r.namedBirds()[0];
 r.update(new Map([['a',state({nameSeed:seed,appearance:{speciesId:'eagle-owl',skinId:'default'}})]]));const after=r.namedBirds()[0];assert.notEqual(after.head,before.head);assert.equal(after.nameSeed,before.nameSeed);assert.notEqual(after.character,before.character);r.clear();
});
