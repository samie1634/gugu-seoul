import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCallDuckModel, createCallDuckResources } from '../src/native/call-duck-model.ts';
import { createDuckPond } from '../src/native/duck-pond.ts';
import { makeMapLayout, sampleGround, sampleWater } from '../src/native/ported/map/layout.ts';

test('white adults share one appearance; yellow call ducklings and striped mallard ducklings are distinct and smaller', () => {
  const resources = createCallDuckResources(), adultA = createCallDuckModel('adult', resources), adultB = createCallDuckModel('adult', resources);
  const call = createCallDuckModel('duckling', resources), mallard = createCallDuckModel('duckling', resources, true);
  const signature = model => {const out=[];model.root.traverse(o=>{if(o.isMesh)out.push([o.name,o.position.toArray(),o.scale.toArray(),o.material.color.getHex()]);});return out;};
  try {
    assert.deepEqual(signature(adultA), signature(adultB));
    assert.ok(call.root.getObjectByName('call-duckling-down')); assert.ok(mallard.root.getObjectByName('mallard-duckling-eye-stripe'));
    assert.equal(call.root.getObjectByName('mallard-duckling-eye-stripe'), undefined);
    const adultBox=new THREE.Box3().setFromObject(adultA.root),babyBox=new THREE.Box3().setFromObject(call.root);
    assert.ok(babyBox.getSize(new THREE.Vector3()).length()<adultBox.getSize(new THREE.Vector3()).length()*.67);
    for(const model of [adultA,adultB,call,mallard])for(let i=0;i<20;i++){model.pose(i*.1,0,.3,i/20,1-i/20);model.root.updateMatrixWorld(true);model.root.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite)));}
  } finally {for(const model of [adultA,adultB,call,mallard])model.dispose();resources.dispose();}
});

for(const options of [{data:'osm'},{terrain:'sunken-channel',proportions:'reference-scale'}])test(`both broods follow their own mother on verified water without overlap: ${JSON.stringify(options)}`,()=>{
  const scene=new THREE.Scene(),layout=makeMapLayout(options),flock=createDuckPond(scene,layout),initial=flock.snapshot();
  try {
    assert.equal(initial.birds.filter(b=>b.breed==='mallard'&&b.plumage!=='duckling').length,6);
    assert.equal(initial.birds.filter(b=>b.breed==='call-duck'&&b.plumage!=='duckling').length,4);
    assert.equal(initial.birds.filter(b=>b.plumage==='duckling').length,6);
    for(let i=0;i<2400;i++){
      flock.update(.05);const birds=flock.snapshot().birds;
      for(const baby of birds.filter(b=>b.parentId)){
        const mother=birds.find(b=>b.id===baby.parentId);assert.ok(mother);assert.equal(mother.plumage,'hen');assert.equal(mother.breed,baby.breed);
        assert.ok(Math.hypot(mother.x-baby.x,mother.z-baby.z)<3,`${baby.id} stays with mother`);
        const ground=sampleGround(layout,baby.x,baby.z),water=sampleWater(layout,baby.x,ground.y,baby.z);assert.ok(water);assert.equal(baby.y,water.y);
      }
      for(let a=0;a<birds.length;a++)for(let b=a+1;b<birds.length;b++){
        const one=birds[a],two=birds[b],minimum=one.plumage==='duckling'&&two.plumage==='duckling'?.27:one.plumage==='duckling'||two.plumage==='duckling'?.43:.62;
        assert.ok(Math.hypot(one.x-two.x,one.z-two.z)>=minimum-1e-8,'body footprints stay separate');
      }
    }
    assert.ok(flock.snapshot().birds.filter(b=>b.parentId).every(b=>b.distanceSwum>1));
  }finally{flock.dispose();assert.equal(scene.children.length,0);}
});
