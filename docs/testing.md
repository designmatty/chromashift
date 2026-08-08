# Testing

## Automated gates

Run from the repository root:

```powershell
npm install
npm run lint
npm run typecheck
npm run test
npm run build
```

`npm run test` runs the core-domain and protocol unit tests, six pure
gamma-transform tests, builds the native helper, and runs a real
Electron-client-to-helper lifecycle test. Core coverage includes schema bounds,
optional overrides, path and filename matching, disabled profiles, activation
precedence and rapid transitions, duplicate suppression, JSON persistence, and
schema migration. The integration test verifies readiness, foreground
resolution, multi-display stable IDs, primary display detection, capability
resolution, explicit unknown-command errors, restore-aware shutdown, and ADLX
availability on the current machine.

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
