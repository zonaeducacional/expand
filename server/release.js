import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = createHash('sha256');

function addFile(path) {
  const bytes = readFileSync(join(root, path));
  hash.update(JSON.stringify([path, bytes.length]));
  hash.update(bytes);
}

function addDirectory(path) {
  for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path + '/' + entry.name;
    if (entry.isDirectory()) addDirectory(child);
    if (entry.isFile()) addFile(child);
  }
}

addDirectory('dist');
for (const file of readdirSync(join(root, 'server')).sort()) {
  if (file.endsWith('.js') || file.startsWith('package') && file.endsWith('.json')) addFile('server/' + file);
}

export const release = hash.digest('hex').slice(0, 20);
export const releaseHtml = readFileSync(join(root, 'dist/index.html'), 'utf8')
  .replace('content="__EXPAND_RELEASE__"', `content="${release}"`);
export const releaseWorker = readFileSync(join(root, 'dist/sw.js'), 'utf8')
  .replace("'__EXPAND_RELEASE__'", JSON.stringify(release));
