import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const args = process.argv.slice(2);
const check = args.includes('--check');
const setIndex = args.indexOf('--set');
const requestedVersion = setIndex === -1 ? undefined : args[setIndex + 1];
const problems = [];

if (check && requestedVersion) throw new Error('Use either --check or --set, not both.');
if (setIndex !== -1 && !requestedVersion) throw new Error('Missing version after --set.');
if (requestedVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
  throw new Error(`Invalid version "${requestedVersion}". Use a semver value such as 1.2.3.`);
}

function stringifyJson(data, template) {
  const newline = template.includes('\r\n') ? '\r\n' : '\n';
  return (JSON.stringify(data, null, 2) + '\n').replace(/\n/g, newline);
}

if (requestedVersion) {
  const original = read('package.json');
  const data = JSON.parse(original);
  if (data.version !== requestedVersion) {
    data.version = requestedVersion;
    writeFileSync(resolve(root, 'package.json'), stringifyJson(data, original));
  }
}

// package.json is the single source of truth. CHANGELOG entries are historical.
const version = JSON.parse(read('package.json')).version;

function update(path, transform) {
  const original = read(path);
  const next = transform(original);
  if (next === original) return;
  if (check) problems.push(path);
  else writeFileSync(resolve(root, path), next);
}
update('package-lock.json', (text) => {
  const data = JSON.parse(text);
  // Check version fields, not serialized formatting (Windows checkouts use CRLF).
  if (data.version === version && data.packages[''].version === version) return text;
  data.version = version;
  data.packages[''].version = version;
  return stringifyJson(data, text);
});
update('src-tauri/tauri.conf.json', (text) => {
  const data = JSON.parse(text);
  if (data.version === version) return text;
  data.version = version;
  return stringifyJson(data, text);
});
update('README.md', (text) => {
  const next = text.replace(/^(UI version: `v)[^`]+(`)$/m, `$1${version}$2`);
  if (next === text && !/^UI version: `v/m.test(text)) problems.push('README.md (UI version line not found)');
  return next;
});
for (const path of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
  update(path, (text) => {
    return text.replace(/(name = "pi-desktop"\r?\nversion = ")[^"]+("?)/, `$1${version}$2`);
  });
}
const tag = process.env.RELEASE_TAG || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
if (check && tag && tag !== `v${version}`) problems.push(`release tag ${tag} (expected v${version})`);
if (problems.length) {
  throw new Error(`Version mismatch: ${problems.join(', ')}. Run npm run version:sync.`);
}
console.log(`${check ? 'Verified' : 'Synchronized'} application version ${version}`);
