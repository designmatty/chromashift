# Phase 0 architecture

```text
React diagnostics renderer
  -> sandboxed preload
  -> Electron main
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

Phase 0 intentionally contains only a diagnostics shell. Profiles, persistence,
matching, activation precedence, tray behavior, and polished controls remain in
later milestones.
