# Testing

## Automated gates

Run from the repository root:

```powershell
npm install
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify
npm run native:test:integration
npm run smoke:desktop
npm run smoke:desktop:crash
npm run smoke:desktop:native-recovery
npm run package:win
npm run smoke:package
npm run measure:performance
```

`npm run verify` is the canonical non-interactive Windows verification path. It
runs formatting checks, lint, typechecking, deterministic TypeScript and native
tests, a high-severity dependency audit, release-metadata preflight, and the full
build. GitHub CI invokes this exact command. It intentionally
does not run the machine-specific native integration test, display-mutating
desktop smoke, crash-restoration smoke, or package smoke because those require a
suitable interactive Windows session and restoration guard.

`npm run test` runs the core-domain, desktop activation, protocol, and
native-client unit tests plus pure gamma-transform tests. Core
coverage includes schema bounds, optional overrides, path and filename matching,
disabled profiles, activation precedence and rapid transitions, duplicate
suppression, JSON persistence, and schema migration. Native foreground tests
verify that delayed Alt+Tab events resolve the actual current foreground HWND,
failed resolution remains retryable, and HWND duplicates reach Electron for
successful-target deduplication. A deterministic fake helper verifies activation
command requests and responses, runtime validation, structured errors,
unsolicited events, request/startup timeouts, and pending-request rejection on
process exit.
`npm run native:test:integration` builds the helper and runs the
machine-specific native client lifecycle test. It verifies readiness, foreground
resolution, multi-display stable IDs, primary display detection, capability
resolution and display state, explicit structured unknown-command errors,
restore-aware shutdown, ADLX availability on the current machine, and the real
non-mutating `display.topology.refresh` display/capability snapshot. Its guarded
watchdog case captures a real display baseline, applies a mild gamma transform,
stops Electron-side heartbeats, observes the helper restore and exit, then starts
a fresh helper and compares the exact restored gamma-ramp hash.

Desktop activation coverage verifies app-data reads and atomic replacement,
configuration gating, startup event buffering, foreground/default/baseline
transitions, duplicate suppression, stale-display restoration, serialized rapid
events, baseline capture before every apply, partial capability/restore failures,
retry behavior, and state reset after external restoration or native restart.
Tray and lifecycle coverage verifies current-profile read models, enabled and
disabled profile entries, activation-driven menu refresh, manual and automatic
mode changes, explicit baseline reset, renderer-releasing close-to-tray behavior,
mutually exclusive app/mini-panel opening, last-used tray reopening, serialized
restore-before-exit ordering, concurrent exit suppression, actionable restore
failure handling, immediate user-requested retry, and non-blocking shutdown when
an unreachable display's session restoration record is explicitly discarded.
Milestone 5 transition coverage verifies that Electron power events are adapted
without leaking Electron event names into product logic; lock/suspend pause
writes; noisy resume and screen/native topology events coalesce; foreground
changes are remembered while paused; topology refresh precedes reapply; active
previews revalidate current capabilities; provider-ownership changes fail closed;
and disconnected baselines remain retained. Activation and preview tests additionally
cover disconnecting a saved target during Edit, suppressing native writes while it is
absent, clean cancel/save handoff of the retained baseline, and restore/reapply after
the same stable display ID reconnects. Renderer coverage verifies that connected
displays remain editable while persisted disconnected targets are omitted without
being deleted. Window-state tests cover debounced
normal/maximized persistence, serialized concurrent settings writes, close-time
flush, stale off-screen rejection, and startup recovery onto a connected work
area.

Physical-display identity tests cover trusted and placeholder EDID serials,
DP/HDMI grouping, safe capability intersection, endpoint fanout, restore-result
aggregation, and the idempotent profile-target rewrite. The real desktop and
forced-parent-exit smoke prefer a multi-endpoint physical group when available;
on the G60SD they verified that a single profile target modified both DP and HDMI
endpoints and that both exact endpoint baselines returned after exit.
Process-resilience coverage verifies the version/health/watchdog handshake,
conservative baseline ownership tracking, topology-before-activation restart
ordering, bounded sidecar recovery, fail-closed behavior when modified output may
remain, per-surface renderer crash/oom/abnormal-exit circuits, and coalesced
renderer-independent emergency restoration. Native tests cover the watchdog
deadline/reset behavior and the background protocol reader that keeps lifecycle
signals observable while stdin is idle.
Diagnostic coverage verifies newline-delimited persistence, bounded newest-first
reads, malformed-line rejection, typed response validation, and sender-validated
preload access without exposing a filesystem primitive.
Profile-path regression coverage verifies the explicit stable application-data
location, isolated command-line overrides, exact legacy-file copying,
non-overwrite behavior, and concurrent migration safety.

