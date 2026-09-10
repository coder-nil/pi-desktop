#!/bin/bash
set -eu

pause_before_exit() {
  if [[ -t 0 ]]; then
    read -r -p "Press Return to close..." || true
  fi
}
trap pause_before_exit EXIT

APP="/Applications/Pi Desktop.app"

if [[ ! -d "$APP" ]]; then
  echo "Please drag Pi Desktop.app into Applications first, then run this script again."
  exit 1
fi

echo "Removing the download quarantine attribute from $APP..."
if /usr/bin/xattr -dr com.apple.quarantine "$APP"; then
  echo "Done. You can now open Pi Desktop from Applications."
else
  echo "Could not remove quarantine. See the error above for details."
  exit 1
fi
