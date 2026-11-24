import { readFileSync } from 'node:fs';

const basename = 'icons/gugu-seoul-favicon-411b6fb841e2.ico';
const frames = [
  [16, '../release/build7-icon-assets/16.png'],
  [32, '../public/icons/gugu-seoul-favicon-411b6fb841e2-32.png'],
  [48, '../release/build7-icon-assets/48.png'],
];

function encodeIco() {
  const entries = frames.map(([size, file]) => [size, readFileSync(new URL(file, import.meta.url))]);
  const directory = Buffer.alloc(6 + 16 * entries.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);
  let offset = directory.length;
  for (const [i, [size, png]] of entries.entries()) {
    const entry = 6 + 16 * i;
    directory[entry] = directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(24, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  }
  return Buffer.concat([directory, ...entries.map(([, png]) => png)]);
}

/** Emit only the three reviewed PNG frames as one deterministic web ICO. */
export const build7Favicon = {
  name: 'gugu-seoul-build7-favicon',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: basename, source: encodeIco() });
  },
  configureServer(server) {
    server.middlewares.use('/' + basename, (_req, res) => {
      res.setHeader('Content-Type', 'image/vnd.microsoft.icon');
      res.end(encodeIco());
    });
  },
};
