// Ported without visual redesign from Sojang v203 public/walk/heritage.js.
// Only gate() and its existing geometry helpers are retained.
export function roof(k, x, y, z, w, d, rise, decorative = true, form = 'paljak') {
  if(d>w*1.5) {
    const turn=p=>[x-p[2],p[1],z+p[0]];
    const rotated={...k,
      mesh:(g,m,px=0,py=0,pz=0)=>{g.rotateY(-Math.PI/2);return k.mesh(g,m,...turn([px,py,pz]));},
      beam:(a,b,...rest)=>k.beam(turn(a),turn(b),...rest),
      box:(px,py,pz,ww,hh,dd,m,solid=false)=>{const p=turn([px,py,pz]);return k.box(...p,dd,hh,ww,m,solid);},
      orb:(px,py,pz,ww,hh,dd,m)=>k.orb(...turn([px,py,pz]),dd,hh,ww,m),
    };
    return roof(rotated,0,y,0,d,w,rise,decorative,form);
  }
  const { T, m, lowDetail, mesh, beam, box, orb } = k;
  const nx = lowDetail ? 18 : 48, nq = lowDetail ? 8 : 20;
  const hip = form === 'hip', gable = form === 'gable';
  const turnUp = Math.min(.56,d*.042),cornerLift=decorative?Math.min(.5,d*.038):.16;
  const point = (u, q, side) => [u * (w / 2 - (gable?0:hip?w*.22*q:w*.14*Math.min(1,q/.55))), rise * Math.pow(q, .83) + turnUp * Math.pow(1 - q, 5) + cornerLift * Math.pow(Math.abs(u), 8) * Math.pow(1 - q, 3), side * d / 2 * (1 - q)];
  const addPatch = (pointAt, reverse = false, nu = nx, nv = nq) => {
    const positions = [], uv = [], indices = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      positions.push(...pointAt(i / nu * 2 - 1, j / nv)); uv.push(i / nu * w / 3.2, j / nv * d / 6);
      if (i < nu && j < nv) { const a = j * (nu + 1) + i, tris = [a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1]; if (reverse) { [tris[1], tris[2]] = [tris[2], tris[1]]; [tris[4], tris[5]] = [tris[5], tris[4]]; } indices.push(...tris); }
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); const surface=mesh(g, m.roof, x, y, z);surface.userData.heritagePart='roof';surface.userData.roofForm=form;
  };
  for (const side of [-1, 1]) {
    addPatch((u, q) => point(u, q, side), side < 0);
    const edgeCount = Math.ceil(w / (lowDetail ? 2 : !decorative&&rise<2 ? .65 : .30));
    for (let i = 0; i <= edgeCount; i++) {
      const u = i / edgeCount * 2 - 1, p = point(u, 0, side), q = point(u, .16, side);
      beam([x+p[0],y+p[1]-.18,z+p[2]], [x+q[0],y+q[1]-.24,z+q[2]], .08, .08, m.green, true);
      orb(x+p[0],y+p[1]-.08,z+p[2], .09,.09,.05,m.ridge);
      if(!lowDetail) {const inner=point(u,.36,side);beam([x+p[0],y+p[1]-.34,z+p[2]+side*.07],[x+inner[0],y+inner[1]-.4,z+inner[2]],.062,.062,m.green,true);orb(x+p[0],y+p[1]-.33,z+p[2]+side*.09,.063,.063,.025,m.cream);}
    }
    if (!lowDetail && (decorative||form==='gable'||rise>=2)) {
      const tiles = Math.ceil(w / .28), segments = 5;
      for (let i = 0; i <= tiles; i++) for (let j = 0; j < segments; j++) {
        const a = point(i / tiles * 2 - 1, j / segments, side), b = point(i / tiles * 2 - 1, (j + 1) / segments, side);
        beam([x+a[0],y+a[1]+.045,z+a[2]], [x+b[0],y+b[1]+.045,z+b[2]], .067, .067, m.roof, true);
      }
    }
    if(gable) {
      const positions=[side*w/2,.1,-d/2,side*w/2,rise,0,side*w/2,.1,d/2],g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(side>0?[0,1,2]:[2,1,0]);g.computeVertexNormals();mesh(g,m.wood,x,y,z);
      for(const zz of [-1,1])beam([x+side*w/2,y+turnUp-.05,z+zz*d/2],[x+side*w/2,y+rise+.02,z],.18,.20,m.ridge);
      if(!lowDetail)for(let i=1;i<12;i++){const q=i/12;beam([x+side*(w/2+.02),y+.1,z-d/2+q*d],[x+side*(w/2+.02),y+rise*(1-Math.abs(q*2-1)),z-d/2+q*d],.075,.075,m.wood);}
      continue;
    }
    // A full hip (ujingak) and a hip-and-gable (paljak) are different structures.
    addPatch((u, q) => [side * (w / 2 - w * (hip?.22:.14) * q), rise * (hip?1:.59) * Math.pow(q,.85) + turnUp * Math.pow(1 - q, 4) + cornerLift * Math.pow(Math.abs(u), 8)*Math.pow(1-q,2), u * d / 2 * (1 - (hip?1:.55) * q)], side > 0, lowDetail ? 12 : 24, 12);
    if(!lowDetail)for(let i=0;i<=Math.ceil(d/.32);i++) {
      const u=i/Math.ceil(d/.32)*2-1;
      for(let j=0;j<4;j++){const a=j/4,b=(j+1)/4,pt=q=>[x+side*(w/2-w*(hip?.22:.14)*q),y+rise*(hip?1:.59)*Math.pow(q,.85)+turnUp*Math.pow(1-q,4)+cornerLift*Math.pow(Math.abs(u),8)*Math.pow(1-q,2)+.04,z+u*d/2*(1-(hip?1:.55)*q)];beam(pt(a),pt(b),.06,.06,m.roof,true);}
    }
    if(hip)continue;
    const gablePanel = new T.BufferGeometry(); gablePanel.setAttribute("position", new T.Float32BufferAttribute([side*w*.36,rise*.59,-d*.225,side*w*.36,rise,0,side*w*.36,rise*.59,d*.225],3)); gablePanel.setIndex(side > 0 ? [0,1,2] : [2,1,0]); gablePanel.computeVertexNormals(); mesh(gablePanel,m.paper,x,y,z);
    beam([x+side*w*.36,y+rise*.59,z-d*.225],[x+side*w*.36,y+rise,z],.13,.13,m.green);
    beam([x+side*w*.36,y+rise,z],[x+side*w*.36,y+rise*.59,z+d*.225],.13,.13,m.green);
    if (decorative) for (let i = 0; i < 7; i++) {
      const u = side, q = i / 42, p = point(u,q,1), height = .1 + i * .009;
      orb(x+p[0],y+p[1]+height,z+p[2],.08,height,.09,m.dark);
      orb(x+p[0],y+p[1]+height*2,z+p[2]-.04,.05,.06,.05,m.dark);
    }
  }
  const ridgeWidth=gable?w:hip?w*.56:w*.72;
  if(form==='ridgeless')return;
  box(x,y+rise-.1,z,ridgeWidth,.25,.42,m.ridge);
  if(!lowDetail)for(let i=0;i<ridgeWidth/.3;i++)box(x-ridgeWidth/2+i*.3,y+rise+.14,z,.29,.09,.33,m.roof);
  for (const side of [-1,1]) {
    const xx=x+side*ridgeWidth/2;
    beam([xx-side*.35,y+rise,z],[xx,y+rise+.6,z],.13,.17,m.ridge);
    orb(xx,y+rise+.58,z,.17,.26,.2,m.ridge);
  }
}

