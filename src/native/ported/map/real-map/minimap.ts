import type { RealMapData } from './types.ts';
export function minimapPoint(data:RealMapData,x:number,z:number):[number,number]{const b=data.bounds;return[4+(x-b.minX)/(b.maxX-b.minX)*172,4+(z-b.minZ)/(b.maxZ-b.minZ)*178];}
/** Replace the old schematic in place, retaining its player marker and labels. */
export function drawRealMinimap(svg:SVGSVGElement,data:RealMapData):void{
  const player=svg.querySelector('#map-player');
  const make=(tag:string,attributes:Record<string,string>)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attributes))e.setAttribute(k,v);svg.appendChild(e);return e;};
  svg.replaceChildren();make('rect',{width:'180',height:'186',rx:'11',fill:'#d6ddca'});
  const path=(rings:number[][][])=>rings.map(r=>r.map((p,i)=>`${i?'L':'M'}${minimapPoint(data,p[0],p[1]).map(n=>n.toFixed(2)).join(' ')}`).join(' ')+'Z').join(' ');
  for(const b of data.buildings)make('path',{d:path(b.rings),fill:'#b8ba9f','fill-rule':'evenodd'});
  for(const r of data.roads.filter(r=>!r.underground))make('path',{d:path(r.rings),fill:r.walkable?'#f0e9ce':'#829a8a','fill-rule':'evenodd'});
  for(const w of data.water)make('path',{d:path(w.rings),fill:'#7baaa1','fill-rule':'evenodd'});
  const labels:[string,number,number][]=[['광화문',-335,-360],['세종대로',-280,100],['종로',250,330],['청계천',220,500]];
  for(const[text,x,z]of labels){const p=minimapPoint(data,x,z),e=make('text',{x:p[0].toFixed(2),y:p[1].toFixed(2),'text-anchor':'middle','font-size':'8',fill:'#365745'});e.textContent=text;}
  if(player)svg.appendChild(player);
}
