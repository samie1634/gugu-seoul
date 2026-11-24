const FIRST = ['구름','보리','솜털','햇살','달빛','콩알','바람','모찌','도토리','푸딩','초롱','노을','눈송이','봉봉','파도','별빛'];
const LAST = ['구구','날개','콩','깃털','송이','토리','꼬미','둥이','뽀','몽','복이','밀크','솔','루','누리','초코'];
/** Public random game identity only. It is not an account identifier or a credential. */
export function createNameSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>n.toString(16).padStart(2,'0')).join('');
}
export function validNameSeed(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value); }
/** Every observer derives the same name without accepting user-entered text. */
export function pigeonName(seed: string): string {
  let hash=2166136261;
  for (let i=0;i<seed.length;i++) hash=Math.imul(hash^seed.charCodeAt(i),16777619)>>>0;
  return `${FIRST[hash&15]}${LAST[(hash>>>4)&15]} ${(hash>>>8).toString(36).toUpperCase().padStart(5,'0')}`;
}
