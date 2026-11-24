import { pigeonCooCue, type CooCue } from './pigeon-coo.ts';
import { audioSha256, fetchAudioAsset, resolveAudioAsset, usableAudioResponse } from './audio-assets.ts';

export type AudioClipKind = 'coo' | 'flap' | 'flock' | 'splash' | 'wind' | 'conversation' | 'traffic' | 'sparrow' | 'crow' | 'tawny-owl' | 'eagle-owl' | 'duck';
export type AudioClipState = 'idle' | 'loading' | 'ready' | 'missing' | 'failed';

export interface AudioClipSegment {
  offsetSeconds: number;
  durationSeconds: number;
}

export interface AudioClipSelection {
  buffer: AudioBuffer;
  cooCue?: CooCue;
  offsetSeconds: number;
  durationSeconds?: number;
}

/** Paths are relative to the app page, including when hosted in a subdirectory. */
export const ORIGINAL_AUDIO_CLIPS = [
  { kind: 'coo', path: 'species-audio/assets/user-shortcalls-v1/pigeon-01.wav', sha256: 'c3fa7d0324e35d98577946891c2b1609b6ed28c8fa5a6761ef5201d528ad76c2' },
  { kind: 'coo', path: 'species-audio/assets/user-shortcalls-v1/pigeon-02.wav', sha256: 'ca272dfd5c143b811aa6681d173314f7332b053f831e55270e9f9d9df026819a' },
  { kind: 'coo', path: 'species-audio/assets/user-shortcalls-v1/pigeon-03.wav', sha256: 'eb52e3ef09da644f2ca680eee81a73026c2dbdf3c7b05b6160a8e81c63497ab6' },
  { kind: 'coo', path: 'species-audio/assets/user-shortcalls-v1/pigeon-04.wav', sha256: 'd764dab816327bd8facdaee1e650387c07aee6fcd80519566c77ccde5827934c' },
  { kind: 'coo', path: 'species-audio/assets/user-shortcalls-v1/pigeon-05.wav', sha256: '9f9328fed1ef61d6c7f597d98b266e14629903c68a5bfe9a1111014deb2d7608' },
  { kind: 'flap', path: 'species-audio/assets/user-wings-v2/bird-wings-598020.mp3', sha256: '300be343203f270a5f2e12e6e4670694944f01c660cd645228bcd5a1f59531e7', segment: { offsetSeconds: 1.720, durationSeconds: 0.150 } },
  { kind: 'splash', path: 'species-audio/assets/pixabay-water-v1/splash-79923.mp3', sha256: '802ad251e9fd9cebceadcb970d27567e73a93e083bc6c0bd31399f94d904e2aa' },
  { kind: 'wind', path: 'species-audio/assets/pixabay-city-v1/wind-316392.mp3', sha256: 'b9440cb77eb4c3ad8755f9db4bbb5b5cf0054178b7b719f798d108a00c351e08' },
  { kind: 'conversation', path: 'species-audio/assets/pixabay-city-v1/conversation-14573.mp3', sha256: '7b038f8a92d3bc46602251785f7dec4e14263990649a2994e031ab125918b750' },
  { kind: 'traffic', path: 'species-audio/assets/pixabay-city-v1/engine-82134.mp3', sha256: '506c0c9d4c91e2e2977d57a2b9916e8eb084eb816f3ee0a6a2a309a8e36fc54d' },
  { kind: 'flock', path: 'species-audio/assets/owner-originals-v1/wing-track-01.wav', sha256: 'e6cd298bac4e219831cc68121daafc963789271f32715c7f3d2c12c0a2d3ff55' },
  { kind: 'sparrow', path: 'species-audio/assets/pixabay-birds-v1/sparrow.mp3', sha256: '3bb57496bbaebfc286dc7aa699380a20398b323127c2945b3d4c8d15c6464a74', segment: {offsetSeconds: .4, durationSeconds: 8} },
  { kind: 'crow', path: 'species-audio/assets/pixabay-birds-v1/crow.mp3', sha256: '9bb50ed0a63ae008281507a6fbfcbf978e865b04c2bfb67cf6bde70bb8ca1a2c' },
  { kind: 'tawny-owl', path: 'species-audio/assets/pixabay-birds-v1/tawny-owl.mp3', sha256: '176972660892deb03f3ed1a66d99e94dc61154338c013b9395da3daeef265a62' },
  { kind: 'eagle-owl', path: 'species-audio/assets/pixabay-birds-v1/eagle-owl.mp3', sha256: '3d4b1d5658cc8311cc369331d8c10b5e3031942d6dbc4c45f2ea5ea6abba3cc0' },
  { kind: 'duck', path: 'species-audio/assets/cc0-duck-v1/duck.mp3', sha256: '599aab0d8a1be1214d2057cce21c03f79c3bc58ec0f106fe40a8d5b97fa32370' },
] as const;