function plaque(k, text, x, y, z, w) {
  if (typeof document === "undefined") return;
  const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=256;
  const g=canvas.getContext("2d");g.fillStyle="#171d1c";g.fillRect(0,0,1024,256);g.strokeStyle="#bfa66a";g.lineWidth=10;g.strokeRect(12,12,1000,232);
  g.fillStyle="#c8ad62";g.font="175px serif";g.textAlign="center";g.textBaseline="middle";g.fillText(text,512,137);
  const map=new k.T.CanvasTexture(canvas);map.colorSpace=k.T.SRGBColorSpace;
  k.mesh(new k.T.PlaneGeometry(w,w/4),new k.T.MeshStandardMaterial({map,roughness:.8}),x,y,z);
}

function brackets(k,x,y,z) {
  const {box,m}=k;
  if(k.lowDetail){box(x,y,z,.9,.6,.6,m.green);return;}
  for(let i=0;i<4;i++) {
    box(x,y+i*.17,z,.36+i*.23,.14,.35+i*.18,i%2?m.green:m.blue);
    box(x,y+i*.17+.025,z+.23+i*.09,.17,.12,.16,m.red);
  }
  box(x,y+.6,z,1.25,.15,.75,m.dancheong);
  if(!k.lowDetail)for(const side of [-1,1]) {
    k.beam([x+side*.26,y+.05,z+.28],[x+side*.51,y+.23,z+.46],.095,.13,m.green);
    k.beam([x+side*.51,y+.23,z+.46],[x+side*.67,y+.42,z+.51],.08,.13,m.red);
    k.orb(x+side*.53,y+.26,z+.48,.07,.055,.03,m.gold);
  }
}

