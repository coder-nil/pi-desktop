import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function fixture(t, newline, indent) {
  const root = mkdtempSync(join(tmpdir(), 'pi-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'src-tauri'));
  copyFileSync(new URL('../scripts/sync-version.mjs', import.meta.url), join(root, 'scripts/sync-version.mjs'));
  const version = '1.2.3';
  const json = (path, data) => writeFileSync(join(root, path), JSON.stringify(data, null, indent).replace(/\n/g, newline));
  json('package.json', { version });
  json('package-lock.json', { version, packages: { '': { version } } });
  json('src-tauri/tauri.conf.json', { version, productName: 'Pi Desktop' });
  writeFileSync(join(root, 'README.md'), `UI version: \`v${version}\`${newline}`);
  for (const file of ['Cargo.toml', 'Cargo.lock']) {
    writeFileSync(join(root, 'src-tauri', file), `name = "pi-desktop"${newline}version = "${version}"${newline}`);
  }
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/sync-version.mjs'), ...args], {
    encoding: 'utf8', env: { ...process.env, RELEASE_TAG: '', GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '' },
  });
  return { root, run, version, json };
}

for (const [name, newline, indent] of [['LF', '\n', 2], ['CRLF', '\r\n', 4], ['tabs', '\r\n', '\t']]) {
  test(`version check accepts ${name} formatting without rewriting`, (t) => {
    const { root, run } = fixture(t, newline, indent);
    const paths = ['package-lock.json', 'src-tauri/tauri.conf.json', 'README.md'];
    const before = paths.map(p => readFileSync(join(root, p), 'utf8'));
    for (const args of [['--check'], []]) {
      const result = run(...args);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(paths.map(p => readFileSync(join(root, p), 'utf8')), before);
    }
  });
}

test('sets package.json and synchronizes every derived version field', (t) => {
  const { root, run } = fixture(t, '\n', 2);
  const nextVersion = '1.2.4';

  const result = run('--set', nextVersion);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, nextVersion);
  assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).version, nextVersion);
  assert.equal(JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version, nextVersion);
  assert.match(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8'), new RegExp(`version = "${nextVersion}"`));
  assert.match(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8'), new RegExp(`version = "${nextVersion}"`));
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), new RegExp(`UI version: \`v${nextVersion}\``));
  assert.equal(run('--check').status, 0);
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
