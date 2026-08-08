# ChromaShift

ChromaShift is a Windows 11 display profile manager. Phase 0 is complete: the
repository contains a diagnostics Electron shell, a narrow Electron-to-.NET
protocol, event-driven foreground detection, display/capability discovery, and
baseline-safe Windows, NVIDIA, and AMD provider spikes.

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

See `docs/display-research.md` for the verified hardware matrix and constraints.
AMD writes are implemented against official ADLX but remain unverified because
the test machine has no AMD-driven display. No polished profile UI is included.
