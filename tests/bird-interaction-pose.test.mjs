import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {defaultBuildRig} from '../src/species-core/assets.ts';

test('opponent pecks jab forward above the ground-peck head position',()=>{
  for(const species of ['crow','magpie']){
    const rig=defaultBuildRig({species,lod:1}),eye=new THREE.Vector3();
    rig.pose({mode:'rest',time:0,flapAge:10,steps:0});const rest=rig.getEyeWorldPosition(eye).clone();
    rig.pose({mode:'rest',time:0,flapAge:10,steps:0,opponentPeckAge:.18});const jab=rig.getEyeWorldPosition(eye).clone();
    rig.pose({mode:'rest',time:0,flapAge:10,steps:0,peckAge:.25});const ground=rig.getEyeWorldPosition(eye).clone();
    assert.ok(jab.z<rest.z-.01,species);assert.ok(jab.y>ground.y+.03,species);
    rig.setLod(2);rig.pose({mode:'rest',time:0,flapAge:10,steps:0,opponentPeckAge:.18});
    assert.ok(rig.getEyeWorldPosition(eye).toArray().every(Number.isFinite));rig.dispose();
  }
});

test('all species have visible cyclic wing transforms during flight',()=>{
  for(const species of ['pigeon','sparrow','crow','magpie','tawny-owl','eagle-owl','kestrel']){
    const rig=defaultBuildRig({species,lod:1});
    rig.pose({mode:'flap',time:0,flapAge:.03,steps:0});const up=rig.model.pivots.leftWing.quaternion.clone();
    rig.pose({mode:'flap',time:0,flapAge:.13,steps:0});const down=rig.model.pivots.leftWing.quaternion.clone();
    assert.ok(up.angleTo(down)>.1,species);rig.dispose();
  }
});
