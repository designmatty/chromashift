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

The desktop test command installs Electron's binary once before starting Vitest
workers. This prevents concurrent first-import extraction after a clean `npm ci`.
For targeted desktop tests invoked directly through Vitest, first run
`npm exec --workspace @chromashift/desktop -- install-electron --no`.

Display-mutating tests keep a separate restoration guard alive, use mild values,
and compare the exact pre-run and post-run state. Do not run them in a remote or
non-interactive session where restoration cannot be observed and recovered.

## Deterministic coverage

The TypeScript and native test suites cover these contracts:

- Profile schema version 3, version 0 through 2 migrations, complete color
  vectors, neutral defaults, gamma safety bounds, CRUD, duplication,
  case-insensitive display IDs, matching, and activation precedence
- Serialized activation, baseline capture before apply, baseline-first profile
  changes, duplicate suppression after success, per-display failures, retry,
  disconnected targets, HDR apply deferral with immediate baseline restore, and topology reapply
- Review #90 proof regressions: baseline-first Apply restoration failures keep
  Safety blocked; failed HDR restoration stops SDR writes in the same transition
  and already queued foreground work; recovery confirms tracked restoration
  before profile writes. A queued preview also checks suspension after activation
  drains. Dirty Edit and override sessions retain metadata and all display targets
  through repeated failure, ownership validation, Retry and HDR-off reapply.
  Update profile saves the retained draft while blocked without display writes.
  Round-two proofs cover teardown superseding interrupted HDR continuation,
  Retry attempting every pending display before resumption, and successful
  End preview completing recovery after failed continuation retries. Recovery
  retains its preview reason in memory through restore, ownership, and resume
  failures while persisting only schema-v1 `resume`.
- Preview start, update, promotion, save, rollback after pending writes, dirty
  navigation, mini-panel overrides, per-control neutral reset, target removal,
  close-time restoration before renderer release, visible failure guidance and
  retries, disconnected baseline retention and confirmed HDR restoration, and
  overlapping close controllers after renderer recovery
- Panel close and handoff reasons with the shared fake native: app close rolls
  back dirty Edit and Temporary override to the exact prior automatic/manual
  target; mini close (and Escape where the panel can take focus) roll back overrides; both handoffs carry an
  override while app-to-mini reverts Edit. Dirty minimize and Windows blur keep
  the session. Close during an in-flight write waits before restoring; a failed
  mini close retains Safety blocked until Retry confirms restoration. App close
  keeps its retry dialog, and a caption close supersedes a pending handoff.
- Unconfirmed preview restoration retained across End preview, Discard, close
  Try again, and persistent failures; Safety blocked prevents automatic/manual
  writes until Retry confirms restoration and serialized activation reasserts
  intent. Fake-native runtime coverage includes failed topology reapply plus
  failed rollback, renderer-free emergency restore-all clearing tracking into
  Paused, a held Retry resuming after emergency restore, shutdown retry, and
  disconnected retention without blocking and HDR restore failure recovery. Pending preview restoration
  persists as schema-v1 `resume` recovery, with Retry restoring tracked previews
  before resuming and working after restart without an in-memory session.
- Physical-display grouping, safe capability intersection, endpoint fanout,
  target rewrite, provider ownership, and restore-result aggregation
- Profile, preference, intent, window-state, diagnostic-log, and legacy-path
  persistence, including atomic writes and concurrent update queues
- Pause, Resume, Safety blocked, restore-and-pause, emergency restore,
  notification policy, global-shortcut replacement, tray commands, and
  renderer-free operation
- Main-process composition, startup buffering, helper handshake and heartbeat,
  bounded helper recovery, renderer recovery circuits, shutdown ordering, and
  failure messages
- Sender-validated Zod IPC, sandboxed preload behavior, CSP, navigation policy,
  Electron fuses, package layout, staged Azure signing order, signed-installer
  update metadata, release preflight, renderer size, and package footprint
