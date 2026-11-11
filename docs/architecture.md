# Architecture

```text
React profile renderer
  -> sandboxed preload
  -> Electron main
       -> @chromashift/core (profiles, matching, activation, persistence)
  -> typed NativeClient
  -> NDJSON over child stdin/stdout
  -> ChromaShift.DisplayService.exe
       -> display registry / foreground watcher / baseline manager
       -> per-capability Windows, NVIDIA, and AMD providers
```

Electron owns product behavior. The renderer has no Node integration and sees
only a narrow context-bridged product API. Native handles, vendor structures,
profile matching, and persistence never cross layers accidentally.

Electron remains the production desktop shell after a measured side-by-side
Tauri 2 port. Tauri materially reduced the renderer-free tray floor and installer
size, but its visible app and mini-panel states were heavier on the test host and
the port duplicated the mature TypeScript product core in Rust. ChromaShift keeps
Electron Builder rather than adding Electron Forge; `docs/performance.md` records
the measurements and the threshold for reconsidering the shell.

`DisplayService` owns only Windows/GPU work: active-display enumeration,
foreground events, capability discovery, native state reads/writes, and exact
baseline restoration. It resolves controls independently. On the tested NVIDIA
display, brightness/contrast/gamma resolve to the Windows ramp provider while
saturation/hue resolve to NVIDIA. AMD custom-color controls and its gamma LUT are
separate ADLX capabilities.

Provider handles are reacquired for operations rather than persisted across
topology changes. Every write is validated and read back. The baseline manager
captures all supported state before the first mutation, applies transforms from
that immutable baseline, restores the whole display after partial failure, and
restores all displays during shutdown or parent-pipe EOF.

For an explicit GDI `SetDeviceGammaRamp` rejection, the native apply walks gamma
in 0.05 steps toward neutral, including 1.0, rebuilding each ramp from the
immutable baseline. Rejected writes leave output unchanged, so the walk has no
intermediate restore. Accepted writes still require exact read-back. Exhaustion,
read-back errors, and other partial failures retain whole-display restoration.
HDR remains restore-only. Protocol v2 reports the accepted gamma and an optional
learned end, value, brightness, SDR mode, and captured ramp hash in `display.apply`.
Native persists no limits. See `native-protocol.md` for the result schema.

Main owns `display-limits.json`, a separate schema-v1 settings slice written
atomically through `SettingsSliceStore`. `displayLimitsSchema` in core validates
`{ schemaVersion: 1, displays: { [stableId]: { sdr?: { baselineHash, brightness:
{ [brightness]: { min?, max? } } }, hdr?: { baselineHash, brightness } } } }`.
Only SDR learning is active. Missing files start empty; invalid or unsupported
documents fail startup validation and remain untouched. Fixtures live under
`fixtures/display-limits`. Existing profile and settings schemas stay unchanged.

`PhysicalDisplayClient` associates captured endpoint hashes with a stable panel,
invalidates limits after a changed captured baseline, clamps after capability projection,
and converges simultaneous endpoints to their common accepted gamma. It never
uses current modified output as a baseline. Main's `LearnedGammaLimits` merges
learned ends with the unchanged starting envelope. The serialized profile writer
quietly clamps saved gamma on apply or editor opening, without a notification.
Persisted limits remain inactive until normal capture-before-mutation confirms
their baseline hash in the current session. Restoration that releases a baseline
or a helper exit revokes that confirmation. Quiet updates and renderer feedback
use limits only for connected SDR displays that support gamma. Learning, lookup,
clamping, and feedback use brightness 50 when capabilities omit brightness from
the native request, while the saved brightness intent remains unchanged.
Session references and drafts change only their gamma fields, retaining other
unsaved changes. Both renderers receive validated read-only limits and can
request a sender-checked per-display reset through preload. Reset changes the
limits slice without a display write or undoing earlier saved profile clamps.
`ServiceLifecycle` owns the production input, parent-exit and watchdog loop and
its final restore-all acknowledgement. Unit tests drive those routes with fake
providers without launching a helper or touching Windows displays.

