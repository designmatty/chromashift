# ChromaShift

ChromaShift is a Windows 11 display profile manager. It applies per-display color
settings when the foreground application changes and can also select profiles
manually from the app, mini panel, tray, or global shortcuts.

Before changing a display, ChromaShift captures its original state. Profile
transitions start from that captured state, and normal exit, pause, emergency
restore, and tested crash paths restore it.

## Hardware support

NVIDIA behavior has been verified on real hardware. The tested path covers
Windows gamma controls, NVIDIA saturation and hue, HDR deferral, display
reconnects, helper recovery, and exact restoration.

AMD support is implemented against AMD's official ADLX API but remains
hardware-unverified because no test display is connected to the AMD adapter.
Intel and unknown adapters are detected but do not have vendor color providers.
See [display research](docs/display-research.md) for the tested hardware and
known limits.

## What is included

- Per-application and manually selected profiles
- Independent optional settings for each physical display
- Brightness, contrast, gamma, saturation, hue, and AMD color temperature where
  the active provider reports support
- Automatic foreground-application matching and a permanent Default profile
- App panel, non-activating mini panel, system tray, notifications, and global
  shortcuts
- Pause, one-shot restore, emergency restore, preview rollback, and fail-closed
  recovery when baseline ownership is uncertain

ChromaShift uses normal Windows and GPU display APIs. It does not inject into
applications, inspect game memory, hook rendering, or install a driver.

## Build from source

Requirements:

- Windows 11
- Node.js 24.11.1 and npm 11.6.2
- .NET SDK 10.0.302

The versions are pinned in `mise.toml`, but mise is optional.

```powershell
mise install
npm install
npm run dev
```

With Node and .NET installed directly, omit `mise install`. For a deterministic
fresh-clone setup, run [`.\scripts\setup.ps1`](scripts/setup.ps1) from PowerShell.

## Verification and packaging

```powershell
npm run verify
npm run native:test:integration
npm run smoke:desktop
npm run package:win
npm run smoke:package
npm run measure:performance
```

`npm run verify` is the canonical non-interactive gate. Native integration,
desktop smoke, package smoke, and performance measurement need an interactive
Windows session and suitable hardware. See [testing](docs/testing.md) for the
scope and safety requirements of each command.

## Repository guide

- [Architecture](docs/architecture.md) explains the Electron, TypeScript, and
  .NET boundaries.
- [Core domain](docs/core-domain.md) defines profiles, matching, and activation.
- [Native protocol](docs/native-protocol.md) documents Electron-to-helper IPC.
- [Per-display settings](docs/per-display-profile-settings.md) records the current
  profile and UI contracts plus approved Figma references.
- [Physical display identity](docs/physical-display-identity.md) explains panel
  identity and endpoint fanout.
- [Packaging](docs/packaging.md), [performance](docs/performance.md), and
  [signing](docs/signing.md) cover the Windows release path.
- [Third-party dependencies](docs/third-party.md) records native licensing and
  replacement requirements.

## Project policy

The production app has no telemetry, analytics, or outbound network requests.
Read [Privacy](PRIVACY.md), [Security](SECURITY.md), and
[Contributing](CONTRIBUTING.md) for the public project policies.

ChromaShift is licensed under the [MIT License](LICENSE).