- Native gamma transforms, HDR capture/apply rejection, restore-only HDR writes
  with gamma read-back and captured vendor baselines, foreground-window resolution,
  heartbeat deadlines, parent monitoring, display identity, baseline ownership,
  and explicit shutdown policy. AMD fake-provider write failure, custom-color and
  LUT read-back mismatches retain ownership and succeed on retry for single and
  restore-all routes. The production lifecycle loop is exercised through EOF,
  parent exit and watchdog expiry with fake providers and an HDR display.

`fixtures/gamma-envelope.json` is shared by the core, native-client, website,
and C# tests. It covers both sides of the brightness boundaries 6/7, 29/30,
86/87, 89/90, 91/92, 96/97, and 99/100. At each brightness, both gamma limits
are tested exactly, one 0.05 step inside, and one 0.05 step outside. This checks
agreement between the four implementations, not whether hardware accepts a ramp.

The native gamma-rejection regression fakes a `SetDeviceGammaRamp` failure inside
the envelope and asserts baseline-first application, whole-display rollback
including NVIDIA color, a value-specific error, and a `GammaSettingsRejected`
diagnostic with display, adapter identity, brightness, contrast, gamma, and the
underlying provider error. A TypeScript preview regression checks full-vector
restoration, the Electron user-facing message, and forwarding that structured
diagnostic to the existing logger. No protocol version or error-envelope change
is needed. Hue conversion tests round-trip every integer stored value; renderer
tests cover temperature visibility and disabled non-neutral values in both panels,
plus plain mini-panel values and app-panel edit buttons. Fractional hue, gamma,
and brightness edit regressions cover unchanged Enter/blur, Escape cancellation,
and actual changes without silently rounding stored values.

Repository tests also enforce the public-source policy files, verify local
Markdown links, and scan reachable Git history for credential-bearing filenames,
private keys, and high-confidence service credentials.

## Native integration

Owner retest for issues #73 and #79 remains outstanding. No smoke, desktop
driving, display writes, or process stops were run for this fix. On suitable
interactive hardware with a restoration guard:

1. Preview or edit mild values over a known automatic or manual target. Induce a
   connected-display restore failure and End preview or Discard. Confirm the red
   Safety blocked pill with Retry and inline row in the app panel, and the red
   Retry power control in the mini panel. Confirm disabled inputs and absence
   of an editable stuck preview. Check Diagnostics for the display.
2. Keep the failure present and retry from the pill, mini panel, tray, and close
   `Try again`. Each attempt must restore again and remain blocked on failure.
   Remove the failure and retry; confirm Active and the exact prior target, or
   the latest intended selection remembered while blocked.
3. During preview, induce failed topology reapply followed by failed restoration
   and unavailable prior-target apply. Confirm Safety blocked, retained tracking,
   and no subsequent profile writes until a successful restore Retry.
4. From that blocked state, use `Ctrl+Alt+Windows+R` without a renderer. Confirm
   exact Original settings, cleared pending tracking, and Paused after successful
   restore-all. Repeat with Retry or Resume in flight, delaying topology refresh
   until the direct emergency restore finishes. Release the refresh and confirm
   Original settings again, Paused, and no later profile writes. Separately
   confirm Exit retries restoration and stays alive on a connected-display
   failure, then exits only after restoration succeeds.
5. Confirm disconnected baselines remain deferred without Safety blocked, HDR
   baselines restore immediately, and an ordinary mini-panel override survives
   closing the app panel.

These are owner retest instructions, not hardware verification evidence. AMD
writes remain hardware-unverified.

### Owner HDR retest for #88

Required before merge on the owner's NVIDIA-driven HDR display with a second
display in SDR. No smoke, native integration, desktop driving, process stops, or
real-display writes were run to implement #88. Unit and fake-native results do
not establish HDR restore safety or hardware acceptance. Use an independent
restoration guard with known original ramp hash and NVIDIA vibrance/hue values.

1. Start in SDR over a known automatic or manual target. Edit mild brightness and
   saturation values without saving, with a separate draft target on the SDR
   display. Enable HDR in Windows. Confirm immediate original output and exact
   baseline read-back on the HDR display, unchanged draft and Update/Discard
   actions, and unchanged draft output on the SDR display.
