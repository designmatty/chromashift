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
native-client lifecycle unit tests, pure gamma-transform tests, builds the
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

Milestone 4 coverage validates the renderer-to-main schemas, rejects malformed
profile and preview requests, verifies capability rejection before any preview
write, and covers preview capture/apply/update/confirmation, serialized rollback
after an in-flight display apply,
removal of the final override, and retention of a disabled control's last value.
Activation tests also prove foreground events are remembered without writing
during preview, that ChromaShift's own windows do not replace the external
foreground target, and that rollback applies the latest intended target. Settings
tests cover defaults, validation, and atomic persistence.

`npm run smoke:desktop` builds and launches the actual Electron application,
reloads its renderer through the Chromium debugging protocol, and verifies the
sandboxed preload bridge, read-only profile navigation, Settings navigation,
read-only display/color summaries without edit inputs, live Edit preview,
keyboard editing of Default and normal profile names, disabled-control value
retention, cancellation of a debounced edit before it can reapply discarded
values, explicit-preview rollback when another profile is selected, and the
mini-panel path
where disabling the final color control starts a baseline-only override before
Reset reapplies the saved manual profile. It also verifies validated product state, automatic
activation with fresh isolated user data, restore-aware exit, and no renderer
errors. Captured images are written to `apps/desktop/out/smoke/desktop.png` and
`apps/desktop/out/smoke/mini-panel.png`.

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
- Verified the endpoint-preserving Windows ramp transform on `DISPLAY6` with
  brightness 75/contrast 24 and brightness 75/contrast 25/gamma 1.3. Both ramps
  wrote and read back successfully, then the captured baseline was restored.
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
