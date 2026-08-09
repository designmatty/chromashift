# ChromaShift

ChromaShift is a Windows 11 display profile manager. Phase 0 and Milestones 1–3
are complete: the repository contains a diagnostics Electron shell, a narrow
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

## Commands

```powershell
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
npm run native:run
npm run package:win
npm run smoke:package
```

See `docs/display-research.md` for the verified hardware matrix and constraints,
and `docs/core-domain.md` for the profile and activation contracts. AMD writes
are implemented against official ADLX but remain unverified because the test
machine has no AMD-driven display. Automatic foreground activation and manual
tray controls are connected through Electron main. The diagnostics renderer is
still intentionally unpolished until Milestone 4.

## Current roadmap

Milestone 3 is complete:

1. tray read model, lifecycle, and close-to-tray behavior — complete
2. manual profiles, automatic mode, and baseline reset — complete
3. shared restore-safe shutdown with actionable failure recovery — complete
4. ASAR/NSIS packaging with the native service outside ASAR — complete

Milestone 4 is next and introduces the functional profile UI, centralized
validated renderer-to-main contracts, and only the Tailwind/shadcn/Radix
components actually needed. Milestone 5 covers resilience, packaged-app
security, and the release hardware matrix.

The repository will not be rebased onto a general Electron starter. See
`AGENTS.md` for the reviewed starter-template decision and the authoritative
slice definitions.