export function windowPanel(k,x,y,z,w,h,side=1,paper=k.m.paper,lattice=k.m.green) {
  const {box,m}=k;
  h=Math.max(.5,h);box(x,y,z,w,h,.12,lattice);box(x,y+.1,z+side*.075,w-.12,h-.2,.025,paper);
  box(x,y,z+side*.10,w-.1,Math.min(.45,h*.22),.04,m.red);
  if(k.lowDetail)return;
  const rows=Math.max(5,Math.ceil(h/.22)),cols=Math.max(3,Math.ceil(w/.18));
  for(let i=0;i<=cols;i++) box(x-w/2+.05+(w-.1)*i/cols,y+.42,z+side*.12,.027,h-.48,.028,lattice);
  for(let i=0;i<=rows;i++) box(x,y+.42+(h-.48)*i/rows,z+side*.12,w-.1,.024,.028,lattice);
  for(const a of [-1,1])box(x+a*(w/2-.045),y,z+side*.14,.055,h,.04,m.wood);
  k.orb(x+w*.27,y+h*.44,z+side*.17,.022,.035,.014,m.dark);
}

export function hall(k,x,z,w,d,base,h,{double=false,passage=false,name="",bays=5,depthBays=3,roofForm='paljak',painted=true,lattice=null,wallPanels=false,shutters=false,terrace=.3}={}) {
  const {box,column,m}=k;
  const trim=lattice||m.green;
  box(x,base,z,w+1.7,terrace,d+1.5,m.stone);
  if(!k.lowDetail) {
    for(const side of [-1,1]){box(x,base+.12,z+side*(d/2+.76),w+1.7,.035,.025,m.masonry);box(x+side*(w/2+.86),base+.12,z,.025,.035,d+1.5,m.masonry);}
    for(let xx=-w/2;xx<w/2;xx+=1.8)for(const side of [-1,1])box(x+xx,base+.02,z+side*(d/2+.77),.018,terrace-.02,.02,m.masonry);
  }
  if(!passage) box(x,base+.3,z,w-.6,h-1.1,d-.6,m.dark,true);
  for(const side of [-1,1]) {
    for(let i=0;i<=bays;i++) {
      const xx=x-w/2+i*w/bays;
      column(xx,base+.3,z+side*d/2,h-.1,.3,m.red,passage);
      column(xx,base,z+side*d/2,.35,.41,m.stone);column(xx,base+.28,z+side*d/2,.09,.36,m.stone);
    }
    for(let i=0;i<Math.ceil(w/(painted?1.4:3));i++) brackets(k,x-w/2+(i+.5)*w/Math.ceil(w/(painted?1.4:3)),base+h-.85,z+side*d/2);
    box(x,base+h-.45,z+side*d/2,w+.5,.38,.38,m.dancheong);
    box(x,base+h-1.15,z+side*d/2,w,.25,.4,m.dancheong);
    if(!passage) for(let i=0;i<bays;i++) {
      const xx=x-w/2+w*(i+.5)/bays;
      if(shutters) {box(xx,base+.35,z+side*(d/2+.08),w/bays-.3,h-1.7,.14,m.red);if(!k.lowDetail)for(let j=1;j<9;j++)box(xx-w/bays*.43+j*w/bays*.86/9,base+.36,z+side*(d/2+.16),.018,h-1.72,.018,m.wood);}
      else if(wallPanels) {box(xx,base+.62,z+side*(d/2+.08),w/bays-.35,h-2.0,.11,m.paper);box(xx,base+.7,z+side*(d/2+.16),w/bays-.7,.12,.035,m.wood);}
      else {const leaves=k.lowDetail?2:4;for(let leaf=0;leaf<leaves;leaf++)windowPanel(k,xx-w/bays*.48+w/bays*.96*(leaf+.5)/leaves,base+.45,z+side*(d/2+.08),w/bays*.92/leaves,h-2.05,side,m.paper,trim);}
    }
    for(let i=1;i<depthBays;i++) {column(x+side*w/2,base+.3,z-d/2+i*d/depthBays,h-.1,.28,m.red);brackets(k,x+side*w/2,base+h-.85,z-d/2+i*d/depthBays);}
    box(x+side*w/2,base+h-.45,z,.35,.38,d,m.dancheong);
  }
  box(x,base+h-.12,z,w,.12,d,m.wood);
  // Deep, dark soffit with two rows of rafters; the eave projects beyond posts.
  for(const side of [-1,1])box(x,base+h-.18,z+side*(d/2+.75),w+2,.15,1.7,m.wood);
  roof(k,x,base+h,z,w+(painted?6:3.5),d+(painted?5:3.2),d>20?5:Math.min(3.3,d*.32),painted,roofForm);
  if(double) {
    const upperY=base+h+(d>20?3.1:2.15),uw=w*.84,ud=d*.77,uh=d>20?3.8:3.1;
    box(x,upperY,z,uw,uh,ud,m.dark);
    for(const side of [-1,1]) {
      for(let i=0;i<=bays;i++) column(x-uw/2+uw*i/bays,upperY,z+side*ud/2,uh,.24,m.red);
      for(let i=0;i<bays;i++) windowPanel(k,x-uw/2+uw*(i+.5)/bays,upperY+.25,z+side*(ud/2+.06),uw/bays*.87,uh-1.5,side,m.dark);
      box(x,upperY+uh-.85,z+side*ud/2,uw,.38,.34,m.dancheong);
      for(let i=0;i<Math.ceil(uw/1.3);i++) brackets(k,x-uw/2+(i+.5)*uw/Math.ceil(uw/1.3),upperY+uh-.7,z+side*ud/2);
    }
    roof(k,x,upperY+uh,z,w+2,d+1.7,d>20?7.3:3.2,painted,roofForm);
    if(name) plaque(k,name,x,upperY+1.55,z+ud/2+.16,passage?4:4.6);
  } else if(name) plaque(k,name,x,base+h-1.05,z+d/2+.3,4);
  const records=k.group.userData.heritageBuildings||(k.group.userData.heritageBuildings=[]);
  records.push({name,bays,depthBays,double,roofForm,painted,passage});
}