2. Check both app and mini panels. The HDR notice must explain original settings
   and disabled target values that apply when HDR is off. Check both themes and
   scrolling in the fixed-size, non-activating mini panel. Turn HDR off and
   confirm the unsaved draft reapplies. Repeat with a mini-panel override.
3. With HDR on, test Discard, End preview, a same-display profile switch, a switch
   to a profile without that target, and Default. The HDR display must stay at
   original settings. Turn HDR off after each and confirm the saved or intended
   target rather than the discarded edits.
4. Edit again, turn HDR on, then tray Exit and choose Discard. Confirm exact
   restoration and normal exit without an HDR deferral. Separately exercise the
   helper watchdog and parent-exit/EOF restoration under the owner's guarded
   hardware procedure, confirming the original ramp and vendor values before
   any relaunch. The implementation agent must not stop a running app.
5. Under a controlled restore failure or read-back mismatch in HDR, confirm
   Safety blocked, disabled inputs, retained baseline ownership, and repeated
   Retry or Exit failure until restoration can be confirmed. The HDR notice
   must not claim restoration succeeded. Confirm a disconnected display still
   retains its baseline for reconnect and explicit shutdown discards only
   unreachable restoration records.
6. Keep the restore failure present, turn HDR off, and Retry. A failure during
   baseline-first Apply must remain Safety blocked. With a restore held, queue a
   different foreground profile and then fail restoration. Confirm neither the
   current transition nor queued work changes SDR output after the failure.
7. Make an unsaved Edit or mini-panel override with different targets on both
   displays. Fail HDR restoration once, then allow Retry to succeed. Confirm the
   full draft and SDR output survive, editing still works, and HDR-off reapplies
   the draft. Separately save with Update profile while blocked, confirm the
   saved values and no new display writes, then recover with Retry.
8. After a failed HDR restore during Edit, end the preview and fail restoration
   on the SDR display instead. Retry must attempt that SDR restore and remain
   Safety blocked until it succeeds, with no profile writes during failure.
   After confirmation, the preview ends and the intended target resumes.
9. Fail an HDR continuation Retry, then allow restoration and choose End preview.
   Confirm all pending displays restore and control becomes Active without an
   additional Retry.

Record GPU/driver, display model, Windows HDR toggle method, original and final
ramp hashes and vendor values, logs, and any visual difference between read-back
and output. Restore-only HDR writes on NVIDIA and all AMD writes remain
hardware-unverified until the corresponding owner checks are recorded. Real HDR
profile support is tracked separately in #89.

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

The close-retry presentation fixture uses the production close controller and
native dialog adapter with a fake restore error. It starts no DisplayService and
writes no displays. It checks the window-modal prompt, both button labels, the
native capture at `close-retry-guidance-native.png`, Keep open through native
Cancel, and a later successful close. Actual hardware restore failures remain
distinct from this presentation evidence. A deterministic two-window regression
covers renderer recovery during a pending close without starving either drain.

The flow covers independent profile navigation, the Automatic | Manual toggle
in expanded and collapsed A | M forms, keeping the live profile when entering
Manual over a preview, row-menu activation, pill labels, shortcut tooltips,
Enabled/Disabled availability, paused presentation and explicit resume, profile editing,
per-display tabs, read-only parity, sidebar collapse, pointer and keyboard profile
reordering, cancelled drops, saved order, disabled rows, pinned Default, and list
edge scrolling, capability states,
application assignment, live preview and rollback, Default and manual activation,
temporary mini-panel overrides,
Pause and Resume, diagnostics, theme states, profile deletion focus, app and mini
mutual exclusion, native caption behavior, mini-panel non-activation, tray
reopening, and renderer release.

