# Testing

## Automated gates

Run from the repository root:

```powershell
npm install
npm run lint
npm run typecheck
npm run test
npm run build
npm run smoke:desktop
npm run package:win
npm run smoke:package
```

`npm run test` runs the core-domain, desktop activation, protocol, and
native-client lifecycle unit tests, six pure gamma-transform tests, builds the
native helper, and runs a real Electron-client-to-helper lifecycle test. Core
coverage includes schema bounds, optional overrides, path and filename matching,
disabled profiles, activation precedence and rapid transitions, duplicate
suppression, JSON persistence, and schema migration. Native foreground tests
verify that delayed Alt+Tab events resolve the actual current foreground HWND,
failed resolution remains retryable, and HWND duplicates reach Electron for
successful-target deduplication. A deterministic fake helper verifies activation
command requests and responses, runtime validation, structured errors,
unsolicited events, request/startup timeouts, and pending-request rejection on
process exit.
The hardware integration test verifies readiness, foreground
resolution, multi-display stable IDs, primary display detection, capability
resolution and display state, explicit structured unknown-command errors,
restore-aware shutdown, and ADLX availability on the current machine.

Desktop activation coverage verifies app-data reads and atomic replacement,
configuration gating, startup event buffering, foreground/default/baseline
transitions, duplicate suppression, stale-display restoration, serialized rapid
events, baseline capture before every apply, partial capability/restore failures,
retry behavior, and state reset after external restoration or native restart.
Tray and lifecycle coverage verifies current-profile read models, enabled and
disabled profile entries, activation-driven menu refresh, manual and automatic
mode changes, explicit baseline reset, close-to-tray behavior, serialized
restore-before-exit ordering, concurrent exit suppression, actionable restore
failure handling, and retry.
Profile-path regression coverage verifies the explicit stable application-data
location, isolated command-line overrides, exact legacy-file copying,
non-overwrite behavior, and concurrent migration safety.

`npm run smoke:desktop` builds and launches the actual Electron application,
reloads its renderer through the Chromium debugging protocol, and verifies the
sandboxed preload bridge, rendered diagnostics, ready native service, and lack
of renderer errors. It also verifies automatic activation is enabled with a
fresh isolated user-data directory, exits Electron through the shared
restore-aware lifecycle, and writes a captured window image to
`apps/desktop/out/smoke/desktop.png`.

`npm run package:win` builds an x64 NSIS installer and unpacked directory after
publishing a self-contained `DisplayService`. `npm run smoke:package` validates
the exact external sidecar and ASAR layout, starts the helper directly, exercises
NDJSON IPC, captures and restores a baseline, launches both unpacked and installed
apps, and verifies install, in-place upgrade, restore-safe exit, uninstall, and
profile-data survival. The smoke install uses isolated temporary install and
user-data directories.

## Phase 0 hardware record (2026-08-08)

- Started the Electron diagnostics shell and helper together; main-window exit
  stopped the helper cleanly.
- Observed foreground hook events for Electron, Notepad, Explorer, and Brave,
  including monitor transitions between `DISPLAY6` and `DISPLAY7`.
- Repeatedly enumerated two displays with stable EDID-derived IDs and independent
  NVIDIA mappings.
- Captured the Windows RGB ramp, wrote identity and gamma 1.02 transforms, read
  them back exactly, and restored the original ramp on both displays.
- Changed primary-display NVIDIA saturation 50→55 and hue 0→4, read back both,
  then restored 50/0.
- Closed helper stdin after changing gamma/saturation/hue. The helper restored
  before exit; a new helper observed the original ramp hash and NVIDIA 50/0.
- Initialized ADLX and queried version/display count. No AMD-attached display was
  present, so no AMD control write was attempted.

All hardware writes in this record used mild values and completed with verified
baseline restoration. See `display-research.md` for hashes, versions, caveats,
and the distinction between verified and implemented-unverified behavior.

## Required future hardware tests

Before advertising production support, test an AMD-driven display, HDR-on
capability behavior, cable reconnect, sleep/wake, topology changes, driver reset,
and abrupt-process watchdog recovery. These are intentionally recorded as
hardening work rather than silently treated as Phase 0 successes.
