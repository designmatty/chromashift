# ChromaShift

ChromaShift is a Windows 11 display profile manager. Phase 0 and Milestones 1–4
are complete: the repository contains a functional Electron profile manager, a narrow
Electron-to-.NET protocol, event-driven foreground detection,
display/capability discovery, baseline-safe Windows, NVIDIA, and AMD provider
spikes, a tested TypeScript core for profiles and activation, tray controls,
restore-safe shutdown, and a Windows packaging foundation.

## Prerequisites

- Windows 11
- Node.js 24.11.1 and npm 11.6.2
- .NET SDK 10.0.302

The versions are pinned in `mise.toml`, but mise is optional. With mise:

```powershell
mise install
npm install
npm run dev
```

With Node and .NET installed directly, run `npm install` and `npm run dev`.
Electron 43 downloads its platform binary on the first development launch, so
that first `npm run dev` may take longer than later launches.

For a deterministic fresh-clone setup on Windows, run:

```powershell
.\script\setup.ps1
```

## Commands

```powershell
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
npm run verify
npm run native:run
npm run native:test:integration
npm run package:win
npm run smoke:package
```

See `docs/display-research.md` for the verified hardware matrix and constraints,
and `docs/core-domain.md` for the profile and activation contracts. AMD writes
are implemented against official ADLX but remain unverified because the test
machine has no AMD-driven display. Automatic foreground activation and manual
tray controls are connected through Electron main. The renderer now supports
profile CRUD, display and application assignments, capability-driven controls,
light/dark design tokens, and rollback-safe live preview.

## Current roadmap

Milestone 4 is complete:

1. Chakra UI foundation, semantic themes, error boundary, and accessible states — complete
2. centralized, sender-validated, bidirectionally validated product IPC — complete
3. profile create, edit, delete, duplicate, default, and manual activation — complete
4. display, foreground-application, and `.exe` assignment workflows — complete
5. capability/HDR-aware live preview with explicit save/cancel rollback — complete
6. tray mini panel, permanent Default profile, visible-app picker, and startup,
   close, and theme settings — complete

Milestone 5 is complete and covers power/display transitions, bounded renderer
and sidecar resilience, packaged-app security, diagnostics, and current-hardware
release readiness. Its implementation and automated coverage include:
transition/topology/baseline validation, hardened window persistence, helper
health and heartbeat restoration, fail-closed bounded sidecar recovery, bounded
renderer recreation, the global emergency restore shortcut, hardened Electron
fuses/CSP/navigation, persistent diagnostics, a bounded in-app diagnostics browser,
worktree-isolated development data, and package security smoke. Slice 5.4's
version/tag/artifact/update-manifest
preflight and serialized signed-release workflow are also implemented. Guarded
SDR/HDR/SDR plus active-Edit DisplayPort and HDMI disconnect/reconnect sequences
have passed on the G60SD. Disconnected profile targets remain persisted but stay
out of the editor, and explicit Exit restores connected outputs while discarding
unreachable session restoration records without an error.

Milestone 6 is complete. Packaging now excludes development artifacts and
redundant bundled dependencies, ships only the English Chromium locale, and
publishes DisplayService as a self-contained, partially trimmed single file. The
final x64 NSIS installer is 84.70 MiB, its unpacked layout is 285.43 MiB, and the
external helper is 14.01 MiB. Package and packaged runtime budgets guard
installer size, installed footprint, startup and panel latency, private memory,
renderer release, and idle CPU. Opening the mini panel also releases the hidden
app renderer after the handoff. Milestone 7 follows.
The broader suspend/resume,
lock/unlock, resolution/refresh, driver-reset, baseline-owning process-fault,
mixed-GPU/AMD/driver, signing-certificate, and installer-reputation matrix is
deferred to Milestone 8 — Extended hardware and release hardening.

Profiles now identify a physical panel independently of its connector. The
G60SD's simultaneous DP and HDMI paths remain separate native restoration
endpoints but render as one display, share one profile target, and receive the
same setting through endpoint fanout. A startup rewrite converts resolvable old
endpoint targets; unknown disconnected targets remain persisted and hidden.
Baseline-free native-service crashes are now covered by a real recovery smoke;
the app completes its bounded health/topology handshake and resumes without a
renderer restart. Potential baseline ownership still blocks unsafe recapture.

The repository will not be rebased onto a general Electron starter. See
`AGENTS.md` for the reviewed starter-template decision and the authoritative
slice definitions.

The renderer is organized by product feature under
`apps/desktop/src/renderer/features`. Chakra UI v3 owns accessible controls and
semantic tokens; product-specific Electron window layout remains plain CSS.
Tailwind, shadcn, and Base UI are not part of the current stack.

The measured UI-stack, Electron-memory, and Tauri decision record is in
[`docs/performance.md`](docs/performance.md). `npm run measure:memory` samples
the real Windows process tree, and the normal verification gate enforces the
renderer bundle budget. Electron remains the production shell, with Electron
Builder retained for packaging.
