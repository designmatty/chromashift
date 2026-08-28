# Windows packaging

ChromaShift uses Electron Builder 26.15.3 for Windows x64. Application JavaScript
is stored in ASAR. The native helper is published self-contained and copied
outside ASAR with every runtime and native dependency it needs.

## Commands

Run from the repository root:

```powershell
npm run package:dir
npm run package:win
npm run check:package-budget
npm run smoke:package
```

`package:dir` produces `apps/desktop/release/win-unpacked`. `package:win` also
produces `apps/desktop/release/ChromaShift-<version>-x64-setup.exe` and its block
map plus `latest.yml`. Release output is generated and ignored by Git.

Both package commands run the footprint checker after Electron Builder. The
unpacked app, ASAR, DisplayService, locales, and NSIS installer have separate
budgets so a copied benchmark directory, loose production dependencies, extra
locales, or a publish-layout regression fails the build.

## Packaged layout

```text
ChromaShift.exe
resources/
  app.asar
  display-service/
    ChromaShift.DisplayService.exe
    NvAPIWrapper.dll
    THIRD-PARTY-NOTICES.txt
    licenses/
      GPL-3.0.txt
      LGPL-3.0.txt
```

`ChromaShift.DisplayService.exe` is a self-contained, partially trimmed .NET
single-file publish except for the replaceable `NvAPIWrapper.dll`. Protocol JSON
uses source-generated metadata so application-owned code
remains trim analyzed. The copied NVAPI provider assembly is rooted because its
reflection paths cannot be inferred by the linker; narrowly scoped linker
suppressions document only that dependency's known warnings. EDID discovery
reads the Windows display registry instead of `System.Management`, whose WMI
implementation is not compatible with trimming. Internal .NET bundle compression
is deliberately disabled: NSIS compresses the distributable more effectively,
while leaving the long-lived helper payload uncompressed avoids a measured
private-memory penalty at runtime.

Only compiled main, preload, and renderer output enters ASAR. Electron Vite
bundles main-process workspace and third-party dependencies, so the package does
not copy `node_modules`. Electron ships only the `en-US` locale because the
current product UI is English-only.

ChromaShift has no audio or video playback feature, so Electron Builder replaces
the stock FFmpeg library with Electron's official non-proprietary codec build.
The package footprint checker caps `ffmpeg.dll` at 2 MiB to prevent the stock
media library from returning unnoticed.

The packaged tray icon comes from the icon already embedded in
`ChromaShift.exe`; development still loads `build/icon.png`. This avoids copying
the same PNG into `resources` solely to render a 16-pixel tray image.

The Windows package also removes Electron's DirectX 12 shader compiler pair and
Vulkan SwiftShader files after extraction and before signing. ChromaShift
disables hardware acceleration, and its software GPU process explicitly uses
ANGLE's D3D11 WARP path with `d3dcompiler_47.dll`, `libGLESv2.dll`, and
`libEGL.dll`. Packaged process-module inspection and repeated app/mini/tray/reopen
runs found no load of `dxcompiler.dll`, `dxil.dll`, `vk_swiftshader.dll`, or
`vulkan-1.dll`. Package smoke requires the five pruned runtime files to remain
absent. Chromium's software-rasterizer fallback is also disabled while the app
has no WebGL or GPU-heavy surface; real desktop smoke and packaged performance
cover that rendering decision.

Production code resolves the helper only from
`process.resourcesPath/display-service/ChromaShift.DisplayService.exe`. Development uses
the debug build or an explicit `CHROMASHIFT_DISPLAY_SERVICE_PATH`; production
does not honor that override.

Packaged startup uses the same protocol/version/health handshake as development.
The external helper must arm its heartbeat watchdog before automation starts.
Bounded restart is permitted only after the previous helper confirmed restoration
or owned no baseline; otherwise the app remains alive and fails closed instead of
recapturing potentially modified output.

Production Electron binaries disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and
Node inspector arguments; enable cookie encryption, embedded ASAR integrity, and
ASAR-only application loading; and verify those exact fuse states in package
smoke. The local renderer still loads from `file://`, so its required file-protocol
privileges remain enabled deliberately until a custom protocol has a concrete
containment requirement and dedicated tests. Renderer windows remain sandboxed,
deny all new windows and cross-document navigation, and use a production CSP that
does not allow arbitrary WebSocket connections.

