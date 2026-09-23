import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const { parseChangelog } = await import('../scripts/sync-changelog.mjs');

function fixture(t, newline, indent, currentVersion = '1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'pi-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'src-tauri'));
  mkdirSync(join(root, 'data'));
  copyFileSync(new URL('../scripts/sync-version.mjs', import.meta.url), join(root, 'scripts/sync-version.mjs'));
  copyFileSync(new URL('../scripts/sync-changelog.mjs', import.meta.url), join(root, 'scripts/sync-changelog.mjs'));
  const version = currentVersion;
  const json = (path, data) => writeFileSync(join(root, path), JSON.stringify(data, null, indent).replace(/\n/g, newline));
  json('package.json', { version });
  json('package-lock.json', { version, packages: { '': { version } } });
  json('src-tauri/tauri.conf.json', { version, productName: 'Pi Desktop' });
  writeFileSync(join(root, 'README.md'), `UI version: \`v${version}\`${newline}`);
  writeFileSync(join(root, 'CHANGELOG.md'),
    `# Changelog${newline}${newline}所有重要变更都会记录在此文件中。${newline}${newline}## [${version}] - 2026-01-01${newline}${newline}### Changed${newline}${newline}- 版本号统一为 \`${version}\`。${newline}`);
  for (const file of ['Cargo.toml', 'Cargo.lock']) {
    writeFileSync(join(root, 'src-tauri', file), `name = "pi-desktop"${newline}version = "${version}"${newline}`);
  }
  // `sync-version.mjs --check` 会校验 data/changelog.json，所以夹具得先把
  // 它生成一遍（真实仓库里这一步由 `npm run changelog:sync` 完成）。
  writeFileSync(join(root, 'data', 'changelog.json'),
    `${JSON.stringify(parseChangelog(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')), null, 2)}\n`);
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/sync-version.mjs'), ...args], {
    encoding: 'utf8', env: { ...process.env, RELEASE_TAG: '', GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '' },
  });
  return { root, run, version, json };
}

for (const [name, newline, indent] of [['LF', '\n', 2], ['CRLF', '\r\n', 4], ['tabs', '\r\n', '\t']]) {
  test(`version check accepts ${name} formatting without rewriting`, (t) => {
    const { root, run } = fixture(t, newline, indent);
    const paths = ['package-lock.json', 'src-tauri/tauri.conf.json', 'README.md', 'CHANGELOG.md'];
    const before = paths.map(p => readFileSync(join(root, p), 'utf8'));
    for (const args of [['--check'], []]) {
      const result = run(...args);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(paths.map(p => readFileSync(join(root, p), 'utf8')), before);
    }
  });
}

test('sets package.json and synchronizes every derived version field', (t) => {
  const { root, run, version } = fixture(t, '\n', 2);
  const nextVersion = '1.2.4';

  const result = run('--set', nextVersion);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, nextVersion);
  assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).version, nextVersion);
  assert.equal(JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version, nextVersion);
  assert.match(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8'), new RegExp(`version = "${nextVersion}"`));
  assert.match(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8'), new RegExp(`version = "${nextVersion}"`));
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), new RegExp(`UI version: \`v${nextVersion}\``));
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${nextVersion.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
  assert.match(changelog, new RegExp(`版本号统一为 \`${nextVersion.replace(/\./g, '\\.')}\``));
  assert.equal(changelog.match(new RegExp(`^## \\[${nextVersion.replace(/\./g, '\\.')}\\]`, 'gm')).length, 1);
  assert.equal(changelog.indexOf(`## [${nextVersion}]`) < changelog.indexOf(`## [${version}]`), true);
  assert.equal(run('--set', nextVersion).status, 0);
  assert.equal(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), changelog);
  assert.equal(run('--check').status, 0);
});

test('check fails and sync backfills a missing changelog section', (t) => {
  const { root, run, version } = fixture(t, '\n', 2);
  const path = join(root, 'CHANGELOG.md');
  writeFileSync(path, `# Changelog\n\n所有重要变更都会记录在此文件中。\n`);

  const result = run('--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CHANGELOG\.md \(missing section for 1\.2\.3\)/);
  assert.equal(run().status, 0);
  assert.match(readFileSync(path, 'utf8'), new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
  assert.equal(run('--check').status, 0);
});

test('backfilled changelog keeps the checkout newline style', (t) => {
  const { root, run, version } = fixture(t, '\r\n', 2);
  const path = join(root, 'CHANGELOG.md');
  writeFileSync(path, `# Changelog\r\n\r\n所有重要变更都会记录在此文件中。\r\n\r\n## [0.0.1] - 2026-01-01\r\n\r\n### Changed\r\n\r\n- 旧版本。\r\n`);

  assert.equal(run().status, 0);
  const changelog = readFileSync(path, 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
  assert.equal(changelog.indexOf(`## [${version}]`) < changelog.indexOf('## [0.0.1]'), true);
  assert.doesNotMatch(changelog, /(?<!\r)\n/);
});

test('version:next derives the next version, syncs it, and verifies it', (t) => {
  const { root, run } = fixture(t, '\n', 2);

  const result = run('--next');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Synchronized application version 1\.2\.4/);
  assert.match(result.stdout, /Verified application version 1\.2\.4/);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '1.2.4');
  assert.match(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), /^## \[1\.2\.4\] - \d{4}-\d{2}-\d{2}$/m);
  assert.equal(run('--check').status, 0);
});

for (const [current, expected] of [
  ['1.2.3', '1.2.4'],
  ['1.2.3-alpha.7', '1.2.3-alpha.8'],
  ['1.2.3-13', '1.2.3-14'],
  ['1.2.3-beta', '1.2.3-beta.1'],
  ['1.2.3-rc.9+build.2', '1.2.3-rc.10+build.2'],
]) {
  test(`version:next bumps ${current} to ${expected}`, (t) => {
    const { root, run } = fixture(t, '\n', 2, current);
    const result = run('--next');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, expected);
    assert.match(result.stdout, new RegExp(`Verified application version ${expected.replace(/[.+-]/g, '\\$&')}`));
  });
}

test('rejects --next combined with --set or --check', (t) => {
  const { run } = fixture(t, '\n', 2);
  assert.notEqual(run('--next', '--check').status, 0);
  assert.notEqual(run('--next', '--set', '9.9.9').status, 0);
});

test('detects and fixes each JSON version field while retaining Windows newlines', (t) => {
  const { root, run, version, json } = fixture(t, '\r\n', 2);
  for (const field of ['lock-root', 'lock-package', 'tauri']) {
    json('package-lock.json', { version: field === 'lock-root' ? '0.0.1' : version,
      packages: { '': { version: field === 'lock-package' ? '0.0.1' : version } } });
    json('src-tauri/tauri.conf.json', { version: field === 'tauri' ? '0.0.1' : version, productName: 'Pi Desktop' });
    assert.notEqual(run('--check').status, 0, field);
    assert.equal(run().status, 0, field);
    assert.equal(run('--check').status, 0, field);
    const path = field === 'tauri' ? 'src-tauri/tauri.conf.json' : 'package-lock.json';
    assert.doesNotMatch(readFileSync(join(root, path), 'utf8'), /(?<!\r)\n/);
  }
});
