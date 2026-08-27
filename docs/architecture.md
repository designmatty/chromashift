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

`@chromashift/core` owns the vendor-neutral product model introduced in Phase 1.
It validates versioned JSON configuration, matches foreground applications, and
resolves manual/foreground/default/baseline precedence without importing
Electron or the native client. A storage port leaves the app-data filesystem
adapter in Electron main. See `core-domain.md` for the exact contracts.

Electron main is split along one seam. `product-runtime.ts` owns the product
side: the native client, every domain controller, and all wiring between them,
including native event routing (`native-event-router.ts`) and activation
outcome routing (`activation-outcome-router.ts`). `index.ts` is Electron shell
only — windows, panels, IPC registration, app lifecycle — and supplies the
runtime's grouped ports (settings accessor, dialogs, icons, panel commands,
system registrations, notifications). The shell reaches product behavior
through the runtime's `productController`, `shutdownCoordinator`, and
`previewController` getters plus `start()` and `dispose()`; the runtime reaches
the shell only through its ports. The DisplayService connection enters through
a `createClient` factory port typed as the union of the consumer ports the
runtime feeds, so runtime startup wiring (start-mode selection, the
health/version handshake, fail-open lifecycle configuration) is covered by
fast in-process tests against `testing/fake-native-display.ts` — the one
shared fake for the native display seam that activation-coordinator and
preview-session tests also use. Product wiring changes belong in the runtime
and routers, not in `index.ts`.

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
failures are logged and returned as partial outcomes while remaining displays
continue; failed transitions reset deduplication so a later event can retry.
External restoration and native-service exit also reset activation state.

HDR is a quiescent activation state, not a failed profile transition. Electron
checks the current display snapshot before capture or apply, defers every target
on an HDR display, and suppresses duplicate foreground retries. The helper also
rejects capture and every provider write as defense in depth. If HDR becomes
active after ChromaShift captured an SDR baseline, that immutable baseline stays
owned and is not recaptured or released; restore-all reports `hdrActive`, and the
next validated HDR-off topology transition restores or reapplies it. Topology
resets invalidate target deduplication without discarding baseline ownership.

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
targets, foreground-application assignment, and an Electron `.exe` picker. Its
controls derive support and provider explanations from each selected display's
capability report; HDR-unsafe Windows gamma controls remain disabled. A separate
display view retains the hardware diagnostics needed for provider support.
Profile deletion uses Chakra's renderer-modal `Dialog` so closing an overflow
menu and removing its trigger cannot strand Windows keyboard focus outside the
app.

Live preview is an explicit activation session. It suspends automatic display
writes while still remembering foreground changes and applies only validated
settings from the native service's immutable baseline. Both renderer surfaces
drive their sessions through one shared seam: `use-preview-draft.ts` owns the
draft and dirty state, and the framework-free `preview-sync.ts` session owns
debounced draft synchronization, the start-versus-update decision, and
race-safe rollback that waits for in-flight writes before cancelling. Surface
flows (preview promotion, collapse-on-equal, explicit Preview toggling) stay in
`main-app.tsx` and `mini-panel.tsx` and call into that seam. Edit mode previews changes
as they are made; the separate Preview action is a user-controlled toggle. Cancel,
reset, navigation away from a dirty edit, or failure resets the activation resolver
and reapplies the exact previous manual/foreground/default/baseline target. There
is deliberately no countdown timer. Native apply restores baseline before each
complete settings request so removing an override cannot inherit a stale value.
Entering Edit from an unchanged explicit preview of the same profile promotes the
existing session in place: it retains the captured baseline and applied values and
performs no restore, capture, or display write. A changed draft or different profile
continues through the full restore-safe transition.

Tray left-click reopens the last-used panel. If that panel is already visible, the
full app is focused or the non-activating mini panel is raised to the popup-menu
window level above the hidden-icons drawer. Opening either panel hides the other, so
both product surfaces are never visible together. On Windows the mini panel remains a
pointer-oriented, non-activating Electron surface: opening or interacting with it
does not make ChromaShift the foreground application. The panel has an explicit
close button, closes when the full app opens, and can be dragged by its header. A user
position is persisted and clamped to a connected display; without one, the panel
opens next to the tray. Quick color changes remain temporary while the panel is
hidden and expose `Update profile` and `Reset changes`; profile selection establishes
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
Explicit launches still show the app panel. The permanent Default profile
remains the only catch-all, cannot be disabled or deleted, and cannot receive
application assignments.

