# Release Checklist

This repo publishes desktop application bundles through the GitHub Release for `coder-nil/pi-desktop`.

Use this checklist from a clean `main` checkout.

## 1. Preflight

```bash
git status --short --branch
git log --oneline --decorate -5
gh auth status
node -e "const p=require('./package.json'); console.log(p.version)"
```

Expected:

- `git status` is clean, or only contains changes you intentionally plan to release.
- GitHub is authenticated as an account that can push and create releases.
## 2. Build the Desktop Bundles

The desktop workflow builds separate macOS ARM64 and Intel bundles, plus Windows x64 and Linux x64 bundles, from the tagged commit. For a local build, run the platform-specific command on the matching operating system and architecture:

```bash
npm ci
cargo install tauri-cli --version 2.8.4 --locked
npm run desktop:build:mac:arm64  # Apple Silicon Mac
npm run desktop:build:mac:x64    # Intel Mac
npm run desktop:build:windows
npm run desktop:build:linux
```

The workflow installs the required dependencies and uploads four distinctly named artifacts. Branch builds keep them as Actions artifacts; tag builds also publish them to the GitHub Release.

For macOS, the workflow adds `Fix Pi Desktop.command` to each DMG after Tauri packaging, then verifies its contents and executable permission alongside the app signature before generating checksums. The helper must be run manually after copying the app into Applications. To add it to a locally built DMG, run `bash scripts/add-macos-dmg-helper.sh "/path/to/Pi Desktop.dmg"` before computing checksums.

## 3. Set the Version

`package.json` is the single source of truth. The version is always
`<pi SDK version>-alpha.<sequence>`: the release follows the pi SDK the desktop
is built on, and `alpha.N` counts our own releases on top of it. For a routine
release, bump the version and update the lockfiles, desktop metadata, README, and
CHANGELOG section in one step (the command verifies its own output):

```bash
npm run version:next             # 1.2.0-alpha.17 on pi 1.4.0 -> 1.4.0-alpha.18
npm run version:set -- <version> # instead, when the next version is not a simple increment
npm run version:check            # only needed after version:set
git commit -m "Release v<version>"
```

`version:next` reads the `@earendil-works/pi-coding-agent` version from
`package.json` for the release part and continues the `alpha.N` counter, so the
two stay in step while the SDK is upgraded between releases.

The inserted CHANGELOG section is a **draft generated from the commits after the
previous release**: it starts at the tag `v<previous section's version>` (falling
back to the nearest tag), maps `feat` → Added, `fix` → Fixed and everything else
→ Changed, skips `test`/`ci`/`docs` and the release's own version commits, and
always ends Changed with the version-unification note. Those lines are commit
subjects, not release prose, so read them against `git log v<previous>..HEAD`,
rewrite them in user-facing language, and merge related entries before
committing. Outside a git checkout the section only carries the version note.

The bump command inserts `## [<version>] - <date>` plus the standard
version-unification note when that section is missing, and ends with
`Verified application version <version>`. Existing sections are historical and
never rewritten, so review the generated draft before committing.

Release notes are also shipped inside the application: the **About** dialog
(ⓘ next to the sidebar title and in Settings → General) renders
`data/changelog.json`, which `scripts/sync-changelog.mjs` derives from
`CHANGELOG.md`. After editing a release section, run:

```bash
npm run changelog:sync   # regenerate data/changelog.json from CHANGELOG.md
npm run changelog:check  # CI entry: fails when the two are out of sync
```

`version:check` runs the changelog check as well, so a release whose notes were
only edited in `CHANGELOG.md` fails the build until the JSON is regenerated.

## 4. Tag and Push

```bash
git tag -a v<version> -m "v<version>"
git push origin main --tags
```

Confirm the tag does not already exist before creating it when unsure:

```bash
git ls-remote --tags origin v<version>
gh release view v<version> --repo coder-nil/pi-desktop
```

## 5. Generate Release Notes from Commits

Use the previous release tag as the base.

```bash
git log --oneline --decorate v<previous>..v<version>
git log --format='%h%x09%s%n%b' v<previous>..v<version>
git diff --stat v<previous>..v<version>
```

Write the release notes from those commits, not from memory. Include both Chinese and English sections. Keep commit hashes next to each item when useful, and mirror the summary into the `## [<version>]` section of `CHANGELOG.md`.

Suggested structure:

```markdown
## 中文

基于 `v<previous>..v<version>` 的提交整理。

### 新增

- ...

### 修复

- ...

### 改进

- ...

### 内部调整

- 发布 macOS、Windows 和 Linux 桌面应用包。

## English

Prepared from commits in `v<previous>..v<version>`.

### Added

- ...

### Fixed

- ...

### Improved

- ...

### Internal

- Published macOS, Windows, and Linux desktop bundles.
```

## 6. Create or Update the GitHub Release

Create a new release:

```bash
gh release create v<version> \
  --repo coder-nil/pi-desktop \
  --verify-tag \
  --title "v<version>" \
  --notes-file release-notes.md
```

If the release already exists and only the notes need updating:

```bash
gh release edit v<version> \
  --repo coder-nil/pi-desktop \
  --notes-file release-notes.md
```

You can avoid a temporary file by passing notes through stdin:

```bash
gh release edit v<version> --repo coder-nil/pi-desktop --notes-file - <<'EOF
## 中文

...

## English

...
EOF
```

## 7. Final Verification

```bash
gh release view v<version> --repo coder-nil/pi-desktop
git status --short --branch
git log --oneline --decorate -3
```

Expected:

- GitHub Release exists and is not a draft unless intentionally published as one.
- `main` is aligned with `origin/main`.
- `HEAD` points at the release commit and `v<version>` tag.
