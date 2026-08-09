# Windows packaging

Milestone 3 uses Electron Builder 26.15.3 without adopting a starter template's
architecture or dependency set. Application JavaScript is stored in ASAR. The
native helper is published self-contained for Windows x64 and copied outside
ASAR with every runtime and native dependency it needs.

## Commands

Run from the repository root:

```powershell
npm run package:dir
npm run package:win
npm run smoke:package
```

`package:dir` produces `apps/desktop/release/win-unpacked`. `package:win` also
produces `apps/desktop/release/ChromaShift-<version>-x64-setup.exe` and its block
map. Release output is generated and ignored by Git.

## Packaged layout

```text
ChromaShift.exe
resources/
  app.asar
  icon.png
  display-service/
    DisplayService.exe
    DisplayService.runtimeconfig.json
    NvAPIWrapper.dll
    ...self-contained .NET runtime files
```

Production code resolves the helper only from
`process.resourcesPath/display-service/DisplayService.exe`. Development uses
the debug build or an explicit `CHROMASHIFT_DISPLAY_SERVICE_PATH`; production
does not honor that override.

The installer is per-user and preserves Electron's user-data directory during
upgrade and uninstall. `profiles.json` therefore remains outside the install
directory and is not deleted by the NSIS uninstaller.

The configuration location is explicitly pinned to
`%APPDATA%\ChromaShift\profiles.json`. On first startup after upgrading from a
pre-packaging build, ChromaShift copies the legacy
`%APPDATA%\@chromashift\desktop\profiles.json` only when the stable destination
does not exist. It never moves or overwrites either file. Command-line
`--user-data-dir` overrides remain isolated for smoke tests and diagnostics.

## Code signing

No certificate or secret is committed. Electron Builder consumes
`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` from the environment or CI secrets.
`.env.example` documents the variable names only. Unsigned local foundation
builds remain supported; a release pipeline can require signing with Electron
Builder's `forceCodeSigning` option once release credentials exist.

## Package smoke test

The package smoke test asserts the exact external-resource paths and then tests
both unpacked and installed layouts. It launches `DisplayService.exe`, verifies
protocol version and display enumeration, captures a baseline, requests service
shutdown, and checks the per-display restoration acknowledgement. It also starts
the Electron app with isolated user data and invokes the shared restore-safe
exit path. Finally, it silently installs, reinstalls over the same directory,
uninstalls, and verifies that the profile configuration survives.

These checks make low-impact no-change capture/restore calls on the current
display hardware. AMD runtime behavior remains unverified on machines without an
AMD-driven display, as recorded in `display-research.md`.