export function railing(k,x1,z1,x2,z2,y,{gap=0}={}) {
  const {box,column,beam,orb,m,colliders}=k, length=Math.hypot(x2-x1,z2-z1), steps=Math.ceil(length/2.4);
  const point=t=>[x1+(x2-x1)*t,z1+(z2-z1)*t];
  for(let i=0;i<=steps;i++) {
    const [x,z]=point(i/steps);if(gap&&Math.abs(x)<gap/2)continue;
    box(x,y,z,.4,.15,.4,m.stone);column(x,y+.15,z,.75,.115,m.stone);orb(x,y+1.02,z,.16,.17,.16,m.stone);
  }
  for(let i=0;i<steps;i++) {
    const a=point(i/steps),b=point((i+1)/steps);if(gap&&Math.abs((a[0]+b[0])/2)<gap/2)continue;
    beam([a[0],y+.42,a[1]],[b[0],y+.42,b[1]],.075,.075,m.stone);beam([a[0],y+.8,a[1]],[b[0],y+.8,b[1]],.08,.08,m.stone);
  }
  if(!gap) colliders.push({x:(x1+x2)/2,z:(z1+z2)/2,w:Math.max(.2,Math.abs(x2-x1)),d:Math.max(.2,Math.abs(z2-z1))});
  else for(const side of [-1,1]) colliders.push({x:side*(length+gap)/4,z:z1,w:(length-gap)/2,d:.2});
}

