import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, process.argv[2] ?? '.cache/test-results');
const relative = path.relative(path.join(root, '.cache'), output);
if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Test output must be inside .cache');
fs.mkdirSync(path.join(output, 'evidence'), { recursive: true });
const tests = ['tests', 'tests/core'].flatMap(directory =>
  fs.readdirSync(path.join(root, directory)).filter(name => name.endsWith('.test.mjs')).sort()
    .map(name => path.join(root, directory, name)));
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: output, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
