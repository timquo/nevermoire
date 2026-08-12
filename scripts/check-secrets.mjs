import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const skippedDirectories = new Set([
  '.git',
  '.npm-cache',
  'coverage',
  'demo-output',
  'dist',
  'node_modules',
  'real-test-feather',
  'real-test-parrot',
  'real-test-shirt',
]);
const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.txt', '.yaml', '.yml',
]);
const patterns = [
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['credential assignment', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*["'][^"'\n]{8,}["']/gi],
  ['credential-bearing URL', /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s]+/gi],
  ['developer home path', /(?:[A-Za-z]:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+)/g],
];

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename, output);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) output.push(filename);
  }
  return output;
}

const findings = [];
for (const filename of walk(root)) {
  const relative = path.relative(root, filename);
  const content = fs.readFileSync(filename, 'utf8');
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push(`${relative}:${line}: ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Potential secrets or personal paths detected:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Secret scan passed.');
}
