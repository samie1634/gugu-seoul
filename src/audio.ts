import { pigeonCooForwardOffset, type CooCue } from './pigeon-coo.ts';
import { HumanReactionAudio } from './human-reaction-audio.ts';
import { CityAmbience, type CityEmitter, type SoundPoint } from './city-ambience.ts';
import { OriginalAudioClips, type AudioClipKind } from './audio-clips.ts';

interface Voice {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  cooMotion?: { cue: CooCue; at: number; duration: number };
}

/** Original recordings load after start(); unavailable recordings stay silent. */
export class BirdAudio {
  private city: CityAmbience | null = null;
  private cityLoaded = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private originals = new OriginalAudioClips();
  private humanReactions = new HumanReactionAudio();
  private unlocking: Promise<void> | null = null;
  private voices = new Map<AudioClipKind, Voice>();
  private active = true;
  private isMuted = false;
  cooCount = 0;
  flapCount = 0;
  flockCount = 0;
  splashCount = 0;

  speciesCallCounts: Record<string, number> = {};
  private lastFlockCall = -Infinity;
  private speciesCursor = 0;

  /** Only currently visible nearby birds may emit. No substitute sound for unsupported species. */
  flockCall(birds: readonly { species: string; breed?: string; plumage?: string; visible: boolean; x: number; y: number; z: number }[], listener: { x: number; y: number; z: number }, simTime: number): void {
    if (!Number.isFinite(simTime) || simTime < this.lastFlockCall + 12) return;
    const candidates = ['sparrow', 'crow', 'tawny-owl', 'eagle-owl', 'duck'] as const;
    for (let i = 0; i < candidates.length; i++) {
      const kind = candidates[(this.speciesCursor + i) % candidates.length];
      const distances = birds.filter(b => b.visible && b.species === kind && (kind !== 'duck' || (b.plumage === 'hen' && b.breed !== 'call-duck'))).map(b=>Math.hypot(b.x-listener.x,b.y-listener.y,b.z-listener.z));
      const distance = Math.min(...distances);
      const level = (kind==='sparrow'?.22:.3) * Math.max(0,1-distance/35);
      if (level>.006 && this.callSpecies(kind, level)) { this.lastFlockCall = simTime; this.speciesCursor = (this.speciesCursor+i+1)%candidates.length; return; }
    }
  }

  callSpecies(species: string, level = .25): boolean {
    if (!['sparrow','crow','tawny-owl','eagle-owl','duck'].includes(species) || !this.context || this.context.state !== 'running' || this.muted || !this.active || [...this.voices.keys()].some(k=>k!=='flap')) return false;
    if (!Number.isFinite(level) || level <= 0 || !this.playOriginal(species as AudioClipKind, Math.min(1,level))) return false;
    this.speciesCallCounts[species]=(this.speciesCallCounts[species]??0)+1;return true;
  }

  get muted(): boolean { return this.isMuted; }
  set muted(value: boolean) { this.setMuted(value); }
  get needsUnlock(): boolean {
    return !this.unlocking && (!this.context || (this.context.state !== 'running' && this.context.state !== 'closed'));
  }

