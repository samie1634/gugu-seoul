import { createNameSeed } from './names.ts';
import { PeerBuffer, type PlayerState, type StateMessage } from './state.ts';
export interface Transport {
  exchange(message: StateMessage & {sessionKey: string}, signal: AbortSignal): Promise<unknown>;
  leave(sessionKey: string, sequence: number): void;
}
export function httpTransport(endpoint: string): Transport {
  const send = (body: unknown, signal?: AbortSignal, keepalive = false) => fetch(endpoint, {
    method:'POST', credentials:'omit', cache:'no-store', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body:JSON.stringify(body), signal, keepalive,
  });
  return {
    async exchange(message, signal) { const response=await send(message,signal); if (!response.ok) throw new Error(`Multiplayer HTTP ${response.status}`); return response.json(); },
    leave(sessionKey,sequence) { void send({v:1,type:'leave',sessionKey,sequence},undefined,true).catch(()=>{}); },
  };
}
export function createSessionKey(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(''); }
/** One outstanding exchange, bounded retries, and generation guards for hidden/resumed tabs. */
export class MultiplayerClient {
  readonly peers = new PeerBuffer();
  readonly nameSeed = createNameSeed();
  private active = false;
  private sessionKey = '';
  private sequence = 0;
  private nextAt = 0;
  private failures = 0;
  private pending: AbortController | null = null;
  private generation = 0;
  private latest: PlayerState | null = null;
  private transport: Transport;
  private now: ()=>number;
  private key: ()=>string;
  constructor(transport: Transport, now: ()=>number = ()=>performance.now(), key: ()=>string = createSessionKey) { this.transport=transport; this.now=now; this.key=key; }
  update(state: PlayerState, enabled: boolean): void {
    this.latest = {...state,nameSeed:this.nameSeed};
    if (!enabled) { this.pause(); return; }
    if (!this.active) { this.active=true; this.sessionKey=this.key(); this.sequence=0; this.nextAt=0; this.failures=0; }
    if (!this.pending && this.now()>=this.nextAt) void this.exchange();
  }
  private async exchange(): Promise<void> {
    const controller = new AbortController(), generation=this.generation;
    this.pending=controller;
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const snapshot=await this.transport.exchange({v:1,type:'state',sessionKey:this.sessionKey,sequence:++this.sequence,state:{...this.latest!}},controller.signal);
      if (generation!==this.generation) return;
      if (!this.peers.accept(snapshot,this.now())) throw new Error('Invalid multiplayer snapshot');
      this.failures=0; this.nextAt=this.now()+250;
    } catch {
      if (generation!==this.generation) return;
      this.failures++; this.nextAt=this.now()+Math.min(15000,500*2**Math.min(this.failures-1,5));
    } finally { clearTimeout(timeout); if (generation===this.generation) this.pending=null; }
  }
  pause(): void {
    if (!this.active) return;
    this.active=false; this.generation++; this.pending?.abort(); this.pending=null;
    this.transport.leave(this.sessionKey,++this.sequence); this.sessionKey=''; this.peers.clear();
  }
}
