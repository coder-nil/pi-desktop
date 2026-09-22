import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const args = process.argv.slice(2);
const check = args.includes('--check');
const next = args.includes('--next');
const setIndex = args.indexOf('--set');
let requestedVersion = setIndex === -1 ? undefined : args[setIndex + 1];
const problems = [];

if (check && requestedVersion) throw new Error('Use either --check or --set, not both.');
if (next && (check || setIndex !== -1)) throw new Error('Use --next on its own.');
if (setIndex !== -1 && !requestedVersion) throw new Error('Missing version after --set.');
if (requestedVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
  throw new Error(`Invalid version "${requestedVersion}". Use a semver value such as 1.2.3.`);
}

// 0.85.1-alpha.13 -> 0.85.1-alpha.14, 1.2.3 -> 1.2.4, 1.2.3-beta -> 1.2.3-beta.1
function nextVersion(current) {
  const [release, build] = current.split('+');
  const suffix = build ? `+${build}` : '';
  const counter = /^(\d+\.\d+\.\d+)-(.*?)(\d+)$/.exec(release);
  if (counter) return `${counter[1]}-${counter[2]}${Number(counter[3]) + 1}${suffix}`;
  const prerelease = /^(\d+\.\d+\.\d+)-([0-9A-Za-z.-]+)$/.exec(release);
  if (prerelease) return `${prerelease[1]}-${prerelease[2]}.1${suffix}`;
  const stable = /^(\d+)\.(\d+)\.(\d+)$/.exec(release);
  if (stable) return `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}${suffix}`;
  throw new Error(`Cannot derive the next version from "${current}". Use --set instead.`);
}

if (next) requestedVersion = nextVersion(JSON.parse(read('package.json')).version);

function localDate() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Regex-escape the version so 1.2.3 never matches an existing 1.2.30 heading.
function addChangelogSection(text) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^## \\[${escaped}\\]`, 'm').test(text)) return text;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const section = `## [${version}] - ${localDate()}\n\n### Changed\n\n- 应用、npm、Tauri 和 Cargo 版本号统一为 \`${version}\`。\n\n`.replace(/\n/g, newline);
  const firstEntry = text.search(/^## \[/m);
  if (firstEntry === -1) return `${text.trimEnd()}${newline}${newline}${section}`;
  return `${text.slice(0, firstEntry)}${section}${text.slice(firstEntry)}`;
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

// package.json is the single source of truth. Existing CHANGELOG entries are
// historical and are never rewritten; only a missing section for the current
// version is inserted, with the version-unification note that every entry has.
const version = JSON.parse(read('package.json')).version;

function update(path, transform, label = path) {
  const original = read(path);
  const next = transform(original);
  if (next === original) return;
  if (check) problems.push(label);
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
if (existsSync(resolve(root, 'CHANGELOG.md'))) {
  update('CHANGELOG.md', addChangelogSection, `CHANGELOG.md (missing section for ${version})`);
}
const tag = process.env.RELEASE_TAG || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
if (check && tag && tag !== `v${version}`) problems.push(`release tag ${tag} (expected v${version})`);
if (problems.length) {
  throw new Error(`Version mismatch: ${problems.join(', ')}. Run npm run version:sync.`);
}
console.log(`${check ? 'Verified' : 'Synchronized'} application version ${version}`);
if (next) {
  console.log('CHANGELOG.md: add the release notes to the new section before committing.');
  const verify = spawnSync(process.execPath, [script, '--check'], { stdio: 'inherit', env: process.env });
  if (verify.status !== 0) process.exit(verify.status ?? 1);
}
