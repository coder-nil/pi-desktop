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

## 3. Commit the Version

Replace `<version>` with the release version, for example `0.84.2-alpha.2`.

```bash
git commit -m "Release v<version>"
```

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

Write the release notes from those commits, not from memory. Include both Chinese and English sections. Keep commit hashes next to each item when useful.

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