`@chromashift/core` owns the vendor-neutral product model.
It validates versioned JSON configuration, matches foreground applications, and
resolves manual/foreground/default/baseline precedence without importing
Electron or the native client. A storage port leaves the app-data filesystem
adapter in Electron main. See `core-domain.md` for the exact contracts.

Electron main is split along one seam. `product-runtime.ts` owns the product
side: the native client, every domain controller, and all wiring between them,
including native event routing (`native-event-router.ts`) and activation
outcome routing (`activation-outcome-router.ts`). `index.ts` is Electron shell
only: windows, panels, IPC registration, and app lifecycle. It supplies the
runtime's grouped ports (settings accessor, dialogs, icons, panel commands,
system registrations, notifications). The shell reaches product behavior
through the runtime's `productController`, `shutdownCoordinator`, and
`previewController` getters plus `start()` and `dispose()`; the runtime reaches
the shell only through its ports. The DisplayService connection enters through
a `createClient` factory port typed as the union of the consumer ports the
runtime feeds, so runtime startup wiring (start-mode selection, the
health/version handshake, fail-closed display-write gating) is covered by
fast in-process tests against `testing/fake-native-display.ts`, the one
shared fake for the native display seam that activation-coordinator and
preview-session tests also use. Product wiring changes belong in the runtime
and routers, not in `index.ts`.
An unsuccessful handshake keeps the product controller, IPC, tray navigation,
app window, and shutdown coordinator reachable. The native-service gate returns
offline display reads and rejects display mutations until negotiation succeeds;
the native client independently rejects mutating requests before negotiation.
Transient startup failures use bounded recovery. A known incompatible helper
shows a compatibility dialog and persistent tray status and is not retried in
that process. Reinstalling matching versions and restarting negotiates afresh.
Invalid persisted configuration remains untouched and blocks its writers.
The main-owned emergency shortcut logs a skipped restore when negotiation failed
and no baseline could be owned; compatible-helper restoration continues through
the normal controllers.

Electron main composes that domain layer with the native client. It stores
configuration atomically at `profiles.json` under Electron's user-data directory
and validates the complete document before automatic activation is enabled.
Foreground events received during startup are buffered until validation finishes.
Invalid persisted data disables automation explicitly rather than silently
replacing the user's configuration.

The activation coordinator processes foreground transitions through one promise
queue. It resolves the intended profile in arrival order, suppresses a duplicate
only after a successful transition, captures each desired display baseline before
applying, restores displays removed from the next profile, and restores all
captured displays for a baseline target. Because the native baseline remains
immutable across profile changes, gamma transforms never compound. Per-display
apply failures are logged and returned as partial outcomes while remaining displays
continue. Restoration failures stop further profile writes in that transition
and block queued activations before they execute. Explicit recovery confirms
tracked baselines through restore-all before applying targets. Baseline restoration
errors returned by native Apply also keep control blocked. Failed transitions
reset deduplication so confirmed recovery can retry.
External restoration and native-service exit also reset activation state.

HDR blocks profile application and baseline capture in both Electron and the
helper. Restore-only writes of an existing immutable baseline are allowed with
read-back, independently of the unsupported apply capabilities. An HDR-on
transition restores the display immediately. Discard, End preview, profile
switches, shutdown, watchdog, parent exit, and stdin EOF also restore HDR displays.
Only confirmed restoration releases ownership; an unconfirmed restore enters
Safety blocked in the running app and remains retryable. Activation restore
failures suspend subsequent foreground writes, and a failed recovery stays
blocked. Disconnected baseline retention is unchanged.

HDR restoration preserves the Edit or override session, unsaved draft, and SDR
targets, including after a transient restore failure. The interrupted session
continues to publish its full draft while Safety blocked disables color writes.
Retry validates topology and ownership, restores the affected displays, and
reapplies the retained draft without ending the session. Update profile can save
the draft while blocked without changing display output.
Preview recovery uses one model for its purpose and pending display IDs.
Ending the session supersedes continuation recovery with every remaining
teardown restore, including failures on previously unaffected SDR displays.
Retry cannot resume activation until those restores are confirmed. The
in-memory preview recovery reason survives failed retries, so a successful
End preview completes recovery without an extra Retry. It still persists as
schema-v1 `resume`.
Both panels explain HDR above disabled target values; those values apply
when HDR turns off through the existing topology transition. The mini panel keeps
its fixed window sizing and scrolls the controls pane if needed. Windows gamma
restore verifies the exact captured ramp, NVIDIA restore verifies vibrance/hue,
and AMD's existing restore writes captured custom-color values and LUT directly
with read-back. No provider's profile setters are enabled under HDR. Restore under
HDR still requires owner NVIDIA hardware verification; AMD remains unverified.

