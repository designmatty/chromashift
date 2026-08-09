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

The Electron diagnostics shell does not invoke this domain layer yet. Connecting
foreground events and activation decisions to native display writes is
Milestone 2; tray behavior and polished controls remain later milestones.

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
