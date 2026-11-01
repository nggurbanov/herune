#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
[ "$(uname -s)" = Darwin ] || { echo 'Requires macOS' >&2; exit 1; }
for cmd in cargo rustup node cmake xcrun codesign ditto; do
  command -v "$cmd" >/dev/null || { echo "Missing prerequisite: $cmd" >&2; exit 1; }
done
out="${1:-$PWD/rune-macos-alpha}"
[ ! -e "$out" ] || { echo "Output already exists: $out" >&2; exit 1; }
mkdir -p "$out"
out="$(cd "$out" && pwd)"
export MACOSX_DEPLOYMENT_TARGET=13.0
export CARGO_TARGET_DIR="$PWD/apps/rune/target"
node apps/rune/scripts/build-plugin-host.mjs
cargo +1.95.0 build --locked --release --manifest-path apps/rune/Cargo.toml
node apps/rune/scripts/package-macos.mjs --binary "$CARGO_TARGET_DIR/release/herune" --out "$out/Herune.app" --version 0.1.0
codesign --force --sign - "$out/Herune.app"
codesign --verify --strict --verbose=2 "$out/Herune.app"
ditto -c -k --keepParent "$out/Herune.app" "$out/Herune-macos-alpha.zip"
shasum -a 256 "$out/Herune-macos-alpha.zip"
file "$out/Herune.app/Contents/MacOS/HermesDesktopRune"
otool -L "$out/Herune.app/Contents/MacOS/HermesDesktopRune"