Milestone 4 coverage validates the renderer-to-main schemas, rejects malformed
profile and preview requests, verifies capability rejection before any preview
write, and covers preview capture/apply/update/confirmation, serialized rollback
after an in-flight display apply,
removal of the final override, and retention of a disabled control's last value.
Preview-session tests also prove that an unchanged same-profile preview promotes
to Edit without restore, capture, or apply writes, while changed drafts retain the
full restore-safe transition.
Activation tests also prove foreground events are remembered without writing
during preview, that ChromaShift's own windows do not replace the external
foreground target, and that rollback applies the latest intended target. Settings
tests cover defaults, validation, and atomic persistence.

Milestone 7 coverage validates the versioned settings migration, notification
policy and completed-outcome wording, including suppression of routine shortcut
feedback when profile notifications are disabled. It also validates shortcut
autosave, Chakra `Kbd` rendering, Windows and Shift modifiers, shortcut parsing
and normalization,
reserved and duplicate accelerators, operating-system registration rollback,
deterministic previous/next selection, disabled-profile handling, and cleanup on
profile deletion. Display-control state-machine tests cover renderer-free Pause,
Resume, retry, toggle coalescing, explicit selection from Paused and Safety
blocked, persisted intent, one-shot restoration, and fail-closed partial restore.
Tray tests assert the approved status/current-profile/action order and both
explicit panel commands.

`npm run smoke:desktop` builds and launches the actual Electron application,
reloads its renderer through the Chromium debugging protocol, and verifies the
sandboxed preload bridge, read-only profile navigation, Settings navigation,
read-only display/color summaries without edit inputs, live Edit preview,
real app-to-mini and mini-to-app handoff with only one visible panel,
multi-open display accordion behavior and default expansion of every configured
display in read-only and Edit modes,
keyboard editing of Default and normal profile names, disabled-control value
retention, profile-name keyboard focus after confirmed deletion, shared trigger IDs
and keyboard behavior for tooltip-wrapped profile
menus, closed Switch labels, disabled-switch tooltip composition, profile
activation switches versus profile enablement, manual/automatic mode transitions,
hover- and focus-revealed sidebar profile actions, unique compound-trigger IDs,
suppression of Edit and Preview only on the profile being edited, and verified
edit-to-edit and edit-to-preview navigation through other profiles' menus,
profile-list Preview and Stop preview state switching,
real Electron same-profile Preview-to-Edit promotion and rollback,
cancellation of a debounced edit before it can reapply discarded values,
explicit-preview rollback when another profile is selected, the exact product
light-mode shell/panel/row/select/foreground colors, right-edge alignment of the
sidebar Settings action, removal of the browser-inspector button from the
production mini panel, and the mini-panel paths where disabling the final
saved color control starts a baseline-only override while an unchanged Default
brightness on/off round trip cancels its temporary override. It also verifies
validated product state, automatic activation with fresh isolated user data,
restore-aware exit, and no renderer errors. Captured images are written under
`apps/desktop/out/smoke/` for the app panel, mini panel, Settings General, the
open Chakra settings Select, Displays, Diagnostics, About, profile deletion
confirmation, the mini profile picker, and the restored Default mini panel. The
settings flow requires a live `ApplicationStarted` diagnostic entry and captures
verbose event payloads in their collapsed state.

The desktop close/reopen path now closes the real native window, verifies that
its renderer is released, and launches ChromaShift again with the same isolated
user-data directory. The single-instance signal must recreate the app panel in
the existing process without starting a second DisplayService owner.

