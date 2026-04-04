# Linux Validation Checklist

This checklist covers the manual validation steps required to confirm the
Kanban desktop app works correctly on Linux. Run through this checklist
whenever the Electron version, native dependencies, or packaging config
changes.

## Prerequisites

- Ubuntu 22.04+ (or equivalent distro with glibc ≥ 2.35) — x64 or arm64
- FUSE installed (`sudo apt install fuse libfuse2` for AppImage)
- A display server (X11 or Wayland) — headless is **out of scope**
- Node.js 18+ available on PATH (for build steps only; not required at runtime)

---

## 1. Build

| # | Check | Command / Action | Expected |
|---|-------|-----------------|----------|
| 1.1 | TypeScript compiles | `npm run build:ts` | No errors |
| 1.2 | node-pty rebuilds | `npm run rebuild:pty` | Rebuilds for current Electron + arch |
| 1.3 | AppImage packages (x64) | `npm run build:linux` or `electron-builder --linux --x64` | `out/Kanban-*-x64.AppImage` created |
| 1.4 | AppImage packages (arm64) | `electron-builder --linux --arm64` (on arm64 host) | `out/Kanban-*-arm64.AppImage` created |

## 2. Launch

| # | Check | Action | Expected |
|---|-------|--------|----------|
| 2.1 | AppImage launches | `chmod +x Kanban-*.AppImage && ./Kanban-*.AppImage` | Window appears, no crash |
| 2.2 | Single instance | Launch a second copy of the AppImage | Second instance quits; first instance focuses |

## 3. Runtime Child

| # | Check | How to verify | Expected |
|---|-------|--------------|----------|
| 3.1 | Runtime boots | Watch stdout / DevTools console for `[desktop] Runtime ready at http://127.0.0.1:*` | URL printed, web UI loads |
| 3.2 | Heartbeat active | Wait >15 seconds; app should remain stable | No forced restart |
| 3.3 | Graceful shutdown | Quit via Ctrl+Q or window close | No orphan node processes (`ps aux \| grep runtime-child`) |

## 4. Terminal / PTY

| # | Check | Action | Expected |
|---|-------|--------|----------|
| 4.1 | PTY session opens | Open a terminal tab in the Kanban UI | Shell prompt appears |
| 4.2 | Interactive commands | Run `ls`, `echo $SHELL`, `top` (then `q`) | Output renders correctly, interactive mode works |
| 4.3 | Resize | Resize the terminal panel | No rendering glitches; `stty size` reports updated dimensions |
| 4.4 | node-pty native binding | Check no "module not found" errors in console | Loaded from `app.asar.unpacked/node_modules/node-pty/` |

## 5. ASAR Unpack Validation

| # | Check | How to verify | Expected |
|---|-------|--------------|----------|
| 5.1 | Unpacked files exist | `ls <AppImage-mount>/resources/app.asar.unpacked/` | Contains `package.json`, `dist/runtime-child-entry.js`, plus `node_modules/{node-pty,better-sqlite3,@anthropic-ai,@img}` |
| 5.2 | Native modules load | No `ENOENT` or `MODULE_NOT_FOUND` errors at startup | All native `.node` files resolve from unpacked paths |
| 5.3 | Non-native modules in ASAR | `tree-kill`, `electron-updater`, etc. NOT in `app.asar.unpacked/` | Confirms ASAR containment |

## 6. Protocol Registration (kanban://)

| # | Check | Action | Expected |
|---|-------|--------|----------|
| 6.1 | XDG handler registered | `xdg-mime query default x-scheme-handler/kanban` | Returns the app's .desktop entry |
| 6.2 | Protocol URL opens app | `xdg-open kanban://test` | App receives the URL (check console log) |

> **Note:** Protocol registration may not work on all desktop environments.
> Wayland compositors and tiling WMs may require manual `.desktop` file
> placement in `~/.local/share/applications/`.

## 7. Safe Storage / Keychain Fallback

| # | Check | Action | Expected |
|---|-------|--------|----------|
| 7.1 | No keychain available | Run without `gnome-keyring` or `kwallet` | App starts normally; falls back to unencrypted storage |
| 7.2 | Keychain available | Install `gnome-keyring`, run inside a desktop session | `safeStorage.isEncryptionAvailable()` returns `true` |

## 8. Power Save Blocker

| # | Check | Action | Expected |
|---|-------|--------|----------|
| 8.1 | Blocker active on Linux | Check `powerSaveBlocker.isStarted()` in main process | Returns `true` |
| 8.2 | Runtime survives idle | Leave app idle for >5 minutes, then interact | Runtime still responsive |

## 9. Auto-Update (if applicable)

| # | Check | Action | Expected |
|---|-------|--------|----------|
| 9.1 | Update check runs | App fetches latest release from GitHub | No crash; may report "no update" or "update available" |
| 9.2 | AppImage update applies | If update available, confirm download + restart | New version launches |

---

## Known Limitations

- **Headless Linux** (SSH-only, no display server): Use the CLI (`kanban`)
  instead. The desktop app requires a display server.
- **Cross-compilation**: Building arm64 AppImages on x64 requires an arm64
  sysroot or running on native arm64 hardware. CI should use separate runners.
- **FUSE requirement**: AppImage requires FUSE. On systems without FUSE,
  extract the AppImage with `--appimage-extract` and run from the extracted
  directory.
- **Wayland**: Protocol handler registration (`kanban://`) may require
  manual `.desktop` file setup on Wayland-only environments.
