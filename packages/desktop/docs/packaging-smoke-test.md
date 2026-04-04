# Packaging Smoke Test Plan

This document describes the smoke tests to run after packaging the Kanban
desktop app. These validate that the ASAR unpack configuration is correct
and the packaged app functions as expected.

## Quick Validation (post-build)

Run this after every `build:mac`, `build:win`, or `build:linux`:

### 1. Inspect unpacked contents

```bash
# macOS
ls -R "out/mac-arm64/Kanban.app/Contents/Resources/app.asar.unpacked/"

# Linux (extract AppImage first)
./out/Kanban-*-x64.AppImage --appimage-extract
ls -R squashfs-root/resources/app.asar.unpacked/
```

**Expected structure:**
```
app.asar.unpacked/
├── package.json
├── dist/
│   └── runtime-child-entry.js
└── node_modules/
    ├── node-pty/          (native addon)
    ├── better-sqlite3/    (native addon, inside kanban/)
    ├── @anthropic-ai/     (native addon, inside kanban/)
    └── @img/              (native addon, inside kanban/)
```

**NOT expected:**
- `node_modules/tree-kill/` (should be inside ASAR)
- `node_modules/electron-updater/` (should be inside ASAR)
- Large JS-only packages (should be inside ASAR)

### 2. Runtime child boot test

1. Launch the packaged app
2. Open the developer console (View → Diagnostics in dev builds)
3. Verify no errors matching:
   - `MODULE_NOT_FOUND`
   - `ENOENT`
   - `Error: Module did not self-register`
   - `Cannot find module`
4. Verify the console shows: `Runtime ready at http://127.0.0.1:XXXXX`

### 3. PTY / Terminal test

1. Open a terminal tab in the Kanban UI
2. Run `echo "hello"` — output should appear
3. Run `stty size` — should report terminal dimensions
4. Resize the terminal — no rendering glitches
5. Run `exit` — session closes cleanly

### 4. Database test (better-sqlite3)

1. Create or modify a workspace in the UI
2. Verify changes persist after app restart
3. No SQLite-related errors in console

### 5. Process cleanup test

1. Note the app's PID: `pgrep -f Kanban`
2. Quit the app normally (Cmd+Q / Ctrl+Q)
3. Verify no orphan processes: `pgrep -f runtime-child-entry`
4. Should return no results

## CI Integration Notes

For CI environments without a display server, packaging can be validated
structurally:

```bash
# Build the package
npm run build:mac  # or build:linux, build:win

# Verify the unpacked directory structure exists
test -f "out/*/resources/app.asar.unpacked/package.json" \
  && echo "PASS: package.json unpacked" \
  || echo "FAIL: package.json not unpacked"

test -d "out/*/resources/app.asar.unpacked/node_modules/node-pty" \
  && echo "PASS: node-pty unpacked" \
  || echo "FAIL: node-pty not unpacked"

# Verify tree-kill is NOT unpacked (it should be inside ASAR)
test ! -d "out/*/resources/app.asar.unpacked/node_modules/tree-kill" \
  && echo "PASS: tree-kill correctly inside ASAR" \
  || echo "FAIL: tree-kill should not be unpacked"
```

Full runtime boot testing requires a display server (real or virtual via
Xvfb on Linux).
