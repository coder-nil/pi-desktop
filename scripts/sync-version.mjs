import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
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
/** 上一次 `--check` 的 changelog 校验结果；JSON 的修复流程要等它之后才能收尾。 */
let changelogOutOfDate = false;

if (check && requestedVersion) throw new Error('Use either --check or --set, not both.');
if (next && (check || setIndex !== -1)) throw new Error('Use --next on its own.');
if (setIndex !== -1 && !requestedVersion) throw new Error('Missing version after --set.');
if (requestedVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
  throw new Error(`Invalid version "${requestedVersion}". Use a semver value such as 1.2.3.`);
}

const PI_SDK_PACKAGE = '@earendil-works/pi-coding-agent';

/**
 * Release part of the application version. The version is always
 * `<pi sdk version>-alpha.<sequence>`: the release follows the pi SDK the
 * desktop is built on, and `alpha.N` counts our own releases on top of it
 * (1.2.0-alpha.17 on pi 1.4.0 → 1.4.0-alpha.18).
 */
function readPiSdkVersion(pkg) {
  const declared = { ...pkg.dependencies, ...pkg.devDependencies }[PI_SDK_PACKAGE];
  if (typeof declared !== 'string') {
    throw new Error(
      `Cannot read ${PI_SDK_PACKAGE} from package.json. Use --set instead.`,
    );
  }
  // Accept an exact pin or a range/caret/tilde: only the release triple matters.
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(declared);
  if (!match) throw new Error(`Cannot parse the pi SDK version "${declared}". Use --set instead.`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/** `1.2.0-alpha.17` + pi `1.4.0` → `1.4.0-alpha.18`; a plain `1.2.3` starts at `alpha.1`. */
function nextVersion(current, piVersion) {
  const [release, build] = current.split('+');
  const suffix = build ? `+${build}` : '';
  const alpha = /-alpha\.(\d+)$/.exec(release);
  return `${piVersion}-alpha.${alpha ? Number(alpha[1]) + 1 : 1}${suffix}`;
}

if (next) {
  const pkg = JSON.parse(read('package.json'));
  requestedVersion = nextVersion(pkg.version, readPiSdkVersion(pkg));
}

function localDate() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 提交类型 → 发布说明小节；没有匹配的类型（或中文直述提交）归入 Changed。 */
const RELEASE_NOTE_SECTIONS = [
  [/^feat(?:\([^)]*\))?!?:/i, 'Added'],
  [/^fix(?:\([^)]*\))?!?:/i, 'Fixed'],
];
/**
 * 不进发布说明的提交：测试、CI、文档，以及发布流程自己生成的版本号提交。
 * 它们对使用者没有可见变化，写进 CHANGELOG 只会成为噪声。
 */
const SKIP_RELEASE_NOTE_COMMIT =
  /^(?:test|ci|docs)(?:\([^)]*\))?!?:|^build\(version\)|^chore\((?:release|version|ci|workflow)\)/i;

function gitOutput(args) {
  try {
    const result = spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

/**
 * 提交范围的起点：上一个发布版本的 tag（CHANGELOG 最新小节），tag 不存在时
 * 退到最近的 tag。只在 root 就是仓库根时使用，否则会误拿外层仓库的历史。
 */
function releaseRangeStart(changelogText) {
  const topLevel = gitOutput(['rev-parse', '--show-toplevel']);
  if (!topLevel) return undefined;
  // 比较真实路径：macOS 的 /var 是 /private/var 的符号链接。
  const realpath = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  if (realpath(topLevel) !== realpath(root)) return undefined;

  const previous = /^## \[([^\]]+)\]/m.exec(changelogText);
  if (previous && gitOutput(['rev-parse', '--verify', '--quiet', `refs/tags/v${previous[1]}`]) !== null) {
    return `v${previous[1]}`;
  }
  return gitOutput(['describe', '--tags', '--abbrev=0']) ?? null;
}

/**
 * 从上一个发布点之后的所有提交生成发布说明草稿，让新版本小节不再只有
 * 一句版本号：`--next` 插进去的就是「这段时间做了什么」，润色比从零写好。
 */
function collectReleaseNotes(changelogText) {
  const start = releaseRangeStart(changelogText);
  if (start === undefined) return {};

  const log = gitOutput([
    'log', '--no-merges', '--reverse', '--pretty=%s',
    ...(start ? [`${start}..HEAD`] : []),
  ]);
  if (!log) return {};

  const notes = {};
  for (const subject of log.split('\n').map((line) => line.trim()).filter(Boolean)) {
    if (SKIP_RELEASE_NOTE_COMMIT.test(subject)) continue;
    const section = RELEASE_NOTE_SECTIONS.find(([pattern]) => pattern.test(subject))?.[1] ?? 'Changed';
    const text = subject.replace(/^[A-Za-z]+(?:\([^)]*\))?!?:\s*/, '').trim();
    if (!text) continue;
    (notes[section] ??= []).push(`${text.replace(/[.。!！?？]$/, '')}。`);
  }
  return notes;
}

// Regex-escape the version so 1.2.3 never matches an existing 1.2.30 heading.
function addChangelogSection(text) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^## \\[${escaped}\\]`, 'm').test(text)) return text;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';

  // 每个小节都以一条「版本号统一」收尾，这是本仓库固定的写法。
  const notes = collectReleaseNotes(text);
  const blocks = [];
  for (const title of ['Added', 'Changed', 'Fixed']) {
    const items = [...(notes[title] ?? [])];
    if (title === 'Changed') items.push(`应用、npm、Tauri 和 Cargo 版本号统一为 \`${version}\`。`);
    if (items.length === 0) continue;
    blocks.push(`### ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}`);
  }

  const section = `## [${version}] - ${localDate()}\n\n${blocks.join('\n\n')}\n\n`.replace(/\n/g, newline);
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
// `data/changelog.json` 是「关于」对话框读取的变更记录，由 CHANGELOG.md 生成。
// 非 --check 时先同步一次（--set / --next 可能刚插入一个空的小节），再看它是否仍过期。
const changelogCheck = () => spawnSync(
  process.execPath,
  [resolve(root, 'scripts/sync-changelog.mjs'), '--check'],
  { encoding: 'utf8' },
);
if (existsSync(resolve(root, 'CHANGELOG.md'))) {
  if (!check) spawnSync(process.execPath, [resolve(root, 'scripts/sync-changelog.mjs')], { stdio: 'inherit' });
  if (changelogCheck().status !== 0) {
    changelogOutOfDate = true;
    if (check) problems.push('data/changelog.json (out of date)');
  }
}
const tag = process.env.RELEASE_TAG || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
if (check && tag && tag !== `v${version}`) problems.push(`release tag ${tag} (expected v${version})`);
if (problems.length) {
  throw new Error(`Version mismatch: ${problems.join(', ')}. Run npm run version:sync.`);
}
console.log(`${check ? 'Verified' : 'Synchronized'} application version ${version}`);
if (changelogOutOfDate) {
  console.log('CHANGELOG.md: fill in the release notes, then run `npm run changelog:sync`.');
}
if (next) {
  console.log('CHANGELOG.md: add the release notes to the new section before committing.');
  const verify = spawnSync(process.execPath, [script, '--check'], { stdio: 'inherit', env: process.env });
  if (verify.status !== 0) process.exit(verify.status ?? 1);
}
