#!/bin/bash
set -euo pipefail

dmg_path="${1:?Usage: add-macos-dmg-helper.sh /path/to/package.dmg}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
helper_path="$script_dir/macos/Fix Pi Desktop.command"
work_dir="$(mktemp -d)"
mount_point="$work_dir/mount"
mounted=false

cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_point" || return
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

# Preserve Tauri's Finder layout, background, and Applications shortcut.
hdiutil convert "$dmg_path" -format UDRW -o "$work_dir/writable.dmg"
mkdir -p "$mount_point"
hdiutil attach "$work_dir/writable.dmg" -nobrowse -mountpoint "$mount_point"
mounted=true
install -m 755 "$helper_path" "$mount_point/Fix Pi Desktop.command"
hdiutil detach "$mount_point"
mounted=false
hdiutil convert "$work_dir/writable.dmg" -format UDZO -o "$work_dir/final.dmg"
mv -f "$work_dir/final.dmg" "$dmg_path"