The Milestone 7 desktop sequence records and automatically saves a Toggle
ChromaShift binding through the real Shortcuts settings UI, closes every
renderer, emits the accelerator through Windows `keybd_event`, and observes
main-process dispatch plus native notification creation. The installed-package
sequence also requires Electron to report that Windows showed the native
notification, physically opens Windows Notification Center from the primary
taskbar, clicks the newest profile-change card, and verifies that the app panel
selects the notification's profile. Reopening the app and mini panel verifies
persisted Paused state. The app-panel status control pauses and resumes
ChromaShift, while the mini panel exposes and resumes the same Paused state as an
icon-only control. The
installed shortcut setup also proves that Electron
accepts Shift-only and Windows-plus-Shift modifier combinations, and the
notification flow proves that opting out suppresses a successful direct-profile
shortcut before opting back in for the click-routing gate. Disabled color writes
and Resume are verified before the restoration guard compares exact pre-run and
post-run display state. The same smoke retains
app/mini mutual exclusion, native caption, focus, non-activation, position, and
z-order assertions.

`npm run measure:memory` launches the production Electron build with isolated
user data, samples the complete Windows child-process tree in visible and tray
states, and exits through the same restore-safe shutdown coordinator. The exact
baseline and interpretation live in `docs/performance.md`. `npm run
measure:performance` first builds the unpacked production package, then checks
packaged startup, app-to-mini and app-reopen latency, per-state private memory,
renderer release, and idle CPU against explicit budgets. These host-sensitive
budgets are a local release gate rather than part of generic CI. `npm run
check:renderer-budget` measures all emitted renderer JavaScript and CSS and
fails if their combined gzip size exceeds 360 KB or the largest raw JavaScript
chunk exceeds 1.1 MB. Root `npm run verify` runs this budget after the build.

The desktop smoke keeps a separate native restoration guard alive, proves that
the product changed the real display state, and then compares the post-exit state
with the exact pre-smoke state. `npm run smoke:desktop:crash` runs the same path
but forcibly terminates Electron instead of requesting a graceful exit; this
verifies detached-helper parent-process monitoring and crash restoration.

`npm run package:win` builds an x64 NSIS installer and unpacked directory after
publishing a self-contained, partially trimmed single-file `DisplayService`. The package
command also checks separate budgets for the unpacked app, ASAR, helper, FFmpeg,
locales, and installer. `npm run smoke:package` validates
the exact external sidecar and ASAR layout, the absence of unused DirectX 12 and
Vulkan shader runtime files, and the production fuse wire. It starts the
helper directly, verifies the health/watchdog handshake, exercises NDJSON IPC,
captures and restores a baseline, validates production CSP and renderer sandboxing,
launches both unpacked and installed apps, and verifies install, in-place upgrade,
restore-safe exit, uninstall, and profile-data survival. The smoke install uses
isolated temporary install and user-data directories. `npm run release:preflight
-- --tag v<version> --artifacts` additionally verifies tag/package/lockfile
version agreement and exact x64 installer, block-map, and `latest.yml` metadata.

## Milestone 5 automated closeout record (2026-08-20)

On the current NVIDIA/two-display Windows host, the post-`f03c86a` closeout ran
`npm run verify`, `npm run native:test:integration`, `npm run smoke:desktop`,
`npm run smoke:desktop:crash`, `npm run smoke:desktop:native-recovery`, `npm run
package:win`, and `npm run smoke:package` successfully. The package run validated
the exact unsigned x64 installer, unpacked and installed application, external
sidecar handshake/restoration, in-place upgrade, uninstall, and profile-data
survival. Milestone 5 is complete. The suspend/resume, lock/unlock,
resolution/refresh, driver-reset, baseline-owning helper fault, AMD/mixed-GPU,
signing-certificate, and installer-reputation matrix is deferred to Milestone 8.

## Milestone 6 automated closeout record (2026-08-21)

Package budgets now cover the installer, unpacked application, ASAR,
DisplayService, FFmpeg, and locales. The packaged performance gate covers startup,
app-to-mini and app-reopen latency, visible/mini/tray/reopened private memory,
idle CPU, and release of the app renderer during the mini-panel handoff. The
closeout ran `npm run verify`, `npm run native:test:integration`, `npm run
smoke:desktop`, `npm run package:win`, `npm run smoke:package`, and the packaged
performance gate. The exact installer was 84.69 MiB, its unpacked layout was
285.43 MiB, and the trimmed external helper was 14.01 MiB. Exact results and the
package comparison are recorded in `docs/performance.md`.