The smoke asserts that Automatic and manual selection while Paused update intent
and remain Paused until explicit Resume. A fake-display runtime regression holds a
topology refresh across emergency restoration and checks that completing the
transition leaves original settings Paused without another profile apply. Native dark/light app and
collapsed-rail captures cover the toggle, live ring and preview/disabled badges.
The deterministic presentation tests cover Shift+Enter activation, clean Edit
preview eyes, and the single-pill precedence: Paused or Safety blocked, unsaved
hold, non-live preview, then Active mode. Safety blocked retains Retry; no native
fault is induced for these label and color checks.

The smoke retains the neutral new-profile, persistent preview-strip,
same-profile no-op, in-place header Update/Discard, truncated-name tooltip,
mini-panel ellipsis, override-hydration and native quit-Cancel checks from main.
It explicitly dismisses any remaining profile menu before inline naming and
waits for the unselected-profile delete dialog to focus Cancel before choosing
an action. Intermittent assertions and native quit automation limits are tracked
in GitHub issue #81; their assertions remain in place.

It records and fires configurable shortcuts with no renderer alive, fires the
fixed `Ctrl+Alt+Windows+R` emergency restore shortcut, and verifies exact display
restoration before exit. Renderer and visible native-window screenshots are
written under `apps/desktop/out/smoke` for visual inspection. Native captures
include the app's Windows caption controls and the actual paused mini-panel
window without activating it. Electron creates a development
Start menu shortcut when a development notification initializes. Development
ChromaShift uses a separate development notification identity and removes its bare
`Electron.lnk` at startup and on normal exit. The development launcher, desktop
smoke, and development performance runner also clean it up after their child exits.
Cleanup checks the shortcut's target, arguments,
and application ID; packaged-app shortcuts and other Electron apps are preserved.
Owned leftovers are removed even when they existed before the run.

Panel lifecycle coverage uses the saved smoke profile, real panel windows, and
the existing independent restoration guard. It checks dirty Edit and override
caption close followed by a renderer-free tray interval and app reopen, mini
close control, both override handoffs through App view and Open settings,
and Edit rollback on app-to-mini. Main-owned `getState` confirms the ended
session and unchanged saved profile; guard fingerprints confirm the exact prior
native target. Dirty minimize keeps both session kinds. A click on a disposable
smoke-owned window checks Windows outside-click behavior. The native quit
warning checks Update / Discard / Cancel and cancels for both session kinds.
The close-retry presentation fixture still fakes restoration failure; it does
not establish hardware failure recovery.

### Owner checks for panel close and handoff

For #87, the implementation agent updates and syntax-checks the smoke script
without running smoke, native integration, or driving the desktop. The owner
runs `npm run smoke:desktop` on interactive hardware with its restoration guard.
Automated verification and these pending owner checks are separate evidence.

Use mild changes on a supporting SDR display and keep a restoration guard.
Record the saved profile, activation mode, and exact native target before each
case. Repeat rollback checks from Automatic and Manual.

| Action                            | Owner steps and expected result                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App caption close / close-to-tray | Make an unsaved Edit, close, and reopen. Repeat with a mini override carried into the app. Both end the session, leave the saved profile unchanged, and restore the exact prior target silently.                   |
| Mini close control                | Change a mini value, press Close mini panel, and reopen. The override ended and the exact prior target is restored.                                                                                                |
| Mini to app                       | Change a mini value, then use App view. Repeat with Open settings. Both open the unsaved draft with the override still applied and Update / Discard available.                                                     |
| App to mini                       | Carry an override into the app, then open mini through its shortcut or tray. The override stays applied. Repeat with a dirty Edit; that Edit rolls back before the app renderer is released.                       |
| App minimize                      | Minimize and restore with each session kind. Unsaved values stay applied and automatic switching stays on hold.                                                                                                    |
| Quit / tray Exit                  | For each session kind, verify Update / Discard / Cancel. Cancel keeps the session, Update saves before restore-safe shutdown, and Discard shuts down without saving. Repeat caption close when configured to quit. |
| Windows outside click             | With a mini override applied, click outside the panel. It stays visible and applied.                                                                                                                               |