Electron main owns native notifications and global shortcut registration, so
both remain available with no renderer alive. One user preference enables or
suppresses every native notification type. Shortcut replacement is atomic:
validation, reserved-key and duplicate checks, and operating-system registration
must all succeed before the new bindings are persisted, otherwise the last valid
set is restored. Profile bindings follow profile rename, disable, and deletion;
disabling a bound profile requires explicit confirmation that names the binding.
The fixed emergency-restore accelerator is reserved outside configurable
bindings and appears as a read-only Safety action in Shortcut settings.
Notification wording is derived from completed activation outcomes and
distinguishes full, partial, deferred, failed, paused, resumed, retry, restore,
and no-op results. Clicking a profile notification opens that profile in the app
panel.

Display control has three persisted states: Active, Paused, and Safety blocked.
Pause suspends new writes, waits for in-flight activation, restores every owned
baseline, and enters Paused only after full restoration. An incomplete restore
fails closed into Safety blocked. Resume re-resolves the latest foreground app
and applies the preserved intended mode and target. Explicit profile or Automatic
selection resumes a user pause; during a safety block it updates intent without
bypassing the required retry. Safety blocked persists whether the interrupted
operation was Pause or Resume so retry completes the correct operation. One-shot
Restore original settings leaves display control Active and preserves intent.

The system tray reads the same activation and display-control state, supports
manual profile overrides, returns to automatic mode, restores original settings,
and pauses, resumes, or retries display control. It exposes separate app- and
mini-panel commands while preserving last-used-panel left-click behavior.
Closing the window either releases its renderer to the tray or requests shutdown
according to settings. Opening the app recreates the renderer from main-owned
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
renderer.
Tray Exit and other
application quit requests share one shutdown coordinator, which waits for queued
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
from the pre-Milestone 3 `%APPDATA%\@chromashift\desktop\profiles.json` path.
Explicit `--user-data-dir` launches remain isolated and never import legacy data.

## Desktop foundation decision

ChromaShift retains this repository structure rather than rebasing onto the
reviewed `guasam/electron-react-app` starter. The starter is a reference for
selected patterns only:

- Electron Builder packaging conventions
- a React error boundary
- a semantic design-token system and accessible component primitives; the later
  product decision implements this with Chakra UI v3
- centralized Zod contracts for renderer-to-main IPC

Those patterns must be reimplemented inside the existing boundaries. The
starter's disabled sandbox, generic IPC abstraction, custom title bar, resource
protocol, dependency set, and lockfile are not adopted.

The later `designmatty/geoswap` review added repository-organization guidance:
feature-oriented renderer modules, one canonical verification command called by
Windows CI, and focused repository skills routed from `AGENTS.md`. ChromaShift
adopts those patterns without taking GeoSwap's web/extension frameworks,
source-only package model, database stack, or Bash-first scripts.

The roadmap deliberately sequences the borrowed patterns after automatic
activation:

```text
Milestone 2
  -> native activation surface
  -> main-process composition and persistence
  -> serialized activation coordinator
  -> transition recovery and verification

Milestone 3
  -> tray behavior
  -> restore-safe shutdown
  -> Windows packaging with DisplayService outside ASAR

Milestone 4
  -> minimal UI foundation
  -> validated renderer-to-main product API
  -> profile workflows and safe preview

Milestone 5
  -> operating-system and process resilience
  -> packaged-app security
  -> current-hardware and automated release readiness

Milestone 6
  -> performance and footprint optimization

Milestone 7
  -> notifications, shortcuts, and tray extensions

Milestone 8
  -> open-source readiness
  -> Azure Artifact Signing
  -> public repository and signed preview release
```

This order keeps product behavior and restoration reliability ahead of UI
polish while avoiding a late packaging rewrite around the native sidecar.
