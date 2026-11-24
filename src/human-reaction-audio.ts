import { audioSha256, fetchAudioAsset, resolveAudioAsset, usableAudioResponse } from './audio-assets.ts';

export const HUMAN_SCREAM_CLIP = Object.freeze({
  path: 'species-audio/assets/pixabay-human-v1/female-startle-251067.mp3',
  sha256: '4a04e0df062f4457fcbca40f134a8c4c59aab38ef5033c2c4371ada3c772f64f',
  source: 'https://pixabay.com/sound-effects/people-female-scream-short-251067/',
  author: 'WakanaTsukiko',
});
interface Point { x: number; y: number; z: number }
/** Verified recording only. Missing, muted, stale or repeated reactions stay silent. */
export class HumanReactionAudio {
  private buffer: AudioBuffer | null = null;
  private loading: Promise<void> | null = null;
  private voice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private after = -Infinity;
  private actorAfter = new Map<string, number>();
  private seen = new Set<string>();
  state: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';
  load(context: AudioContext): Promise<void> {
    this.loading ??= (async () => {
      this.state = 'loading';
      try {
        const asset = resolveAudioAsset(HUMAN_SCREAM_CLIP.path);
        const response = await fetchAudioAsset(asset);
        if (!usableAudioResponse(response, asset.native)) throw Error('missing');
        const bytes = await response.arrayBuffer();
        if (await audioSha256(bytes, asset.native) !== HUMAN_SCREAM_CLIP.sha256) throw Error('integrity');
        const buffer = await context.decodeAudioData(bytes);
        if (!(buffer.duration > 0 && buffer.duration < 3)) throw Error('duration');
        this.buffer = buffer; this.state = 'ready';
      } catch { this.buffer = null; this.state = 'unavailable'; }
    })();
    return this.loading;
  }
  play(context: AudioContext, output: AudioNode, eventId: string, actorId: string, sourcePosition: Point, listener: Point, enabled = true): boolean {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId); if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
    if (!enabled || !this.buffer || context.state !== 'running' || this.voice) return false;
    const now = context.currentTime, distance = Math.hypot(sourcePosition.x - listener.x, sourcePosition.y - listener.y, sourcePosition.z - listener.z);
    if (!Number.isFinite(distance) || distance > 14 || now < this.after || now < (this.actorAfter.get(actorId) ?? -Infinity)) return false;
    const source = context.createBufferSource(), gain = context.createGain(); source.buffer = this.buffer; source.playbackRate.value = 1;
    gain.gain.value = .7 / (1 + distance * distance * .22); source.connect(gain).connect(output);
    const voice = { source, gain }; this.voice = voice; this.after = now + 4; this.actorAfter.set(actorId, now + 12);
    if (this.actorAfter.size > 128) this.actorAfter.delete(this.actorAfter.keys().next().value!);
    source.onended = () => { if (this.voice === voice) this.voice = null; source.disconnect(); gain.disconnect(); };
    source.start(now, 0); return true;
  }
  stop() {
    if (!this.voice) return;
    const { source, gain } = this.voice; this.voice = null; source.onended = null;
    try { source.stop(); } catch { /* Already finished. */ }
    source.disconnect(); gain.disconnect();
  }
}