Display and power transitions use a second coordinator around that same activation
queue. Electron lock/suspend notifications pause new writes immediately; unlock,
resume, Electron screen changes, and the native Windows display-settings event are
debounced into one `display.topology.refresh`. The helper re-enumerates active
displays, reacquires provider handles, resolves current capabilities/HDR, and
validates every retained immutable baseline against the stable display ID and
adapter provider. Only a validated snapshot can reapply the intended
automatic/manual target or active preview. A disconnected baseline is retained during
the running session for safe reconnect/restoration; a provider-ownership mismatch
fails closed and is never recaptured from potentially modified output. Saved targets
for disconnected displays remain in profile persistence but are omitted from the
normal editor and are quiescent rather than failed activations: Electron issues no
capture, apply, or restore request until the stable display ID returns. If a display
disconnects during Edit or Preview, the session keeps that target, teardown hands its
retained baseline ownership back to activation without showing a restore failure, and
the next validated reconnect transition restores or reapplies the intended state.

Display identity has two layers. The native service keeps a unique endpoint ID
for each active Windows/GPU connector path because baseline ownership and restore
must remain independently addressable. It also reports a physical ID derived
from a trustworthy EDID manufacturer and serial, falling back to the endpoint ID
rather than risking an incorrect merge. Electron presents and persists one
profile target per physical ID, intersects capabilities across its current
endpoints, and fans capture/apply/restore out to every endpoint. An idempotent
startup rewrite converts currently resolvable connector-era targets once. See
`docs/physical-display-identity.md`.

The renderer uses centralized Zod request and response contracts shared by
renderer, preload, and main. Preload exposes capability-oriented methods rather
than a generic IPC invoke. Main validates the sender and input for every
privileged request, validates its response before returning it, and maps native,
persistence, validation, and unsupported-capability failures into explicit
user-facing results.

About exposes `openExternalLink(link)` with only four validated identifiers:
`website`, `releases`, `repository`, and `license`. Main maps them to fixed HTTPS
URLs (`https://chromashift.io` and pages under
`https://github.com/designmatty/chromashift`), sender-checks each request, and uses
`shell.openExternal`. The renderer cannot supply a URL. Window creation and
unexpected navigation remain denied.

The About page requests update checks through that same validated preload API.
The main-owned `UpdateChecker` contacts the fixed HTTPS feed at
`updates.chromashift.io/v1/releases.json` only on request, compares semantic
versions on the current release channel, and retains the last successful result
for the session. A separate static Cloudflare Worker serves the newest complete
published stable and preview releases. The feed pins ChromaShift's numeric GitHub
repository ID and supplies its current owner/name, so an organization transfer or
rename does not change the app's check URL. Installer URLs must exactly match
that repository, version, and Windows x64 filename. `AppUpdateService`
retains download progress and install intent across renderer lifetimes. Installed
Windows builds use `electron-updater` with the exact release's `latest.yml` feed;
the installer hash and a valid Authenticode publisher matching the running app
are required. Both are rechecked before installation. Automatic install-on-quit is
disabled. **Restart and install** requests the existing shutdown coordinator;
only its exit port, after queued writes and confirmed restoration, starts NSIS.
Failed restoration keeps the application alive and leaves the download retryable.
Development builds support checking only. No background checks run.