export function buildSojangGwanghwamun(k) {
  const {T,m,box,mesh,column,orb,colliders}=k,z=145;
  const shape=new T.Shape();shape.moveTo(-19,0);shape.lineTo(19,0);shape.lineTo(18.4,7.2);shape.lineTo(-18.4,7.2);shape.closePath();
  for(const [cx,r,shoulder] of [[-10,2.45,2.8],[0,2.95,3.05],[10,2.45,2.8]]) {
    const hole=new T.Path();hole.moveTo(cx-r,0);hole.lineTo(cx-r,shoulder);hole.absarc(cx,shoulder,r,Math.PI,0,true);hole.lineTo(cx+r,0);hole.closePath();shape.holes.push(hole);
    const arch=new T.Shape();arch.absarc(cx,shoulder,r+.32,0,Math.PI,false);arch.absarc(cx,shoulder,r,Math.PI,0,true);arch.closePath();
    const trim=new T.ExtrudeGeometry(arch,{depth:.12,bevelEnabled:false,curveSegments:24});mesh(trim,m.stone,0,.8,z+4.06);
    // Open studded leaves preserve all three walk-through passages.
    for(const side of [-1,1]) {
      const xx=cx+side*(r-.06);box(xx,.8,z+.8,.16,shoulder+r-.25,3.1,m.red);
      for(let row=0;row<7;row++)for(let n=0;n<5;n++)orb(xx+side*.1,1.2+row*.65,z-.5+n*.6,.035,.035,.035,m.dark);
    }
    for(const side of [-1,1]) box(cx+side*(r+.15),.8,z+4.08,.3,shoulder,.12,m.stone);
  }
  const geo=new T.ExtrudeGeometry(shape,{depth:8,bevelEnabled:true,bevelSize:.05,bevelThickness:.04,bevelSegments:1,curveSegments:24});
  const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)/8,uv.getY(i)/8);
  mesh(geo,m.masonry,0,.8,z-4);
  for(const [a,b] of [[-19,-12.45],[-7.55,-2.95],[2.95,7.55],[12.45,19]])colliders.push({x:(a+b)/2,z,w:b-a,d:8});
  box(0,0,z,40,.8,32,m.stone);
  box(0,0,173.35,29.7,.8,48.7,m.stone);
  box(0,.801,174,7,.012,47,m.paving);
  for(let i=0;i<8;i++)box(0,0,201.45-i*.5,8,(i+1)*.1,.5,m.stone);
  for(let i=0;i<4;i++)box(0,0,127+i*.5,8,(i+1)*.2,.5,m.stone);
  for(const side of [-1,1])railing(k,side*14.4,153,side*14.4,197.3,.8);
  railing(k,-14.4,197.3,14.4,197.3,.8,{gap:8.5});
  // Restored parapet above the masonry, below the timber pavilion.
  box(0,8,z,38,.65,9.5,m.dark);
  for(const side of [-1,1]) for(let i=0;i<19;i++) {
    const xx=-17.8+i*1.98;box(xx,8.08,z+side*4.8,1.8,.52,.12,m.paper);box(xx,8.13,z+side*4.89,.47,.42,.04,m.red);orb(xx,8.35,z+side*4.93,.12,.12,.025,m.paper);
  }
  hall(k,0,z,30.5,10,8.65,4.1,{double:true,name:"門化光",bays:5});
  // The pavilion collider is overhead; pedestrians stay in the stone passages.
  colliders.pop();
  for(const side of [-1,1]) {
    box(side*22,0,z+8,1.6,1.3,2,m.stone);orb(side*22,1.8,z+8,.56,.53,.8,m.stone);orb(side*22,2.1,z+8.5,.4,.4,.4,m.stone);
    for(let i=0;i<7;i++)box(side*21.2,0,z-3-i*.8,3.5,.2*(i+1),.8,m.stone);
  }
  for(const x of [-11,11]){column(x,0,210,2.8,.035,m.dark);box(x,1.5,210,.75,.65,.08,m.paper);}
}