## Milestone 7 implementation validation record (2026-08-22)

The implementation validation ran `npm run verify`, `npm run
native:test:integration`, `npm run
smoke:desktop`, `npm run smoke:desktop:crash`, `npm run
smoke:desktop:native-recovery`, `npm run package:win`, `npm run smoke:package`,
and the packaged performance gate. The real desktop run registered and fired a
global Toggle ChromaShift shortcut with no renderer alive, invoked Electron's
native notification API, verified persisted Paused/Resume behavior in both
panels, and restored both displays exactly. The development executable was not
registered for visual notification delivery, and ChromaShift reported that
operating-system rejection accurately. The installed package subsequently
produced a confirmed native notification delivery. With notifications enabled,
the package smoke opened the real Windows Notification Center, physically
clicked the `Notification gate activated` card, and verified that the app panel
routed to the `Notification gate` profile. Windows UI Automation opened the
real hidden-icons drawer,
verified the approved tray-menu order, and invoked both explicit panel commands;
the mini remained non-activating and mutually exclusive with the app panel. A
final packaged performance sample passed at 852 ms startup, 412 ms mini open,
and 727 ms app reopen with all memory and CPU budgets
inside their limits. The installer was 84.70 MiB, the unpacked application was
285.48 MiB, and the external helper remained 14.01 MiB.

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

## Milestone 8 extended hardening matrix

Before advertising production support, test an AMD-driven display, sleep/wake,
topology changes, driver reset, and helper-process crash
recovery. The guarded SDR/HDR/SDR sequence passed on the G60SD on 2026-08-14:
each transition refreshed topology before activation, retained the same stable
display ID and validated baseline owner, performed no provider write while HDR
was active, reapplied the saved profile after SDR returned, refreshed the
renderer capability state in both directions, and restored the exact original
gamma hash on tray exit. Heartbeat timeout restoration is automated and
hardware-verified on the current NVIDIA/two-display host, but suspend/resume and
an actually hung Electron parent remain part of the guarded physical matrix.

`npm run smoke:desktop:native-recovery` force-terminates the exact baseline-free
DisplayService child owned by the smoke Electron process, then requires the
bounded version/health/topology handshake to recover before running the full
desktop and dual-endpoint restoration sequence. This passed on 2026-08-14. A
helper exit that may own a baseline still fails closed; its dialog uses concise
recovery guidance while raw display IDs remain in Diagnostics only.

The guarded DisplayPort hot-unplug sequence also passed on the G60SD on
2026-08-14. The cable was removed during active Edit; topology retained the
immutable baseline as disconnected, Edit remained active, and Cancel handed the
baseline back to automatic activation without a restore request or user error.
Activation deferred the saved target while absent. Reconnect resolved the same
stable ID, validated ownership, reapplied the saved profile, and tray Exit
restored the exact pre-session gamma hash. The unplug/cancel/reconnect interval
contained no `DISPLAY_NOT_FOUND`, transition, activation, or restore failure.

The guarded HDMI cycle also passed on the G60SD on 2026-08-14. HDMI enumerated
with stable ID
`display:b361c05e6dea55c2141cae01b55b5cf220158a717afb90612a60a15add79c3b7`;
an Edit preview changed the gamma ramp from
`3432e90b96d6a0ac86e6989ffcf60cfd73415e57666fff3253d187eba5601edf` to
`1bbef12e9ac2806eef6de7e91afe9e37ad1c4067a5b061b7f29f9094221faff0`.
After disconnect and reconnect, the same HDMI ID returned and exact baseline
restoration was independently verified. The run also verified that a failed
shutdown kept its helper alive beyond the watchdog deadline and could be retried
after reconnect. The subsequent product policy now makes an explicitly requested
shutdown discard an unreachable display's session restoration record instead;
that policy is deterministic-test covered and avoids the disconnect error entirely.

Milestone 5 has automated and live non-mutating topology-refresh coverage. The
extended Milestone 8 physical matrix covers sleep/wake, lock/unlock, resolution
and refresh changes, NVIDIA driver reset, and stable-ID/baseline behavior across
each sequence. These transitions must be observed on the real desktop with the
restoration guard active; they are not inferred from unit tests.