The renderer uses Chakra UI v3 for accessible primitives, semantic theme tokens,
and product layout. `src.tsx` is bootstrap-only; app composition, Profiles,
Displays, Settings, and the mini panel live in focused modules under `app/`,
`features/`, `components/`, and `hooks/`. Electron-specific drag regions,
non-activating mini-panel geometry, and panel composition use Chakra
style props or component-local Chakra `css`; there is no application-owned
global stylesheet. Tailwind, shadcn, and Base UI were removed before the
per-display UI redesign so the renderer has one styling system. The app panel
and mini panel are separate lazy renderer entries. React Router remains deferred
because the three app-panel views do not need URL navigation.

The shipped app-panel redesign extends React content into the title-bar area with
Electron's hidden title bar and native `titleBarOverlay`. Windows continues to own
caption controls and Snap behavior; the renderer owns only the reserved header
layout plus explicit drag/no-drag regions. A fully frameless window with replacement
caption buttons remains out of scope.

The profile workspace supports CRUD, default/manual activation, multi-display
targets, foreground-app triggers, and an Electron `.exe` picker. Triggers sit
above color controls as compact executable chips, with add actions at the right
of the section heading. The header shows an assigned hotkey at the start of its action group. Its
controls derive support and provider explanations from each selected display's
capability report; HDR-unsafe Windows gamma controls remain disabled. A separate
display view retains the hardware diagnostics needed for provider support.
Profile deletion, unsaved changes, and shortcut removal use Chakra's renderer-modal `Dialog` so closing an overflow
menu and removing its trigger cannot strand Windows keyboard focus outside the
app.

Live preview is an explicit activation session. It suspends automatic display
writes while still remembering foreground changes and applies only validated
settings from the native service's immutable baseline. During app-panel Preview or Edit, displays
without a target are held at Original settings by restoring existing baselines,
with no capture or write on displays that have no baseline. Teardown hands retained
baselines back to activation and resets deduplication before reapplying the prior
target, including displays held at Original settings. Both renderer surfaces
drive their sessions through one shared seam: `use-preview-draft.ts` owns the
draft and dirty state, and the framework-free `preview-sync.ts` session owns
debounced draft synchronization, the start-versus-update decision, and
race-safe rollback that waits for in-flight writes before cancelling. Surface
flows (click-to-preview selection and collapse-on-equal) stay in
`main-app.tsx` and `mini-panel.tsx` and call into that seam. App-panel profiles
are always editable while Active. A sidebar click previews saved values without
changing activation mode; the first change promotes unchanged preview targets to
Edit before synchronizing the draft, retaining baseline ownership without a
restore or capture. A matching mini-panel Override also promotes to Edit in place,
with no native write. Main retains the complete draft, including metadata, and
reports whether it differs from the saved profile. The app opens that override in
the normal editable profile view and unsaved action bar, even if Settings was the
last remembered view. Dirtiness compares the draft with saved content, so reverting
an edit clears it. On the live profile, `Update profile` commits while preserving
mode and `Discard changes` rolls back. On another profile, both stay on it: Update saves while its
session keeps previewing the saved values, and Discard reverts the session to them
in place, restoring Original settings for targets the saved profile lacks.
Renderer dialogs guard navigation and activation changes
with unsaved changes. End preview, live-profile selection, and close return to
the live profile. Minimize ends only a clean preview; unsaved edits and overrides
stay applied with their draft intact. While unsaved changes hold automatic writes,
the app pill and mini-panel power icon are amber, and the tray tooltip and menu
status say `Auto-switching on hold`. Main publishes the latest queued automatic
target through the validated product state. The profile offers Update or
Discard, after which the existing rollback/completion path applies the latest
foreground target. Focus loss does not end preview. Cancellation,
navigation, and failure wait for pending writes before restoring the previous
manual/foreground/default/baseline target. Preview has no countdown. Native apply
restores baseline before each complete settings request so removing an override
cannot inherit stale values. The mini-panel override flow remains separate.
Every teardown path retains unconfirmed connected-display restores in
`PreviewSessionController` and reports `restorePending` through validated product
state. This state exposes only tracked display IDs, so neither renderer hydrates
it as an editable preview. `ChromaShiftController` suspends activation writes and
enters Safety blocked with a pending preview-restore operation. No rollback
reapply occurs before restoration succeeds, including after a topology reapply
failure. Retry or a later teardown restores the remaining displays, releases the
preview hold, validates resumption, and reasserts the intended target through the
activation queue. In-session restoration failures instead retain the session and
its draft for continuation, without restoring unaffected SDR draft targets or
silently treating recovery as Discard. Disconnected baselines still pass back to activation as retained
ownership without a restore failure. HDR displays restore immediately;
`baselineNotCaptured` needs no restoration or capture.

