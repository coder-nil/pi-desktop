import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const version = JSON.parse(read('package.json')).version;
const check = process.argv.includes('--check');
const problems = [];
function update(path, transform) {
  const original = read(path);
  const next = transform(original);
  if (next === original) return;
  if (check) problems.push(path);
  else writeFileSync(resolve(root, path), next);
}
update('package-lock.json', (text) => {
  const data = JSON.parse(text);
  data.version = version;
  data.packages[''].version = version;
  return JSON.stringify(data, null, 2) + '\n';
});
update('src-tauri/tauri.conf.json', (text) => {
  const data = JSON.parse(text);
  data.version = version;
  return JSON.stringify(data, null, 2) + '\n';
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
