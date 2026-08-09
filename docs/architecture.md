# Architecture

```text
React diagnostics renderer
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
only a narrow context-bridged diagnostics API. Native handles, vendor structures,
profile matching, and persistence never cross layers accidentally.

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

The diagnostics shell surfaces whether automation was enabled and the exact
configuration path. Tray behavior and polished controls remain later milestones.

## Desktop foundation decision

ChromaShift retains this repository structure rather than rebasing onto the
reviewed `guasam/electron-react-app` starter. The starter is a reference for
selected patterns only:

- Electron Builder packaging conventions
- a React error boundary
- Tailwind design tokens and selectively added shadcn/Radix controls
- centralized Zod contracts for renderer-to-main IPC

Those patterns must be reimplemented inside the existing boundaries. The
starter's disabled sandbox, generic IPC abstraction, custom title bar, resource
protocol, dependency set, and lockfile are not adopted.

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
