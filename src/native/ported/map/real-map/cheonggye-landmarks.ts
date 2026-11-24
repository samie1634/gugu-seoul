import * as THREE from 'three';
import { Painter } from '../../../../geometry.ts';
import { polygonGeometry } from './geometry.ts';
import { channelSolids, channelTerraces, channelPools, channelPoint, CHEONGGYE_LEVELS, CHEONGGYE_AUDIO_ANCHORS } from './cheonggye-channel.ts';
/** Original procedural geometry. Photographs are reference only and never shipped. */
export function createCheonggyeLandmarks(){
 const root=new THREE.Group();root.name='cheonggye:headwater-landmarks';
 root.userData.evidence={drop:'SFC documents 4 m / two-stage; other guides use different stage counts',depth:'0.30 m illustrative normal-flow target, not a current measurement',placement:'OSM-aligned, photo-proportioned; not surveyed',audioAnchors:CHEONGGYE_AUDIO_ANCHORS};
 const stone=new Painter();
 for(const s of channelSolids)if(s.render!==false)stone.add(polygonGeometry(s.rings,s.height,s.minY),s.color,new THREE.Vector3());
 for(const p of channelTerraces)stone.add(polygonGeometry(p.rings,CHEONGGYE_LEVELS.promenade), '#b2b0a1',new THREE.Vector3());
 const stoneMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});
 const masonry=new THREE.Mesh(stone.geometry(),stoneMat);masonry.name='cheonggye:stonework';masonry.castShadow=true;masonry.receiveShadow=true;root.add(masonry);
 const clock={value:0},daylight={value:1};
 const fallMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uTime:clock,uDay:daylight},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`uniform float uTime;uniform float uDay;varying vec2 vUv;
 void main(){float threads=pow(.5+.5*sin(vUv.x*251.+sin(vUv.x*73.)*4.+uTime*.7),5.);float flow=.5+.5*sin(vUv.y*71.+uTime*13.+vUv.x*19.);float foam=pow(1.-vUv.y,7.);vec3 lit=mix(vec3(.20,.55,.78),vec3(.79,.93,.94),.3+threads*.45+flow*.18);vec3 night=mix(vec3(.06,.18,.75),vec3(.24,.83,1.),vUv.y);gl_FragColor=vec4(mix(night,lit,uDay)+foam*.26,.68+threads*.2+foam*.1);}`});
 const angle=-Math.PI/2-Math.atan2(.0969,.9953);
 function waterfall(name:string,u:number,top:number,bottom:number,width:number){const m=new THREE.Mesh(new THREE.PlaneGeometry(width,top-bottom,40,4),fallMat);const p=channelPoint(u,0,(top+bottom)/2);m.position.set(p.x,p.y,p.z);m.rotation.y=angle;m.name=name;root.add(m);}
 waterfall('cheonggye:upper-cascade',-7.98,0,-.85,14.5);
 waterfall('cheonggye:main-waterfall',.035,-.85,-4,14.5);
 const poolMat=new THREE.MeshStandardMaterial({color:'#638e8c',roughness:.24,metalness:.28,transparent:true,opacity:.78});
 for(const p of channelPools){const m=new THREE.Mesh(polygonGeometry(p.rings,p.y+.012),poolMat);m.name=p.id+':surface';root.add(m);}
 const whiteMat=new THREE.MeshStandardMaterial({color:'#d2e9e9',roughness:.38,transparent:true,opacity:.76,emissive:'#145aa4',emissiveIntensity:0});
 const foam=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,4),whiteMat,56);foam.name='cheonggye:waterfall-foam';root.add(foam);
 const jets=new THREE.InstancedMesh(new THREE.CylinderGeometry(.045,.13,1,6,1,true),whiteMat,61);jets.name='cheonggye:candle-fountain';root.add(jets);
 const droplets=new THREE.InstancedMesh(new THREE.SphereGeometry(1,5,4),whiteMat,122);droplets.name='cheonggye:fountain-drops';root.add(droplets);
 const jetPoints=Array.from({length:61},(_,i)=>{if(i===0)return{u:-18,v:0,h:5.6};const ring=i<=12?0:i<=36?1:2,j=i-(ring===0?1:ring===1?13:37),n=ring===0?12:24,a=j/n*Math.PI*2;return{u:-18+Math.cos(a)*(2+ring*1.7),v:Math.sin(a)*(2+ring*1.7),h:[3.6,2.1,1.3][ring]};});
 // Simplified red/blue shell-shaped Spring landmark. No downloaded artwork mesh/texture.
 const spring=new THREE.Group();spring.name='cheonggye:spring-sculpture';const sp=channelPoint(-72,-1.5);spring.position.set(sp.x,0,sp.z);
 const profile=Array.from({length:61},(_,i)=>{const t=i/60;return new THREE.Vector2(.018+2.72*Math.pow(1-t,.8),t*20);});
 const geo=new THREE.LatheGeometry(profile,48),pos=geo.getAttribute('position'),colors=new Float32Array(pos.count*3);
 const red=new THREE.Color('#c83340'),blue=new THREE.Color('#245a94');
 for(let i=0;i<pos.count;i++){
  const t=pos.getY(i)/20,a=Math.atan2(pos.getZ(i),pos.getX(i)),spiral=a-t*Math.PI*2*4.8,wave=Math.sin(spiral),r=Math.hypot(pos.getX(i),pos.getZ(i)),rib=.20*Math.pow(1-t,.6)*wave;
  if(r>.001)pos.setXYZ(i,pos.getX(i)*(r+rib)/r,pos.getY(i),pos.getZ(i)*(r+rib)/r);
  (wave<-.55?blue:red).toArray(colors,i*3);
 }
 geo.computeVertexNormals();geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
 const sculpture=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.42,metalness:.25}));sculpture.castShadow=true;spring.add(sculpture);root.add(spring);
 // Low blue lamps are emissive geometry, not dozens of extra light/shadow passes.
 const lampGeo=new THREE.SphereGeometry(.09,6,4),lampMat=new THREE.MeshBasicMaterial({color:'#449fff'}),lamps=new THREE.InstancedMesh(lampGeo,lampMat,24);lamps.name='cheonggye:water-lights';root.add(lamps);
 const temp=new THREE.Object3D();for(let i=0;i<24;i++){const p=channelPoint(i<12?.12:12,((i%12)/11-.5)*13.8,-3.88);temp.position.set(p.x,p.y,p.z);temp.scale.set(1,1,1);temp.updateMatrix();lamps.setMatrixAt(i,temp.matrix);}
 let disposed=false;
 const update=(time:number,light=1)=>{if(disposed||!Number.isFinite(time))return;const t=((time%3600)+3600)%3600;clock.value=t;daylight.value=THREE.MathUtils.clamp(light,0,1);whiteMat.emissiveIntensity=(1-daylight.value)*.7;lamps.visible=daylight.value<.55;
  jetPoints.forEach((p,i)=>{const h=p.h*(.88+.12*Math.sin(t*1.25+i*.37)),q=channelPoint(p.u,p.v,h/2);temp.position.set(q.x,q.y,q.z);temp.rotation.set(0,0,0);temp.scale.set(1,h,1);temp.updateMatrix();jets.setMatrixAt(i,temp.matrix);
   for(let j=0;j<2;j++){const f=(t*.56+i*.137+j*.5)%1,r=.2+f*.65,a=i*2.4+j*Math.PI,q=channelPoint(p.u+Math.cos(a)*r,p.v+Math.sin(a)*r,h*(1-f*f));temp.position.set(q.x,q.y,q.z);temp.scale.set(.065,.1,.065);temp.updateMatrix();droplets.setMatrixAt(i*2+j,temp.matrix);}
  });jets.instanceMatrix.needsUpdate=true;droplets.instanceMatrix.needsUpdate=true;jets.computeBoundingSphere();droplets.computeBoundingSphere();
  for(let i=0;i<56;i++){const q=channelPoint(.45+(i%4)*.25,((i/56)-.5)*14.1,-3.96+Math.sin(t*4+i)*.035);temp.position.set(q.x,q.y,q.z);temp.scale.set(.4,.055,.22+.06*Math.sin(t*3+i));temp.updateMatrix();foam.setMatrixAt(i,temp.matrix);}foam.instanceMatrix.needsUpdate=true;foam.computeBoundingSphere();
 };
 update(0);
 return{root,update,dispose(){if(disposed)return;disposed=true;root.removeFromParent();const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);if(o instanceof THREE.InstancedMesh)o.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());root.clear();}};
}
