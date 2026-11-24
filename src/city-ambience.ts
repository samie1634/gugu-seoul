/** Only decoded, rights-checked recordings may be supplied. No synthesis or remote URLs. */
export type CitySound = 'wind' | 'traffic' | 'conversation';
export interface SoundPoint { x: number; y: number; z: number }
export interface CityEmitter extends SoundPoint { id: string; visible: boolean }
export interface TalkingHuman extends CityEmitter { kind: string; speed: number; action: string }
export interface ConversationPair { id: string; a: string; b: string; position: SoundPoint }
const finite = (p: SoundPoint) => [p.x,p.y,p.z].every(Number.isFinite);
const distance = (a: SoundPoint,b: SoundPoint) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
/** Candidate pairing only: action owner must commit a pair before supplying its sound anchor. */
export function conversationPairs(humans: readonly TalkingHuman[]): ConversationPair[] {
  const eligible=humans.filter(h=>h.visible&&h.kind==='human'&&finite(h)&&h.speed<.15&&['idle','look','talk'].includes(h.action)).sort((a,b)=>a.id.localeCompare(b.id));
  const used=new Set<string>(), result:ConversationPair[]=[];
  for(const a of eligible){
    if(used.has(a.id))continue;
    const b=eligible.filter(b=>b.id!==a.id&&!used.has(b.id)&&Math.abs(a.y-b.y)<.6&&distance(a,b)>=.5&&distance(a,b)<=2.5).sort((b,c)=>distance(a,b)-distance(a,c)||b.id.localeCompare(c.id))[0];
    if(!b)continue;
    used.add(a.id);used.add(b.id);
    result.push({id:`${a.id}:${b.id}`,a:a.id,b:b.id,position:{x:(a.x+b.x)/2,y:(a.y+b.y)/2+1.4,z:(a.z+b.z)/2}});
    if(result.length===3)break;
  }
  return result;
}
export function cityLevel(listener:SoundPoint, emitters:readonly CityEmitter[], radius:number, maximum:number):number{
  if(!finite(listener)||radius<=0)return 0;
  const nearest=emitters.filter(e=>e.visible&&finite(e)).reduce((d,e)=>Math.min(d,distance(listener,e)),Infinity);
  return maximum*Math.max(0,1-nearest/radius)**2;
}
interface Loop {source:AudioBufferSourceNode;gain:GainNode}
/** Uses the existing master gain/context; no second context or autoplay unlock. Max three loops. */
export class CityAmbience {
  private loops=new Map<CitySound,Loop>();
  private buffers=new Map<CitySound,AudioBuffer>();
  private disposed=false;
  private context:AudioContext;
  private master:AudioNode;
  constructor(context:AudioContext,master:AudioNode){this.context=context;this.master=master;}
  supply(kind:CitySound,buffer:AudioBuffer):void{
    if(this.disposed||!Number.isFinite(buffer.duration)||buffer.duration<=0)return;
    this.stop(kind);this.buffers.set(kind,buffer);
  }
  update(listener:SoundPoint,cars:readonly CityEmitter[],talkingPairs:readonly CityEmitter[],active:boolean,muted:boolean):void{
    if(this.disposed||!active||muted||this.context.state!=='running'||!finite(listener)){this.stopAll();return;}
    this.level('wind',.035);
    this.level('traffic',cityLevel(listener,cars,65,.32));
    this.level('conversation',cityLevel(listener,talkingPairs,18,.14));
  }
  private level(kind:CitySound,level:number):void{
    const buffer=this.buffers.get(kind);
    if(!buffer||level<.0001){this.stop(kind);return;}
    let loop=this.loops.get(kind);
    let source:AudioBufferSourceNode|undefined;
    let gain:GainNode|undefined;
    try{
      if(!loop){
        source=this.context.createBufferSource();gain=this.context.createGain();
        loop={source,gain};this.loops.set(kind,loop);
        source.buffer=buffer;source.loop=true;gain.gain.value=0;
        source.connect(gain);gain.connect(this.master);source.start();
      }
      loop.gain.gain.setTargetAtTime(level,this.context.currentTime,.25);
    }catch{
      // A failed recording lane stays silent instead of throwing or retrying each frame.
      this.buffers.delete(kind);
      this.stop(kind);
      if(!loop){
        try{source?.disconnect();}catch{/* unavailable audio graph */}
        try{gain?.disconnect();}catch{/* unavailable audio graph */}
      }
    }
  }
  private stop(kind:CitySound):void{
    const loop=this.loops.get(kind);if(!loop)return;
    this.loops.delete(kind);
    try{loop.source.stop();}catch{/* already stopped */}
    try{loop.source.disconnect();}catch{/* unavailable audio graph */}
    try{loop.gain.disconnect();}catch{/* unavailable audio graph */}
  }
  private stopAll():void{for(const kind of [...this.loops.keys()])this.stop(kind);}
  dispose():void{this.stopAll();this.buffers.clear();this.disposed=true;}
  get activeLoops():number{return this.loops.size;}
}
