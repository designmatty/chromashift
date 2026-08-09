# ChromaShift

ChromaShift is a Windows 11 display profile manager. Phase 0 and Milestone 1 are
complete: the repository contains a diagnostics Electron shell, a narrow
Electron-to-.NET protocol, event-driven foreground detection,
display/capability discovery, baseline-safe Windows, NVIDIA, and AMD provider
spikes, plus a tested TypeScript core for profiles, persistence, application
matching, and activation precedence.

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

## Commands

```powershell
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
npm run native:run
```

See `docs/display-research.md` for the verified hardware matrix and constraints,
and `docs/core-domain.md` for the profile and activation contracts. AMD writes
are implemented against official ADLX but remain unverified because the test
machine has no AMD-driven display. The core is not connected to automatic native
activation yet, and no polished profile UI is included.

## Current roadmap

Milestone 2 is next and is split into four implementation slices:

1. typed native activation commands
2. Electron main-process composition and app-data persistence
3. a serialized foreground-activation coordinator
4. recovery, transition testing, and activation diagnostics

Milestone 3 adds the tray and a Windows packaging foundation. Packaging will use
an adapted Electron Builder configuration and place `DisplayService.exe` plus its
runtime files outside ASAR. Milestone 4 then introduces the functional profile
UI, a shared validated renderer-to-main API, and only the Tailwind/shadcn/Radix
components actually needed. Milestone 5 covers resilience, packaged-app
security, and the release hardware matrix.

The repository will not be rebased onto a general Electron starter. See
`AGENTS.md` for the reviewed starter-template decision and the authoritative
slice definitions.