The installer is per-user. Uninstall removes the application directory and its
Start menu shortcut, but preserves Electron's user-data directory.
`profiles.json` therefore remains outside the install directory and is not
deleted by the NSIS uninstaller.

The configuration location is explicitly pinned to
`%APPDATA%\ChromaShift\profiles.json`. On first startup after upgrading from a
pre-packaging build, ChromaShift copies the legacy
`%APPDATA%\@chromashift\desktop\profiles.json` only when the stable destination
does not exist. It never moves or overwrites either file. Command-line
`--user-data-dir` overrides remain isolated for smoke tests and diagnostics.
Unpackaged development launches without an explicit override use
`%APPDATA%\ChromaShift-development\<worktree>-<hash>` so parallel Git worktrees
cannot read or mutate production or each other's configuration. Production data
and its legacy migration paths are unchanged.

Main-process and native-service diagnostics are written as rotated JSONL at
`<user-data>\logs\main.jsonl` as well as the console. The log records startup,
health/owner identities, profile matching and activation, per-display failures,
transition/recovery decisions, and restoration/exit outcomes. The Diagnostics
settings page reads a bounded tail through the narrow preload API and presents
the latest 250 validated events newest-first; the sandboxed renderer has no file
path or direct filesystem access.

## Code signing

No certificate or secret is committed. The current Electron Builder path
consumes `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` from the environment or CI
secrets. `.env.example` documents the variable names only. Issue #46 will replace
that release path with Azure Artifact Signing under an individually validated
publisher identity. The managed service must sign `ChromaShift.exe` and
`ChromaShift.DisplayService.exe` before NSIS embeds them, then sign the installer.
Unsigned local builds remain supported. See `signing.md`.

The LGPL-3.0 `NvAPIWrapper.dll` already ships beside the helper with its license
texts, notice, corresponding-source link, and replacement-loading coverage.

## Release preflight

`npm run release:preflight` is part of canonical verification and checks that the
root package, desktop package, and both lockfile entries agree on a valid version;
that Electron Builder targets only Windows x64 with the expected artifact pattern;
and that GitHub update metadata points at `designmatty/chromashift`. With `--tag`,
the tag must be exactly `v<version>` and development version `0.0.0` is rejected.
With `--artifacts`, the installer, block map, and `latest.yml` must agree on
version, filename, architecture, size, and SHA-512 metadata.

The serialized tag workflow in `.github/workflows/release.yml` repeats canonical
verification, validates generated artifacts, uploads them, and creates a draft
GitHub release. The current workflow requires Authenticode credentials through
Electron Builder's `forceCodeSigning` path. Issue #46 replaces that PFX-only path
with Azure Artifact Signing while retaining per-file verification. The workflow
still contains a legacy unsigned-prerelease branch, but it must not be run or used
to create a draft release. Issue #46 must remove that branch before the signed
release-candidate work begins. Publication is never canceled by a newer run. Real
display and package smoke remain pre-release actions on suitable Windows
hardware; hosted CI does not infer them from compilation.

## Package smoke test

The package smoke test asserts the exact external-resource paths, production
fuses, CSP, and renderer sandbox, then tests both unpacked and installed layouts.
It launches `ChromaShift.DisplayService.exe`, verifies its version/health/watchdog handshake
and display enumeration, captures a baseline, requests service shutdown, and
checks the per-display restoration acknowledgement. It also starts the Electron
app with isolated user data and invokes the shared restore-safe exit path. The
installed-app path creates a disposable profile, dispatches its registered global
shortcut, requires native notification delivery, physically clicks the newest
card in Windows Notification Center, and verifies that the app panel routes to
that profile. Finally, it silently installs, reinstalls over the same directory,
starts the installed app, uninstalls it while it is running, verifies that the
process exits and the application directory and Start menu shortcut are removed,
and verifies that the profile configuration survives.

These checks make low-impact no-change capture/restore calls on the current
display hardware. AMD runtime behavior remains unverified on machines without an
AMD-driven display, as recorded in `display-research.md`.
