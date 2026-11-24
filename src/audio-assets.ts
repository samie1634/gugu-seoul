/** Keep web sounds same-origin and allow only our bundled iOS asset namespace. */
export function resolveAudioAsset(path: string, pageHref = globalThis.location.href): { url: URL, native: boolean } {
  const page = new URL(pageHref), url = new URL(path, page);
  if (url.username || url.password) throw Error('origin');
  if (['http:', 'https:'].includes(page.protocol) && url.origin === page.origin) return { url, native: false };
  // URL.origin can be "null" for custom schemes; compare the exact protocol and host.
  if (page.protocol === 'capacitor:' && page.host === 'localhost' && !page.username && !page.password
    && url.protocol === 'capacitor:' && url.host === 'localhost' && url.pathname.startsWith('/species-audio/assets/')
    && !url.search && !url.hash) return { url, native: true };
  throw Error('origin');
}

export function fetchAudioAsset(asset: ReturnType<typeof resolveAudioAsset>): Promise<Response> {
  const options: RequestInit = {
    mode: asset.native ? 'cors' : 'same-origin', credentials: asset.native ? 'omit' : 'same-origin', redirect: 'error',
  };
  if (typeof AbortSignal.timeout === 'function') options.signal = AbortSignal.timeout(15000);
  return fetch(asset.url.href, options);
}

export function usableAudioResponse(response: Response, bundled: boolean): boolean {
  // WKURLSchemeHandler serves a local URLResponse, not an HTTPURLResponse.
  // Reject opaque or redirected zero-status responses and still verify decoded bytes.
  return response.ok || (bundled && response.status === 0 && response.type === 'basic');
}

const SHA256_ROUND = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotr = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));

/** FIPS 180-4 SHA-256. Only used for bounded bundled clips if WebKit omits Web Crypto. */
function bundledSha256(bytes: ArrayBuffer): string {
  if (bytes.byteLength > 32 * 1024 * 1024) throw Error('asset-size');
  const padded = new Uint8Array(Math.ceil((bytes.byteLength + 9) / 64) * 64);
  padded.set(new Uint8Array(bytes)); padded[bytes.byteLength] = 0x80;
  const data = new DataView(padded.buffer);
  data.setUint32(padded.length - 4, bytes.byteLength * 8);
  const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) words[j] = data.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) {
      const a = words[j - 15], b = words[j - 2];
      words[j] = words[j - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + words[j - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let [a,b,c,d,e,f,g,h] = state;
    for (let j = 0; j < 64; j++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_ROUND[j] + words[j]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
  }
  return [...state].map(word => word.toString(16).padStart(8, '0')).join('');
}

export async function audioSha256(bytes: ArrayBuffer, bundled: boolean): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  if (bundled) return bundledSha256(bytes);
  throw Error('integrity-unavailable');
}
