# Architecture

```text
React profile renderer
  -> sandboxed preload
  -> Electron main
       -> @chromashift/core (profiles, matching, activation, persistence)
  -> typed NativeClient
  -> NDJSON over child stdin/stdout
  -> DisplayService.exe
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

Electron main now composes that domain layer with the native client. It stores
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

The renderer uses centralized Zod request and response contracts shared by
renderer, preload, and main. Preload exposes capability-oriented methods rather
than a generic IPC invoke. Main validates the sender and input for every
privileged request, validates its response before returning it, and maps native,
persistence, validation, and unsupported-capability failures into explicit
user-facing results.

The renderer uses Chakra UI v3 for accessible primitives and semantic theme
tokens. `src.tsx` is bootstrap-only; app composition, Profiles, Displays,
Settings, and the mini panel live in focused modules under `app/`, `features/`,
`components/`, and `hooks/`. Product-specific Electron window and mini-panel
layout remains application-owned plain CSS. Tailwind, shadcn, and Base UI were
removed before the per-display UI redesign so the renderer has one styling
system. The app panel and mini panel are separate lazy renderer entries. React
Router remains deferred because the three app-panel views do not need URL
navigation.

The upcoming app-panel redesign may extend React content into the title-bar area
with Electron's hidden title bar and native `titleBarOverlay`. Windows continues
to own caption controls and Snap behavior; the renderer owns only the reserved
header layout plus explicit drag/no-drag regions. A fully frameless window with
replacement caption buttons remains out of scope.

The profile workspace supports CRUD, default/manual activation, multi-display
targets, foreground-application assignment, and an Electron `.exe` picker. Its
controls derive support and provider explanations from each selected display's
capability report; HDR-unsafe Windows gamma controls remain disabled. A separate
display view retains the hardware diagnostics needed for provider support.

Live preview is an explicit activation session. It suspends automatic display
writes while still remembering foreground changes and applies only validated
settings from the native service's immutable baseline. Edit mode previews changes
as they are made; the separate Preview action is a user-controlled toggle. Cancel,
reset, navigation away from a dirty edit, or failure resets the activation resolver
and reapplies the exact previous manual/foreground/default/baseline target. There
is deliberately no countdown timer. Native apply restores baseline before each
complete settings request so removing an override cannot inherit a stale value.

Tray left-click opens a dedicated borderless mini-panel window. On Windows it is a
pointer-oriented, non-activating Electron surface: opening or interacting with it
does not make ChromaShift the foreground application. It is raised at the popup-menu
window level so it remains above the hidden-icons drawer. The panel has an explicit
close button, closes when the full app opens, and can be dragged by its header. A user
position is persisted and clamped to a connected display; without one, the panel
opens next to the tray. Quick color changes remain temporary while the panel is
hidden and expose `Update profile` and `Reset changes`; profile selection establishes
a manual override until the user returns to Auto switch. Mini-panel footer actions
open the corresponding Profiles, Displays, or Settings view in the
native-caption-controlled app panel.

App settings are validated and atomically persisted separately from profiles.
They control login launch, login-only tray/app startup behavior, close-to-tray
versus restore-safe shutdown, and System/Light/Dark rendering. Explicit launches
still show the app panel. The permanent Default profile remains the only catch-all,
cannot be disabled or deleted, and cannot receive application assignments.

The system tray reads the same activation state, supports
manual profile overrides, returns to automatic mode, and can restore baseline.
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
Tray Exit and other
application quit requests share one shutdown coordinator, which waits for queued
activation work and requires `service.shutdown` to confirm restoration before
allowing Electron to exit. A restore failure reopens the product window and keeps the
application and helper alive so Exit can be retried.

Windows packages use ASAR for application code and a self-contained .NET publish
under `resources/display-service`. Packaged resolution uses only
`process.resourcesPath`; development resolution remains explicit and separate.
Profile JSON stays in Electron's per-user application-data directory and the NSIS
uninstaller is configured not to delete it. See `packaging.md` for commands,
layout checks, smoke coverage, and signing hooks.

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
  -> hardware matrix and release readiness
```

This order keeps product behavior and restoration reliability ahead of UI
polish while avoiding a late packaging rewrite around the native sidecar.