Tray left-click reopens the last-used panel. If that panel is already visible, the
full app is focused or the non-activating mini panel is raised to the popup-menu
window level above the hidden-icons drawer. Opening either panel hides the other, so
both product surfaces are never visible together. On Windows the mini panel remains a
pointer-oriented, non-activating Electron surface: opening or interacting with it
does not make ChromaShift the foreground application. The panel has an explicit
close button, closes when the full app opens, and can be dragged by its header. A user
position is persisted and clamped to a connected display; without one, the panel
opens next to the tray. Quick color changes expose `Update profile` and
`Discard changes`. The close control silently rolls back the override;
opening the app carries it over as an unsaved draft. Profile selection discards
temporary changes without a dialog and establishes
a manual override until the user returns to Auto switch. Mini-panel footer actions
open the corresponding Profiles, Displays, or Settings view in the
native-caption-controlled app panel.

App settings persist as three slice files under the user-data directory, one
per owner: `preferences.json` (renderer-editable user preferences: login
launch, launch/close behavior, theme, notifications, shortcut bindings),
`window-state.json` (Electron-shell window geometry and mini-panel position),
and `chroma-shift.json` (runtime-owned display-control status and intended
activation target). Each slice has one store with a serialized update queue,
so writers within a slice cannot clobber each other and no cross-slice
coordination exists. The renderer sees and edits only the preferences slice;
main-owned fields are structurally absent from the IPC contract rather than
defensively guarded. A missing slice file yields defaults; the pre-slice
`settings.json` blob was converted once and has no in-code migration path.
Preferences schema version 3 adds the optional End preview shortcut action.
Version 1 and 2 documents migrate explicitly, preserving all bindings and
preferences; End preview starts unassigned. Invalid documents are preserved and
reported. Migration is written on the next successful preferences update.
Explicit launches still show the app panel. The permanent Default profile
remains the only catch-all, cannot be disabled or deleted, and cannot receive
triggers.

Electron main owns native notifications and global shortcut registration, so
both remain available with no renderer alive. One user preference enables or
suppresses every native notification type. Shortcut replacement is atomic:
validation, reserved-key and duplicate checks, and operating-system registration
must all succeed before the new bindings are persisted, otherwise the last valid
set is restored. Profile bindings follow profile rename, disable, and deletion;
disabling a bound profile requires explicit confirmation that names the binding.
The fixed emergency-restore accelerator is reserved outside configurable
bindings and appears as a read-only Safety action in Shortcut settings.
Settings groups shortcuts into Safety, Control, Navigation, and Profiles, with
Default first and one keycap per key. End preview is a Control action. Main
flushes buffered renderer drafts, ignores requests without an app preview, and
dispatches to the renderer's existing End preview action. Unsaved changes bring
the app forward for the same Update / Discard / Cancel dialog. A clean preview
rolls back and returns to the live profile. It does not end mini-panel overrides.
The event carries the current app-panel lifetime and profile ID so stale requests
cannot act on another panel opening or profile.

General labels the login preference Launch at startup and disables Startup
window while it is off. Settings Back sits beside the sidebar collapse control;
bare Escape goes back only outside inputs, shortcut recorders, menus and dialogs.
Displays reports each capability's Controlled by source and rounds refresh rates
with the precise value available on hover. Successful Restore displays a paused
notification with Resume, after confirming Paused through the product API.
Diagnostics filters and searches only the validated tail of at most 250 entries
already received through preload. Filtering does not change copied or downloaded
logs. Details pretty-print valid JSON and preserve plain text. Clear logs uses a
renderer confirmation dialog.
Notification wording is derived from completed activation outcomes and
distinguishes full, partial, deferred, failed, paused, resumed, retry, restore,
and no-op results. Clicking a profile notification opens that profile in the app
panel.

