import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';

const root = resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true }).trim());
const here = resolve(process.cwd());
if (root !== here || JSON.parse(readFileSync('package.json', 'utf8')).name !== 'gugu-seoul') throw Error('Run only at the independent gugu-seoul repository root.');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
if (!files.length) throw Error('No tracked files to inspect.');
const problems = [];
const forbidden = /(^|\/)(?:node_modules|dist|qa-local|\.pnpm-store|\.cache|\.aws|\.codex|\.agents)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12)$|(^|\/)(?:id_rsa|id_ed25519|credentials|auth\.json)$/i;
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['provider credential', /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/],
  ['cloud access key', /\bAKIA[A-Z0-9]{16}\b/],
  ['local personal path', /C:\\Users\\[^\\\r\n]+\\(?:Documents|AppData)/i],
  ['credential-bearing URL', /https?:\/\/[^\s/@:]+:[^\s/@]+@/],
];
for (const file of files) {
  const target = resolve(root, file);
  if (relative(root, target).startsWith('..') || forbidden.test(file)) { problems.push(`${file}: forbidden path`); continue; }
  if (!existsSync(target)) { problems.push(`${file}: missing`); continue; }
  const buffer = readFileSync(target);
  if (/\.(?:jpe?g|png)$/i.test(file)) continue;
  if (buffer.includes(0)) { problems.push(`${file}: unreviewed binary`); continue; }
  const text = buffer.toString('utf8');
  for (const [name, pattern] of rules) if (pattern.test(text)) problems.push(`${file}: ${name}`);
}
for (const required of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'ATTRIBUTION.md', 'README.md']) if (!files.includes(required)) problems.push(`${required}: not tracked`);
if (basename(root) !== 'gugu-seoul') problems.push('Unexpected repository directory');
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`Public-file audit passed: ${files.length} tracked files; no prohibited paths or credential patterns detected.`);
