/** All sounds are synthesized locally, with no recordings or network requests. */
export class BirdAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  muted = false;
  cooCount = 0;
  flapCount = 0;

  async start(): Promise<void> {
    try {
      if (!this.context) {
        const ctx = new AudioContext();
        this.context = ctx;
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.32;
        this.master.connect(ctx.destination);
        const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
        const source = ctx.createBufferSource(); source.buffer = noise; source.loop = true;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 550;
        this.wind = ctx.createGain(); this.wind.gain.value = 0;
        source.connect(filter).connect(this.wind).connect(this.master); source.start();
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* The world stays usable when audio is unavailable. */ }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.32, this.context.currentTime, 0.06);
  }

  setFlight(flying: boolean): void {
    if (this.context && this.wind) this.wind.gain.setTargetAtTime(flying ? 0.10 : 0, this.context.currentTime, 0.4);
  }

  coo(owl = false): void {
    const ctx = this.context; const output = this.master;
    if (!ctx || !output) return;
    this.cooCount += 1;
    const now = ctx.currentTime;
    [0, 0.24, 0.52].forEach((delay, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      const start = now + delay;
      osc.type = 'sine'; osc.frequency.setValueAtTime(owl ? 310 : 470 - i * 30, start);
      osc.frequency.exponentialRampToValueAtTime(owl ? 245 : 320, start + 0.18);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.45, start + 0.045);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.23);
      osc.connect(gain).connect(output); osc.start(start); osc.stop(start + 0.25);
    });
  }

  flap(): void {
    const ctx = this.context; const output = this.master;
    if (!ctx || !output) return;
    this.flapCount += 1;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.16), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1100;
    const gain = ctx.createGain(); gain.gain.value = 0.2;
    source.connect(filter).connect(gain).connect(output); source.start();
  }
}