Display control has three persisted states: Active, Paused, and Safety blocked.
Pause suspends new writes, waits for in-flight activation, restores every owned
baseline, and enters Paused only after full restoration. An incomplete restore
fails closed into Safety blocked. Resume re-resolves the latest foreground app
and applies the preserved intended mode and target. Explicit profile or Automatic
selection updates intent while staying Paused; during a safety block it updates
intent without bypassing the required retry. Safety blocked persists whether the
interrupted operation was Pause or Resume so retry completes the correct
operation. The intent slice remains at schema version 1 with pending `pause`
or `resume`. Pending preview restoration persists as `resume`; Retry first
confirms tracked restores before activation resumes. An interrupted session
continues, while pending teardown ends the session. The preview-specific reason stays in memory and
validated product state, allowing a later successful End preview or Discard to
resume automatically. After restart, Retry validates resumption without an
in-memory preview session.
Restore original settings reuses the Pause path and preserves intent. After full
restoration, Paused persists until the user resumes. Restore original settings is
a no-op while Paused or Safety blocked; the emergency shortcut still restores
directly.

The system tray reads the same activation and display-control state, supports
manual profile overrides, returns to automatic mode, restores original settings,
and pauses, resumes, or retries display control. It exposes separate app- and
mini-panel commands while preserving last-used-panel left-click behavior.
Closing the window either releases its renderer to the tray or requests shutdown
according to settings. `app-panel-close-controller.ts` passes an explicit `close`
or `handoff` reason to `PreviewSessionController.cancelForPanelHide`, which drains
the existing serialized rollback before notifying the renderer or releasing it
through the window controller. Close rolls back Preview, Edit, and Temporary
override; app-to-mini handoff rolls back Edit and keeps a Temporary override.
A genuine restore failure keeps the app panel open and visible
and enters Safety blocked with pending display tracking. It uses the same
retry/cancel guidance as shutdown; a later close or `Try again` re-attempts the
native restore rather than treating an ended session as proof of restoration.
The close dialog is modal to its app window and offers `Try again` or
`Keep the window open`; shutdown keeps its existing `Keep ChromaShift running`
wording. The shared shell adapter is `restore-retry-dialog.ts`. Concurrent close
drains, including an old and recovered renderer's windows, share the preview queue.
Each drain owns only sessions admitted before its close began. Restoration of
those sessions must finish before a newly reopened editor can apply; the old
drain cannot cancel the new editor or release its renderer.
Each panel opening has a main-owned lifetime token. Preload receives it through
a validated event and captures it when a debounced edit is scheduled. Main
rejects preview requests from closed or older openings, including requests that
finish loading a saved profile after close. Closing also tells the renderer to
invalidate pending synchronization.
Panel profile and Automatic selections carry the same lifetime. The renderer
rechecks it after draining preview writes, and main checks it at admission,
after delayed selection work, and before queued activation. Tray and global
shortcut selections remain independent of panel lifetimes.
Closing either panel to the tray silently reverts unsaved changes through main-owned rollback.
The mini close control uses that path; failure keeps the mini panel
visible with Safety blocked and Retry. Mini-to-app handoff hides the mini panel
without ending its override. App-to-mini handoff releases the app renderer with
an explicit handoff reason, including when caption close is configured to quit.
Edit rollback starts immediately; only renderer release waits for the handoff
response. Reopening the app during that grace period keeps the reopened renderer.
Minimize keeps dirty edits and overrides; Windows outside clicks keep the mini
panel open. An override already pending restoration is retried on close.
Opening the app recreates the renderer from main-owned
product state. ChromaShift holds a single-instance lock, so launching it again
signals the existing tray process to recreate and focus the app panel instead
of starting a second DisplayService owner. A hidden mini-panel renderer is
released after a short grace period so one quick reopen remains responsive
without retaining a second renderer indefinitely. Electron hardware
acceleration is disabled because this utility has no GPU-heavy renderer work and
the measured Windows private-memory reduction is material;
`docs/performance.md` records the benchmark and the conditions that would
require revisiting this decision.
Main-window normal bounds and maximized state are persisted through a debounced,
serialized settings writer. Geometry that no longer intersects a connected work
area is rejected, startup recenters stale bounds, and close synchronously captures
the final valid state while its atomic disk write remains independent of
restore-safe display shutdown.