interface Clip {
  kind: AudioClipKind;
  path: string;
  sha256: string;
  state: AudioClipState;
  error?: string;
  buffer?: AudioBuffer;
  segment?: AudioClipSegment;
}

export class OriginalAudioClips {
  private clips: Clip[] = ORIGINAL_AUDIO_CLIPS.map(clip => ({ ...clip, state: 'idle' }));
  private loading: Promise<void> | null = null;
  private nextIndex: Record<AudioClipKind, number> = { coo: 0, flap: 0, flock: 0, splash: 0, wind: 0, conversation: 0, traffic: 0, sparrow: 0, crow: 0, 'tawny-owl': 0, 'eagle-owl': 0, duck: 0 };

  get status() {
    const clips = this.clips.map(({ kind, path, sha256, state, error }) => ({ kind, path, sha256, state, error }));
    const state: AudioClipState = clips.some(clip => clip.state === 'loading') ? 'loading'
      : clips.some(clip => clip.state === 'failed') ? 'failed'
        : clips.some(clip => clip.state === 'missing') ? 'missing'
          : clips.every(clip => clip.state === 'ready') ? 'ready' : 'idle';
    return { state, clips };
  }

  load(context: AudioContext): Promise<void> {
    this.loading ??= Promise.all(this.clips.map(clip => this.loadClip(context, clip))).then(() => {});
    return this.loading;
  }

  next(kind: AudioClipKind): AudioClipSelection | null {
    // A wing recording must have a reviewed single-beat segment. Never play a
    // whole multi-beat recording if segment metadata is absent or invalid.
    const ready = this.clips.filter(clip => clip.kind === kind && clip.buffer && (kind !== 'flap' || clip.segment));
    if (!ready.length) return null;
    const clip = ready[this.nextIndex[kind]++ % ready.length];
    const buffer = clip.buffer;
    if (!buffer) return null;
    if (kind !== 'flap' && !clip.segment) return { buffer, offsetSeconds: 0, ...(kind === 'coo' ? { cooCue: pigeonCooCue(clip.sha256) } : {}) };
    const segment = clip.segment;
    if (!segment || !Number.isFinite(segment.offsetSeconds) || !Number.isFinite(segment.durationSeconds)
      || segment.offsetSeconds < 0 || segment.offsetSeconds >= buffer.duration || segment.durationSeconds <= 0) return null;
    return { buffer, offsetSeconds: segment.offsetSeconds, durationSeconds: Math.min(segment.durationSeconds, buffer.duration - segment.offsetSeconds) };
  }

  private async loadClip(context: AudioContext, clip: Clip): Promise<void> {
    clip.state = 'loading';
    let stage = 'fetch';
    try {
      const asset = resolveAudioAsset(clip.path);
      const response = await fetchAudioAsset(asset);
      if (response.status === 404 || response.status === 410) { clip.state = 'missing'; return; }
      if (!usableAudioResponse(response, asset.native)) throw Error(`http-${response.status}`);
      const bytes = await response.arrayBuffer();
      stage = 'integrity';
      const actual = await audioSha256(bytes, asset.native);
      if (actual !== clip.sha256) throw Error('sha256-mismatch');
      stage = 'decode';
      clip.buffer = await context.decodeAudioData(bytes);
      clip.state = 'ready';
    } catch {
      clip.state = 'failed'; clip.error = stage;
    }
  }
}