const noise = n => { const v = Math.sin(n * 127.13 + 17.7) * 43758.5453; return v - Math.floor(v); };
function canvasTexture(T, width, height, paint) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; paint(canvas.getContext("2d"), width, height);
  const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.wrapS = map.wrapT = T.RepeatWrapping; map.anisotropy = 8; return map;
}

export function applySojangGateTextures(T,m) {
  if(typeof document === "undefined")return;
  m.dancheong.color.set("#ffffff");
  m.dancheong.map = canvasTexture(T, 1024, 128, (g, w, h) => {
    g.fillStyle = "#35554a"; g.fillRect(0, 0, w, h);
    for (const [y, size, color] of [[3,7,"#bf9a63"],[12,7,"#823e32"],[22,4,"#92a286"],[99,4,"#92a286"],[107,7,"#823e32"],[118,7,"#bf9a63"]]) { g.fillStyle = color; g.fillRect(0, y, w, size); }
    for (let x = 0; x < w; x += 64) {
      g.strokeStyle = "#b29561"; g.lineWidth = 2; g.strokeRect(x + 8, 35, 48, 53);
      for (let p = 0; p < 8; p++) { const a = p * Math.PI / 4; g.save(); g.translate(x + 32, 61); g.rotate(a); g.fillStyle = p % 2 ? "#799e8b" : "#b5744a"; g.beginPath(); g.ellipse(0, 14, 5, 11, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
      g.fillStyle = "#d1ba7f"; g.beginPath(); g.arc(x + 32, 61, 5, 0, Math.PI * 2); g.fill();
    }
  });
  const stoneNoise = canvasTexture(T, 512, 512, (g, w, h) => {
    g.fillStyle = "#c7c6be"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 30000; i++) { const n = noise(i * 3), v = 125 + Math.floor(n * 80); g.fillStyle = `rgba(${v},${v},${v-4},.26)`; g.fillRect(noise(i + 11) * w, noise(i + 329) * h, .7 + n * 2, .7 + n * 2); }
  });
  m.stone.map = stoneNoise;
  m.masonry.map = canvasTexture(T, 1024, 1024, (g, w, h) => {
    g.fillStyle = "#888b83"; g.fillRect(0, 0, w, h);
    for (let j = 0; j < 12; j++) for (let i = -1; i < 5; i++) {
      const v = 190 + Math.floor(noise(i + j * 40) * 20), x = i * 256 + (j % 2) * 128, y = j * h / 12;
      g.fillStyle = `rgb(${v+8},${v+7},${v})`; g.fillRect(x + 1.5, y + 1.5, 253, h / 12 - 3);
      for (let n = 0; n < 100; n++) { g.fillStyle = "#585c5520"; g.fillRect(x + noise(n * 4 + i * 20) * 250, y + noise(n * 7 + j * 10) * h / 12, 2, 2); }
    }
  });
  m.roof.map = canvasTexture(T, 512, 512, (g, w, h) => {
    g.fillStyle = "#555b5c"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) { const x = i * w / 16, grad = g.createLinearGradient(x, 0, x + w / 16, 0); grad.addColorStop(0,"#303a3d"); grad.addColorStop(.45,"#777d7b"); grad.addColorStop(.7,"#606967"); grad.addColorStop(1,"#303a3d"); g.fillStyle = grad; g.fillRect(x, 0, w / 16, h); }
    g.strokeStyle = "#27333866"; for (let y = 0; y < h; y += h / 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  m.roof.color.set("#a6adb0");
}