DisplayService liveness is a restoration contract rather than a generic process
restart. Electron sends two-second heartbeats after a version/health handshake;
the helper's independent ten-second watchdog restores every retained baseline
and exits if Electron is alive but unresponsive. The client conservatively tracks
every display that may have a native baseline. A watchdog-restored exit clears
that ownership through a final validated protocol event, after which bounded
backoff may start a new helper, repeat the health handshake, refresh topology,
and resume activation. If a helper disappears while baseline ownership is still
possible, recovery stops and surfaces a terminal error: a new helper must never
capture already modified output as baseline.

Renderer recovery is separately bounded per app and mini-panel surface for
`crashed`, `oom`, and `abnormal-exit` states. Only a surface that was visible is
recreated, and it hydrates from main-owned product state; three failures in one
minute open the circuit instead of forming a reload loop. The global
`Ctrl+Alt+Windows+R` shortcut remains main-process owned and requests preview
rollback plus automatic-activation baseline restoration without relying on a
renderer. Only a successful emergency restore then starts a detached
display-control follow-up to persist Paused while preserving intent. The direct
restore request completes without waiting for that follow-up, so later shortcut
presses can restore again even during a pending control transition. The follow-up
preserves any newer intended mode or target instead of overwriting it with the
snapshot taken before the direct restore. An emergency restore
that confirms restore-all while preview rollback is Safety blocked clears pending
tracking, waits for any in-flight Retry or Resume, then uses the existing Pause
path to suspend writes and confirm Original settings again before persisting
Paused. This restores any profile values applied by that intervening transition.
Other emergency restore behavior remains unchanged. An emergency restore failure
retains pending tracking and the critical log and error dialog.
Tray Exit and other
application quit requests share one shutdown coordinator. Before checking for
unsaved changes, main requests a renderer draft flush with a 750 ms timeout, so
recent edits need not wait for the preview debounce. Missing or unresponsive
renderers fall back to main-owned state. Before shutdown, a
main-process dialog warns when an Edit or Temporary override has unsaved changes,
even without a renderer. Update profile saves the complete main-owned draft
through the existing confirm path; Discard changes continues shutdown; Cancel
keeps the app running. Save failure also leaves the app alive. The coordinator waits for queued
activation work and requires `service.shutdown` to restore every connected display
before allowing Electron to exit. Explicit shutdown discards restoration records for
displays that are no longer connected, so ordinary monitor removal neither blocks Exit
nor surfaces an error; saved profile targets are unaffected. A genuine connected-display
restore failure reopens the product window and presents concise retry/cancel guidance
while technical details remain in Diagnostics.

Windows packages use ASAR for application code and a self-contained .NET publish
under `resources/display-service`. Packaged resolution uses only
`process.resourcesPath`; development resolution remains explicit and separate.
Profile JSON stays in Electron's per-user application-data directory and the NSIS
uninstaller is configured not to delete it. See `packaging.md` for commands,
layout checks, smoke coverage, and signing hooks.

Packaged Electron enables embedded ASAR integrity and ASAR-only application
loading while disabling Node startup environment/inspector escape hatches. Main
and native diagnostics are retained as bounded JSONL under user data. A typed,
sender-validated renderer request reads only the latest bounded file tail and
returns at most 250 validated entries; the renderer never receives a filesystem
path or direct file access. Development
launches derive a separate data directory from the canonical Git worktree root;
explicit smoke overrides and the stable production/migration directories keep
their existing precedence. Tag releases pass a serialized signed-build workflow
whose preflight makes package, lockfile, tag, x64 artifact, block map, and update
manifest versions agree before a draft release can be created.

The profile configuration path is pinned explicitly to
`%APPDATA%\ChromaShift\profiles.json` so package metadata changes cannot move it
again. When that file is absent, startup performs a non-overwriting one-time copy
from the legacy `%APPDATA%\@chromashift\desktop\profiles.json` path.
Explicit `--user-data-dir` launches remain isolated and never import legacy data.
