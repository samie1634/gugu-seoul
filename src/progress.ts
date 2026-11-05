export const STORAGE_KEY = 'gugu-seoul.progress.v1';
export const LOOKS = [
  { id: 'pigeon', name: '도시 비둘기', subtitle: '익숙한 회색, 반짝이는 목깃', seconds: 0, color: '#7f91a0' },
  { id: 'white', name: '흰 비둘기', subtitle: '광장 위를 스치는 하얀 날개', seconds: 180, color: '#f5ede0' },
  { id: 'owl', name: '수리부엉이', subtitle: '동그란 눈과 뾰족한 귀깃', seconds: 480, color: '#b28a64' },
] as const;
export type LookId = typeof LOOKS[number]['id'];
export interface Progress { version: 1; activeSeconds: number; look: LookId; muted: boolean }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function freshProgress(): Progress {
  return { version: 1, activeSeconds: 0, look: 'pigeon', muted: false };
}

export function loadProgress(storage: StorageLike | null): Progress {
  try {
    const value: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return freshProgress();
    const p = value as Partial<Progress>;
    if (p.version !== 1 || typeof p.activeSeconds !== 'number' || !Number.isFinite(p.activeSeconds) || p.activeSeconds < 0) return freshProgress();
    const activeSeconds = Math.min(p.activeSeconds, 315360000);
    const look = LOOKS.find(l => l.id === p.look && l.seconds <= activeSeconds)?.id ?? 'pigeon';
    return { version: 1, activeSeconds, look, muted: p.muted === true };
  } catch { return freshProgress(); }
}

export function saveProgress(storage: StorageLike | null, progress: Progress): boolean {
  try { if (!storage) return false; storage.setItem(STORAGE_KEY, JSON.stringify(progress)); return true; }
  catch { return false; }
}

export function unlocked(look: LookId, seconds: number): boolean {
  return seconds >= (LOOKS.find(l => l.id === look)?.seconds ?? Infinity);
}

/** Hidden tabs, intro and dialogs do not contribute play time. */
export function addPlayTime(progress: Progress, delta: number, playing: boolean): LookId[] {
  if (!playing || !Number.isFinite(delta) || delta <= 0) return [];
  const before = progress.activeSeconds;
  progress.activeSeconds += Math.min(delta, 0.25);
  return LOOKS.filter(l => l.seconds > before && l.seconds <= progress.activeSeconds).map(l => l.id);
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
