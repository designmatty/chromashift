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

Milestone 5 is next and covers resilience, packaged-app security, diagnostics,
and the release hardware matrix.

The repository will not be rebased onto a general Electron starter. See
`AGENTS.md` for the reviewed starter-template decision and the authoritative
slice definitions.

The renderer is organized by product feature under
`apps/desktop/src/renderer/features`. Chakra UI v3 owns accessible controls and
semantic tokens; product-specific Electron window layout remains plain CSS.
Tailwind, shadcn, and Base UI are not part of the current stack.