  get pigeonCooMotion(): { forward: number } | null {
    const context = this.context;
    const motion = this.voices.get('coo')?.cooMotion;
    if (!motion || !context || context.state !== 'running' || this.muted || !this.active) return null;
    const elapsed = context.currentTime - motion.at;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= motion.duration) return null;
    return { forward: pigeonCooForwardOffset(elapsed, motion.cue) };
  }

  get originalAudioStatus() { return this.originals.status; }

  get humanReactionAudioStatus() { return this.humanReactions.state; }

  async start(): Promise<void> {
    try {
      if (!this.context) {
        const ctx = new AudioContext();
        this.context = ctx;
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.32;
        this.master.connect(ctx.destination);
        this.city = new CityAmbience(ctx, this.master);

      }
      const ctx = this.context;
      if (this.needsUnlock) {
        this.unlocking = ctx.resume().finally(() => { this.unlocking = null; });
      }
      // Begin fetching only in this user-gesture entry point. Never queue coo/flap calls.
      await Promise.all([this.unlocking, this.originals.load(ctx), this.humanReactions.load(ctx)]);
      if(!this.cityLoaded){
        for(const kind of ['wind','conversation','traffic'] as const){const clip=this.originals.next(kind);if(clip)this.city?.supply(kind,clip.buffer);}
        this.cityLoaded=true;
      }
    } catch { /* The world stays usable when audio is unavailable. */ }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) { this.stopVoices(); this.city?.update({x:0,y:0,z:0},[],[],false,true); }
    if (this.context && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.32, this.context.currentTime, 0.06);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) { this.city?.update({x:0,y:0,z:0},[],[],false,false); this.stopVoices(); this.setFlight(false); }
  }

  cityAmbience(listener: SoundPoint, pairs: readonly CityEmitter[], cars: readonly CityEmitter[] = []): void {
    this.city?.update(listener, cars, pairs, this.active, this.muted);
  }

  setFlight(_flying: boolean): void {
    void _flying;
    // No generated wind: only supplied recordings may produce sound.
  }

  coo(owl = false): void {
    if (owl) { this.callSpecies('eagle-owl', .5); return; }
    const ctx = this.context;
    if (owl || !ctx || ctx.state !== 'running' || this.muted || !this.active || this.voices.has('coo')) return;
    if (this.playOriginal('coo')) this.cooCount += 1;
  }

  cancelPigeonCoo(): void {
    const voice = this.voices.get('coo');
    if (!voice) return;
    this.voices.delete('coo');
    for (const source of voice.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* The source may have ended already. */ }
    }
    for (const node of voice.nodes) node.disconnect();
  }

  flap(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.muted || !this.active || this.voices.has('flap')) return;
    if (this.playOriginal('flap')) this.flapCount += 1;
  }

  flockTakeoff(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.muted || !this.active || this.voices.has('flock')) return;
    if (this.playOriginal('flock')) this.flockCount += 1;
  }

  splash(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.muted || !this.active || this.voices.has('splash')) return;
    if (this.playOriginal('splash')) this.splashCount += 1;
  }

  humanScream(eventId: string, actorId: string, at: SoundPoint, listener: SoundPoint): boolean {
    if (!this.context || !this.master) return false;
    return this.humanReactions.play(this.context, this.master, eventId, actorId, at, listener, this.active && !this.muted);
  }

  private playOriginal(kind: AudioClipKind, level = 1): boolean {
    const clip = this.originals.next(kind);
    if (!clip || !this.context || !this.master) return false;
    const { buffer, offsetSeconds, durationSeconds, cooCue } = clip;
    if (kind === 'flap' && durationSeconds === undefined) return false;
    const source = this.context.createBufferSource();
    source.buffer = buffer; source.playbackRate.value = 1; source.loop = false;
    const now = this.context.currentTime;
    if (kind === 'flap' && durationSeconds !== undefined) {
      const gain = this.context.createGain();
      const attack = Math.min(0.005, durationSeconds / 2);
      const release = Math.min(0.010, durationSeconds / 2);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + attack);
      gain.gain.setValueAtTime(1, now + durationSeconds - release);
      gain.gain.linearRampToValueAtTime(0, now + durationSeconds);
      source.connect(gain).connect(this.master);
      this.trackVoice(kind, { sources: [source], nodes: [source, gain] });
      source.start(now, offsetSeconds, durationSeconds);
    } else if (level !== 1 || durationSeconds !== undefined) {
      const gain=this.context.createGain();gain.gain.value=level;
      if(durationSeconds!==undefined){
        gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(level,now+.01);
        gain.gain.setValueAtTime(level,now+Math.max(.01,durationSeconds-.03));gain.gain.linearRampToValueAtTime(0,now+durationSeconds);
      }
      source.connect(gain).connect(this.master);
      this.trackVoice(kind,{sources:[source],nodes:[source,gain]});source.start(now,offsetSeconds,durationSeconds);
    } else {
      source.connect(this.master);
      source.start(now, offsetSeconds);
      this.trackVoice(kind, { sources: [source], nodes: [source],
        ...(cooCue && kind === 'coo' ? { cooMotion: { cue: cooCue, at: now, duration: buffer.duration - offsetSeconds } } : {}),
      });
    }
    return true;
  }

  private trackVoice(kind: AudioClipKind, voice: Voice): void {
    this.voices.set(kind, voice);
    const pending = new Set(voice.sources);
    for (const source of voice.sources) source.onended = () => {
      pending.delete(source);
      if (!pending.size) {
        if (this.voices.get(kind) === voice) this.voices.delete(kind);
        for (const node of voice.nodes) node.disconnect();
      }
    };
  }

  private stopVoices(): void {
    this.humanReactions.stop();
    for (const voice of this.voices.values()) {
      for (const source of voice.sources) {
        source.onended = null;
        try { source.stop(); } catch { /* Already ended sources need no further stop. */ }
      }
      for (const node of voice.nodes) node.disconnect();
    }
    this.voices.clear();
  }
}
