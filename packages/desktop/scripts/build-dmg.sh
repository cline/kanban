#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────
# build-dmg.sh — Build macOS .dmg for Kanban Desktop
#
# Usage:
#   ./scripts/build-dmg.sh              # Build for current arch
#   ./scripts/build-dmg.sh --arm64      # Build for Apple Silicon
#   ./scripts/build-dmg.sh --x64        # Build for Intel
#   ./scripts/build-dmg.sh --universal  # Build universal binary
#
# Prerequisites:
#   - macOS with Xcode Command Line Tools
#   - Node.js >= 20
#   - npm dependencies installed (npm install)
# ───────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$DESKTOP_DIR"

# Parse optional arch argument
ARCH_FLAG=""
if [[ "${1:-}" == "--arm64" ]]; then
  ARCH_FLAG="--arm64"
elif [[ "${1:-}" == "--x64" ]]; then
  ARCH_FLAG="--x64"
elif [[ "${1:-}" == "--universal" ]]; then
  ARCH_FLAG="--universal"
fi

echo "──────────────────────────────────────"
echo "Step 1/3: Rebuilding node-pty for Electron"
echo "──────────────────────────────────────"
npx electron-rebuild -f -w node-pty

echo ""
echo "──────────────────────────────────────"
echo "Step 2/3: Compiling TypeScript"
echo "──────────────────────────────────────"
npx tsc -p tsconfig.build.json

echo ""
echo "──────────────────────────────────────"
echo "Step 3/3: Packaging .dmg with electron-builder"
echo "──────────────────────────────────────"
# shellcheck disable=SC2086
npx electron-builder --mac dmg --config electron-builder.yml $ARCH_FLAG

echo ""
echo "──────────────────────────────────────"
echo "Done! Output artifacts:"
ls -lh out/*.dmg 2>/dev/null || echo "(no .dmg found — check out/ directory)"
echo "──────────────────────────────────────"
