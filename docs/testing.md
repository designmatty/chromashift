# Testing

## Test commands

| Command                                 | Scope                                                                                                                        | Environment                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `npm run verify`                        | Formatting, lint, typechecking, deterministic tests, dependency and source audits, release preflight, build, renderer budget | Any supported Windows checkout |
| `npm run native:test:integration`       | Real helper lifecycle, display discovery, capabilities, topology refresh, watchdog restoration                               | Interactive Windows hardware   |
| `npm run smoke:desktop`                 | Real Electron windows, renderer IPC, profiles, preview, tray, shortcuts, notifications, display writes, restoration          | Interactive Windows desktop    |
| `npm run smoke:desktop:crash`           | Forced Electron exit and helper restoration                                                                                  | Interactive Windows desktop    |
| `npm run smoke:desktop:native-recovery` | Baseline-free helper termination and bounded recovery                                                                        | Interactive Windows desktop    |
| `npm run package:win`                   | Windows x64 unpacked app and NSIS installer                                                                                  | Windows                        |
| `npm run smoke:package`                 | Packaged helper, install, upgrade, exit, uninstall, notifications, and retained data                                         | Interactive Windows desktop    |
| `npm run measure:performance`           | Packaged latency, memory, CPU, renderer release, and footprint budgets                                                       | Reference Windows host         |

`npm run verify` is the canonical non-interactive gate and the command used by
GitHub CI. It does not claim native hardware, visible desktop, installation, or
restoration behavior. Run the relevant real command when changing those paths.

Display-mutating tests keep a separate restoration guard alive, use mild values,
and compare the exact pre-run and post-run state. Do not run them in a remote or
non-interactive session where restoration cannot be observed and recovered.

## Deterministic coverage

The TypeScript and native test suites cover these contracts:

- Profile schema version 2, version 0 and 1 migrations, optional settings,
  remembered values, CRUD, duplication, case-insensitive display IDs, matching,
  and activation precedence
- Serialized activation, baseline capture before apply, baseline-first profile
  changes, duplicate suppression after success, per-display failures, retry,
  disconnected targets, HDR deferral, and topology reapply
- Preview start, update, promotion, save, rollback after pending writes, dirty
  navigation, mini-panel overrides, and removal of the final setting
- Physical-display grouping, safe capability intersection, endpoint fanout,
  target rewrite, provider ownership, and restore-result aggregation
- Profile, preference, intent, window-state, diagnostic-log, and legacy-path
  persistence, including atomic writes and concurrent update queues
- Pause, Resume, Safety blocked, one-shot restore, emergency restore,
  notification policy, global-shortcut replacement, tray commands, and
  renderer-free operation
- Main-process composition, startup buffering, helper handshake and heartbeat,
  bounded helper recovery, renderer recovery circuits, shutdown ordering, and
  failure messages
- Sender-validated Zod IPC, sandboxed preload behavior, CSP, navigation policy,
  Electron fuses, package layout, staged Azure signing order, signed-installer
  update metadata, release preflight, renderer size, and package footprint
- Native gamma transforms, HDR rejection, foreground-window resolution,
  heartbeat deadlines, parent monitoring, display identity, baseline ownership,
  and explicit shutdown policy

Repository tests also enforce the public-source policy files, verify local
Markdown links, and scan reachable Git history for credential-bearing filenames,
private keys, and high-confidence service credentials.

## Native integration

`npm run native:test:integration` launches the real
`ChromaShift.DisplayService.exe`. It verifies:

- protocol version, service health, and heartbeat arming
- foreground application resolution
- stable physical and endpoint display identities
- primary display, adapter, HDR, capability, and current-state reporting
- explicit errors for unknown commands
- non-mutating topology refresh
- restore-aware shutdown
- ADLX runtime availability on the current machine

Its guarded watchdog case captures a real baseline, applies a mild gamma change,
stops Electron-side heartbeats, observes exact restoration and helper exit, then
starts a fresh helper and compares the restored gamma-ramp hash.

## Desktop smoke

`npm run smoke:desktop` builds and launches the actual Electron application. It
checks the sandboxed preload bridge and drives the visible app and mini panel
through Chromium debugging plus Windows interaction.

The flow covers profile navigation and editing, per-display accordions,
capability states, application assignment, live preview and rollback, Default and
manual activation, temporary mini-panel overrides, Pause and Resume, diagnostics,
theme states, profile deletion focus, app and mini mutual exclusion, native
caption behavior, mini-panel non-activation, tray reopening, and renderer release.

It records and fires configurable shortcuts with no renderer alive, fires the
fixed `Ctrl+Alt+Windows+R` emergency restore shortcut, and verifies exact display
restoration before exit. Screenshots are written under `apps/desktop/out/smoke`
for visual inspection; they do not replace inspection of the positioned native
window when pixel or window behavior matters. Electron creates a development
Start menu shortcut when the smoke checks native-notification support. The smoke
removes that shortcut during cleanup only when it did not exist before the run.

`npm run smoke:desktop:crash` forcibly terminates Electron and requires the
detached helper to restore before exiting. `npm run
smoke:desktop:native-recovery` terminates the exact baseline-free helper owned by
the test process and requires a bounded version, health, and topology handshake
before the normal smoke sequence continues.

## Package and performance smoke

`npm run package:win` publishes the self-contained helper with replaceable
`NvAPIWrapper.dll`, builds the Windows x64 app, and enforces budgets for the
installer, unpacked application, ASAR, helper, FFmpeg, and locales.

`npm run smoke:package` checks the external helper and license layout, production
fuses and CSP, helper handshake, baseline capture and restoration, unpacked and
installed Electron launches, silent install, in-place upgrade, restore-safe exit,
and uninstall while the installed app is running. Uninstall must stop that process
and remove the application directory and Start menu shortcut while preserving
profile data. The smoke also creates a disposable profile,
dispatches its global shortcut, verifies native notification delivery, clicks the
notification in Windows Notification Center, and checks profile routing.

`npm run measure:performance` measures packaged startup, app-to-mini and app
reopen latency, visible, mini, and tray private memory, renderer release, idle
CPU, and package footprint. The current budgets and measurements live in
`performance.md`.

## Current hardware evidence

The current reference host is Windows 11 with an NVIDIA RTX 5090 driving two
display endpoints. An AMD integrated GPU and ADLX runtime are present, but no
display is attached to the AMD adapter.

Verified on this host:

- Windows gamma capture, mild apply, exact read-back, and exact restoration
- NVIDIA saturation and hue apply, read-back, and restoration
- foreground events for normal Windows applications
- two stable display endpoints and physical-panel grouping
- parent-exit and heartbeat-timeout restoration
- baseline-free helper recovery
- SDR to HDR to SDR deferral and reapply with exact final restoration
- active Edit during DisplayPort disconnect, cancel while absent, reconnect, and
  reapply to the same stable display
- HDMI disconnect and reconnect with stable identity and exact restoration
- packaged install, upgrade, notification click routing, restore-safe exit,
  uninstall, retained profiles, and performance budgets

The exact initial hardware values, hashes, provider limits, and identifiers live
in `display-research.md`. Package and runtime measurements live in
`performance.md`.

Not hardware-verified:

- AMD display writes and AMD-driven multi-monitor behavior
- mixed-GPU display control
- suspend and resume, lock and unlock, refresh-rate and primary-display changes
- NVIDIA driver reset
- a hung Electron parent or a helper failure while it may own a baseline
- clean-VM reputation and SmartScreen behavior

These are issue-driven follow-up tests, not claims implied by CI or the current
NVIDIA record.