Also verify Update profile and Discard changes while each panel is open. For a
restoration failure, use a controlled failure fixture first: app close keeps the
existing retry dialog; mini close stays visible with Safety blocked and Retry.
Retry must confirm restoration before the prior target resumes. A real driver
failure remains a separate hardware check. Close during a pending preview write
must wait and restore the exact prior target, without a late draft write.

After a build, `node apps/desktop/scripts/smoke.mjs --updates-only` runs the
About update flow against the public Cloudflare release feed, verifies that navigation
retains the last successful check, and captures the visible native window before
and after checking. It uses the same isolated user data and restoration guard as
the full smoke. Deterministic tests cover newer installers, preview and stable
channels, failed requests, timeouts, download URL validation, manifest agreement,
publisher signatures, cache tampering, and restoration before installer launch.

After a build, `node apps/desktop/scripts/smoke.mjs --shortcuts-only` checks the
compact shortcut editor in the real Electron window using isolated user data and
the restoration guard. It covers capture before Save, registration, rejected
reserved bindings, cancellation, keyboard focus, removal, hover, and the overflow
menu. Native window captures of the idle, hover, recording, draft, menu, and
rejected states, plus light-theme captures, are written under
`apps/desktop/out/smoke`.

Phase-4 desktop smoke changes:

- Scope neutral-action selectors to their control and use `Reset to neutral`.
- Check percentage, hue-degree, and two-decimal gamma labels, neutral markers, and
  the absence of numeric stepper controls. Check computed hue and saturation
  gradients so theme backgrounds cannot silently clear them.
- Exercise app-panel inline value Enter, blur, and Escape, value arrow keys, and
  wheel adjustment on the slider and the open value editor using mild brightness
  changes. Scrolling over a closed value changes nothing. Mini-panel values stay
  plain text after a click and ignore the wheel.
- Capture both themes with hatched gamma limits and the sixth temperature row
  while Paused. Restore the saved fixture before Resume and verify unchanged
  native display state. These presentation values are never applied to hardware.
- Capture the app's color controls in dark and light native windows.
- Include preview and control state in timeout diagnostics.

Outstanding human hardware matrix: apply each gamma/brightness corner on real
displays and record the display model, GPU, driver version, accepted/rejected
values, and exact restoration. Include driver-rejected ramps inside the envelope.
AMD writes remain hardware-unverified. Neither fixtures nor desktop smoke replace
this matrix.

In-app download and installation run only in packaged Windows builds. Before a
release, validate a signed installed build against a newer signed release using
the normal package restoration guard. An unsigned local build must reject
automatic installation; a development launch exercises checking only.

`node apps/desktop/scripts/update-download-smoke.mjs` checks the production release
feed, downloads the real signed preview.10 installer from a preview.9 test
identity, and revalidates its hash and publisher against the supplied signed
application. Optional arguments are the signed app path, source version, and
target version. The harness reads that application's packaged updater
configuration, uses an isolated cache, starts no display helper, and never runs
NSIS. It proves the download and verification path, not an installed upgrade.

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

Also inspect the visible Start menu after uninstall. Windows 11 24H2 and 25H2
can retain a dead entry after the shortcut and shell app registration are gone.
Microsoft documents this [Start menu cache issue](https://jpwinsup.github.io/blog/2026/04/16/Shell/Explorer/installed-applications-dont-appear-in-new-StartMenu/)
and a workaround of refreshing the current user's `StartMenuExperienceHost`
process. Distinguish this from a remaining shortcut by checking both user and
common Start menu folders and `Get-StartApps`. Application cleanup must not
automatically restart the user's shell or delete their Start menu database.

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
- Historical SDR to HDR to SDR apply deferral and reapply with exact final
  restoration; this does not verify the new restore-only writes during HDR
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
- Restore-only writes while HDR is active on NVIDIA or AMD
- mixed-GPU display control
- suspend and resume, lock and unlock, refresh-rate and primary-display changes
- NVIDIA driver reset
- a hung Electron parent or a helper failure while it may own a baseline
- clean-VM reputation and SmartScreen behavior

These are issue-driven follow-up tests, not claims implied by CI or the current
NVIDIA record.
