# AGENTS.md

# Instruction routing

This file is the canonical repository-level instruction source. Load the
matching focused skill when working in these areas:

- `.agents/skills/chromashift-desktop-ui/SKILL.md` for renderer, Chakra UI,
  theme, app-panel, or mini-panel work
- `.agents/skills/chromashift-display-safety/SKILL.md` for native display
  providers, baselines, HDR, topology, or foreground-window behavior
- `.agents/skills/chromashift-profile-model/SKILL.md` for profiles,
  persistence migrations, matching, activation, or preview semantics
- `.agents/skills/chromashift-packaging-release/SKILL.md` for packaging,
  restore-safe shutdown, release automation, or installer validation

Read `docs/architecture.md` and the task-relevant focused skill before changing
one of those surfaces. Keep durable product and architecture decisions here;
keep procedural detail in the focused skills and docs rather than duplicating it.

## Agent skills

### Issue tracker

Issues are tracked in GitHub for `designmatty/chromashift`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five default label roles. See
`docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the single-context layout. See
`docs/agents/domain.md`.

# Windows Display Profile Manager

## Objective

Build a Windows 11 desktop application for creating display color profiles and automatically activating them based on the foreground application.

The application should replace the manual workflow of opening NVIDIA Control Panel or AMD Software and adjusting display color settings for different games and applications.

Example:

```text
Desktop / browser
→ Default

Path of Exile 2
→ Gaming

Escape from Tarkov
→ High Visibility

Photoshop
→ Color Accurate
```

Profiles should also be manually selectable from the system tray.

The application must support both:

- NVIDIA GPUs
- AMD GPUs

The architecture must remain vendor-neutral so Intel or additional display-control backends can be added later.

---

# Product philosophy

Prioritize:

1. Reliability
2. Safe restoration of display state
3. Fast application switching
4. Low idle resource usage
5. Vendor-neutral profiles
6. Clean separation between product logic and native APIs
7. Small, testable implementation slices

Do not:

- inject into games
- hook DirectX
- modify game memory
- install kernel drivers
- interfere with anti-cheat
- tightly couple application logic to NVIDIA or AMD APIs
- build speculative future functionality before the MVP works

---

# Technology stack

## Desktop application

Use:

- Electron
- React
- TypeScript
- Vite / electron-vite
- npm

Recommended supporting libraries:

- Zustand for application state
- Zod for runtime schema/config validation
- Vitest for TypeScript tests
- Electron Builder for Windows packaging when the packaging slice begins

Avoid adding dependencies unless they provide clear value.

Use Chakra UI v3 for renderer components, semantic design tokens, and accessible
control composition. ChromaShift migrated away from Tailwind, shadcn, and Base
UI on 2026-08-11 before the per-display UI redesign. Keep product-specific
window and layout styling as plain application-owned CSS where Chakra primitives
do not express it cleanly. Do not reintroduce a second styling system. The
measured Chakra, Base UI, Radix, shadcn, and Astryx comparison and the criteria
for revisiting this decision live in `docs/performance.md`.

Keep idle renderer lifetime deliberate: closing the app panel releases its
BrowserWindow renderer, and a hidden mini panel is released after a short grace
period. Keep hardware acceleration disabled while the renderer has no GPU-heavy
surface; re-enable it only with a measured interaction requirement and repeat
the desktop memory and visual smoke tests. Enforce the renderer bundle budget
and use the restore-safe memory measurement rather than Task Manager snapshots.

Electron remains ChromaShift's production desktop shell. A functional Tauri 2
port was measured on 2026-08-11 at commit
`c0956613cc6932b8699bb93622fb97608734e1ab`; its renderer-free tray and installer
were substantially smaller, but its visible app and mini-panel states were
heavier on the test host and it duplicated the mature TypeScript product core in
Rust. Keep the port as comparison evidence rather than a migration path. Revisit
the shell only if a future measured constraint outweighs the migration, parity,
and Windows-window-semantics cost recorded in `docs/performance.md`.

Do not add React Router unless navigation complexity actually warrants it.

Do not add TanStack Query unless asynchronous application state becomes complex enough to justify it.

Do not add Framer Motion or another animation library until a concrete product
interaction warrants its runtime and maintenance cost.

Do not use pnpm, Yarn, Bun, or another JavaScript package manager unless explicitly requested.

Use `package-lock.json` and commit it.

Use standard npm workspaces for the monorepo.

---

# Starter-template decision

The `guasam/electron-react-app` repository was reviewed at commit
`b8d299327e7724e164a82d01c2af2ca07d57d171` on 2026-08-08.

Decision:

> Keep the existing ChromaShift repository and architecture. Treat the starter
> as a reference and selectively port useful patterns; do not rebase, fork, or
> restructure ChromaShift around it.

ChromaShift already has the more important foundations:

- npm workspaces
- explicit Electron main/preload/renderer boundaries
- a sandboxed renderer with a narrow preload API
- a typed native client and versioned NDJSON protocol
- a separate C# `DisplayService`
- baseline capture and safe restoration
- vendor-neutral domain packages and tests

Patterns adapted from the starter before the Chakra decision:

- Electron Builder configuration for Windows NSIS packaging, icons, ASAR, and
  artifact naming
- a React error boundary
- a centralized Zod schema registry for renderer-to-main IPC
- useful import aliases and formatting conventions

The `designmatty/geoswap` repository was reviewed at commit
`04381215673d5409f774da3f94df855798739586` on 2026-08-11. ChromaShift adopts
its feature-oriented renderer organization, canonical verification/CI concept,
focused repository skills, and semantic-theme approach. It does not adopt
GeoSwap's web/extension frameworks, source-only package model, database stack,
or Bash-first workflow. Chakra UI is intentionally adopted; React Router,
TanStack Form, React Compiler, WXT, and Cloudflare remain unneeded.

The `pingdotgg/t3code` repository was reviewed at commit
`560d4a4560ddb5f42c8f8e0e35fa7827c0e46f80` on 2026-08-11. ChromaShift keeps
Electron and Electron Builder and selectively adopts its native title-bar
overlay, bounded renderer recovery, persisted window geometry, testable power
lifecycle adapter, pure responsive-layout contracts, worktree-local development
data, and release-invariant checks. Sidecar restart supervision is deferred
until its interaction with captured display baselines is explicitly safe. Do not
adopt T3 Code's Tailwind/Base UI/Effect stack, custom resource protocol,
`webviewTag`, disabled background throttling, persistent resource monitor, pnpm,
or Vite+ migration.

Do not copy these starter defaults:

- disabled Electron renderer sandboxing or `ELECTRON_DISABLE_SANDBOX`
- its Conveyor IPC implementation as a replacement for ChromaShift's native
  protocol or preload API
- a fully frameless app panel or renderer-drawn replacement caption controls;
  the approved redesign may use `titleBarStyle: "hidden"` with Electron's native
  `titleBarOverlay` so Windows retains minimize, maximize, close, and Snap behavior
- a custom resource protocol without a concrete requirement and containment
  tests
- React Router, TanStack Query, Framer Motion, or other unused dependencies
- the starter's package versions or lockfile without a fresh compatibility and
  security review

When implementing borrowed ideas:

1. Reimplement the smallest useful pattern inside the existing workspace.
2. Preserve ChromaShift's responsibility and security boundaries.
3. Pin current, compatible dependencies and update `package-lock.json` through
   npm.
4. Run build, typecheck, tests, lint, and a dependency audit appropriate to the
   changed package.
5. Retain required MIT copyright and license notices if substantial source is
   copied.

---

# Toolchain management

Use **mise** when toolchain version management is useful, particularly for keeping local development and AI-agent environments reproducible.

Mise may manage tools such as:

- Node.js
- .NET SDK
- potentially other project-level CLI tools

Do not introduce mise merely to wrap tools that npm already handles well.

Prefer:

```text
mise
→ runtime/toolchain versions

npm
→ JavaScript dependencies, workspaces, and scripts
```

A root `mise.toml` may look conceptually like:

```toml
[tools]
node = "lts"
dotnet = "10"
```

Pin concrete versions once the repository has established which versions are verified.

Do not unnecessarily require globally installed npm packages.

Prefer project-local dependencies invoked through npm scripts or `npx`.

---

# Standard commands

The repository should provide simple root-level npm commands wherever practical.

Target commands:

```bash
npm install
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
```

Native-service-specific commands may also be exposed:

```bash
npm run native:build
npm run native:test
npm run native:run
```

Where practical, npm scripts should orchestrate the C# service so contributors do not need to remember separate commands.

For example:

```json
{
  "scripts": {
    "native:build": "dotnet build native/DisplayService",
    "native:test": "dotnet test native/DisplayService"
  }
}
```

Exact commands can evolve as the repository is scaffolded.

If mise is present, a new environment should ideally require little more than:

```bash
mise install
npm install
```

before normal development commands work.

---

# Native Windows service

Use:

- C#
- .NET
- Windows APIs / P/Invoke
- NVIDIA NVAPI
- AMD ADLX

The native implementation should live in a separate process:

```text
DisplayService.exe
```

Do not implement native GPU/display functionality as a Node native addon unless there is a compelling reason discovered during implementation.

The helper-process architecture is intentional.

---

# High-level architecture

```text
┌──────────────────────────────────────┐
│ Electron                             │
│                                      │
│ React Renderer                       │
│       ↓                              │
│ Preload API                          │
│       ↓                              │
│ Electron Main                        │
│       ↓                              │
│ NativeClient                         │
└──────────────┬───────────────────────┘
               │
          JSON IPC
               │
┌──────────────▼───────────────────────┐
│ DisplayService.exe                  │
│                                     │
│ C# / .NET                           │
│                                     │
│ Display Registry                    │
│ Capability Resolver                 │
│ Baseline Manager                    │
│ Foreground Window Watcher           │
│                                     │
│ Windows Provider                    │
│ NVIDIA Provider                     │
│ AMD Provider                        │
└─────────────────────────────────────┘
```

The Electron application owns product behavior.

The native service owns operating-system and GPU interaction.

---

# Responsibility boundaries

## TypeScript owns

Keep these features outside the native service:

- profiles
- profile persistence
- application assignments
- profile matching
- activation precedence
- manual overrides
- automatic switching state
- profile editor behavior
- settings
- tray menu behavior
- application picker
- display configuration UI
- onboarding
- user-facing error handling
- most logging orchestration
- configuration migrations

The majority of the application should remain TypeScript.

---

## C# owns

The native service should handle only functionality that requires Windows or GPU APIs:

- foreground-window event hooks
- resolving foreground process information
- display enumeration
- stable display identity
- GPU/display association
- HDR detection
- reading gamma ramps
- setting gamma ramps
- restoring gamma ramps
- NVIDIA NVAPI access
- AMD ADLX access
- native capability discovery
- native state capture
- native state restoration
- display topology events

Keep this API surface deliberately small.

---

# Repository structure

Start with:

```text
/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   ├── preload/
│       │   └── renderer/
│       │
│       ├── electron.vite.config.ts
│       └── package.json
│
├── packages/
│   ├── core/
│   │   ├── profiles/
│   │   ├── rules/
│   │   ├── matching/
│   │   ├── activation/
│   │   └── color/
│   │
│   ├── native-client/
│   │   ├── client.ts
│   │   ├── protocol.ts
│   │   └── schemas.ts
│   │
│   └── shared/
│       └── types/
│
├── native/
│   └── DisplayService/
│       ├── Core/
│       ├── Providers/
│       │   ├── Windows/
│       │   ├── Nvidia/
│       │   └── Amd/
│       ├── Services/
│       ├── Ipc/
│       └── Program.cs
│
├── docs/
│   ├── architecture.md
│   ├── native-protocol.md
│   ├── display-research.md
│   └── testing.md
│
├── AGENTS.md
├── package.json
├── package-lock.json
└── mise.toml
```

The root `package.json` should use npm workspaces.

Conceptually:

```json
{
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```

This structure may evolve, but preserve the major responsibility boundaries.

---

# Core product terminology

Do not expose vendor-specific terminology as the primary profile model.

For example, NVIDIA calls saturation adjustment:

```text
Digital Vibrance
```

AMD exposes:

```text
Saturation
```

The product model should use:

```text
Saturation
```

The native provider translates that intent into the appropriate vendor API.

---

# Profile model

Profiles should be vendor-neutral.

Conceptually:

```ts
export interface ProfileDisplayTarget {
  displayId: string

  color: {
    brightness?: number
    contrast?: number
    gamma?: number
    saturation?: number
    hue?: number
    colorTemperature?: number
  }

  lastColorValues?: ColorSettings
}

export interface ColorProfile {
  id: string
  name: string
  enabled: boolean

  applications: ApplicationRule[]

  displays: ProfileDisplayTarget[]
}
```

Color settings belong to a display target, so two displays in one profile can hold
different values. Each setting must be optional.

Important:

```ts
gamma: undefined
```

means:

> This profile does not override gamma.

It does not mean:

```ts
gamma: 1
```

The same rule applies to every setting.

---

# Normalized values

Application profiles should not persist raw NVIDIA or AMD hardware values.

Use normalized product-level values.

Example:

```text
Saturation: 75
```

means:

```text
75% of the supported product range
```

The native provider converts that value into the appropriate vendor-specific range.

Never hardcode assumptions about NVIDIA or AMD ranges.

Always query supported ranges when the native API allows it.

---

# Displays

Each physical/logical display should be represented independently.

Conceptually:

```ts
interface Display {
  id: string

  name: string

  adapter: {
    vendor: 'nvidia' | 'amd' | 'intel' | 'unknown'
    name: string
  }

  connection?: string

  primary: boolean

  hdr: boolean

  capabilities: DisplayCapabilities
}
```

Do not treat the machine as having one global GPU vendor.

Mixed GPU configurations must be architecturally valid.

Examples:

```text
Display 1
→ AMD integrated GPU

Display 2
→ NVIDIA discrete GPU
```

or:

```text
Display 1 → AMD
Display 2 → AMD
Display 3 → NVIDIA
```

---

# Stable display identity

Do not persist display indices such as:

```text
Display 0
Display 1
```

as identity.

Display IDs should survive where possible:

- reboot
- monitor reordering
- primary monitor changes
- DisplayPort reconnect
- HDMI reconnect
- sleep/wake

Use the strongest available identity information, potentially including:

- Windows display device identifiers
- EDID
- manufacturer
- model
- serial number
- GPU/output association
- vendor display IDs

The UI may show:

```text
LG 32GQ950
DisplayPort
NVIDIA GeForce RTX 5080
Primary
```

while persistence uses an internal stable identifier.

---

# Capabilities

Never assume every display supports every setting.

Each display should expose capabilities.

Conceptually:

```ts
interface Capability {
  supported: boolean

  provider: 'windows' | 'nvidia' | 'amd' | 'intel' | 'unknown'

  min?: number
  max?: number
  default?: number
}

interface DisplayCapabilities {
  brightness: Capability
  contrast: Capability
  gamma: Capability
  saturation: Capability
  hue: Capability
  colorTemperature: Capability
}
```

The UI should be capability-driven.

Unsupported controls should not silently fail.

---

# Native capability resolution

The native service should resolve the best available implementation independently for each capability.

Do not require one provider to own the entire display.

A display may resolve like:

```text
NVIDIA Display

Brightness
→ Windows gamma provider

Contrast
→ Windows gamma provider

Gamma
→ Windows gamma provider

Saturation
→ NVIDIA NVAPI

Hue
→ NVIDIA NVAPI
```

while AMD may resolve like:

```text
AMD Display

Brightness
→ AMD ADLX

Contrast
→ AMD ADLX

Gamma
→ AMD ADLX

Saturation
→ AMD ADLX

Hue
→ AMD ADLX

Color Temperature
→ AMD ADLX
```

The exact mappings must be verified during the feasibility phase.

Do not force symmetry between vendors.

---

# Provider design

Avoid:

```csharp
if (vendor == Nvidia)
{
   ...
}
else if (vendor == Amd)
{
   ...
}
```

throughout the codebase.

Use capability providers.

Conceptually:

```csharp
public interface IDisplayCapabilityProvider
{
    bool CanHandle(
        DisplayDescriptor display,
        DisplayCapability capability);

    CapabilityDescriptor GetCapability(
        DisplayDescriptor display,
        DisplayCapability capability);

    object Read(
        DisplayDescriptor display,
        DisplayCapability capability);

    ApplyResult Apply(
        DisplayDescriptor display,
        DisplayCapability capability,
        object value);
}
```

Exact interfaces may differ.

Optimize for clarity rather than over-abstraction.

---

# Baseline

The concept of a baseline is essential.

Baseline means:

> The display state that existed before this application modified it.

When the native service starts controlling a display, capture the relevant current state.

Examples:

- RGB gamma ramp
- NVIDIA Digital Vibrance
- NVIDIA hue
- AMD brightness
- AMD contrast
- AMD gamma
- AMD saturation
- AMD hue
- AMD color temperature

Profiles should be applied relative to baseline.

Do not compound profile transforms.

Wrong:

```text
Baseline
→ Game A
→ modify Game A into Game B
→ modify Game B into Desktop
```

Correct:

```text
Baseline
→ Game A

Baseline
→ Game B

Baseline
→ Desktop
```

---

# Restoration

Restoration is a first-class product feature.

The native service must be capable of restoring captured baseline state.

Normal exit:

```text
Electron closing
→ request restore
→ native service restores
→ native service confirms
→ application terminates
```

Also design for:

```text
Electron crash
→ native helper detects lost heartbeat
→ native helper restores baseline
→ helper exits safely
```

Heartbeat/watchdog behavior does not have to ship in the first proof of concept, but the architecture should support it.

The shipped Windows lifecycle now detaches `DisplayService` from Electron's
terminating process group and passes the Electron PID. Direct parent-process exit
monitoring restores captured baselines after tested abrupt Electron termination.
Retain stdin EOF as a secondary signal. This is not a substitute for later
heartbeat coverage of a hung parent or recovery from helper/OS termination.

---

# Foreground application detection

Use Windows event APIs rather than high-frequency polling.

Prefer:

```text
SetWinEventHook
EVENT_SYSTEM_FOREGROUND
```

When focus changes, resolve:

- HWND
- PID
- executable filename
- executable path where available
- window title
- monitor

Send a vendor-neutral event to Electron.

Example:

```json
{
  "event": "foregroundApplicationChanged",
  "application": {
    "pid": 12345,
    "executable": "PathOfExileSteam.exe",
    "path": "C:\\Games\\Path of Exile 2\\PathOfExileSteam.exe",
    "title": "Path of Exile 2"
  }
}
```

Do not implement profile matching inside the native helper.

---

# Profile matching

TypeScript should resolve which profile should be active.

Initial precedence:

```text
Manual override
    >
Foreground application profile
    >
Default profile
    >
Baseline
```

If the desired profile is already active, do nothing.

Avoid unnecessary display writes.

---

# Application rules

For MVP, application profiles activate based on foreground application.

Store:

- executable path
- executable filename

Prefer full executable path when available.

Allow multiple applications per profile.

Example:

```text
Gaming

PathOfExile.exe
PathOfExileSteam.exe
PathOfExile2.exe
```

Potential future triggers:

- application running
- fullscreen
- borderless fullscreen
- window title
- schedule
- HDR state
- display connected
- keyboard shortcut

Do not implement them yet.

---

# Native IPC

Electron communicates with `DisplayService.exe` through a simple structured protocol.

Prefer newline-delimited JSON over stdin/stdout for the initial implementation unless another IPC mechanism clearly proves better.

Example request:

```json
{
  "id": "42",
  "command": "display.apply",
  "params": {
    "displayId": "abc",
    "settings": {
      "gamma": 1.15,
      "contrast": 55,
      "saturation": 75
    }
  }
}
```

Response:

```json
{
  "id": "42",
  "ok": true,
  "result": {}
}
```

Error:

```json
{
  "id": "42",
  "ok": false,
  "error": {
    "code": "CAPABILITY_UNSUPPORTED",
    "message": "Saturation is not supported by this display."
  }
}
```

Events do not need request IDs:

```json
{
  "event": "foregroundApplicationChanged",
  "data": {}
}
```

---

# Initial native commands

Keep the native API small.

Initial commands should approximately cover:

```text
system.info

displays.list

display.capabilities
display.state
display.apply
display.restore

baseline.capture
baseline.restore
baseline.restoreAll

foreground.current
```

The exact naming may change.

Do not expose NVAPI or ADLX concepts directly through IPC.

---

# Renderer security

Do not expose Node directly to the renderer.

Use:

```text
Renderer
↓
Preload
↓
IPC
↓
Main
```

Expose a narrow typed API.

Example:

```ts
window.displayProfiles.getDisplays()

window.displayProfiles.getProfiles()

window.displayProfiles.activateProfile(profileId)

window.displayProfiles.restoreBaseline()
```

Keep `contextIsolation` enabled.

Do not enable unrestricted Node integration in renderer windows.

Keep renderer process sandboxing enabled in development and production. Do not
set `sandbox: false` or use `ELECTRON_DISABLE_SANDBOX` to simplify preload code.

Validate the sender and expected origin of privileged renderer-to-main IPC
messages. Validate request arguments and returned data at runtime with shared
Zod schemas as the renderer API grows.

Use a restrictive Content Security Policy. Deny unexpected navigation and new
windows. Pass only explicitly allowlisted `https:` URLs to
`shell.openExternal`; never expose a generic renderer-controlled URL opener.

Prefer the native Windows frame. A custom title bar requires a separate,
explicit product decision with accessibility, keyboard, DPI, snap-layout, and
window-state testing.

---

# Persistence

Start with JSON.

Persist configuration under the user's application data directory.

Example:

```json
{
  "schemaVersion": 1,
  "profiles": [],
  "settings": {}
}
```

Use Zod to validate persisted configuration.

Version the configuration format from day one.

Add explicit migrations when schema changes occur.

Do not introduce SQLite for MVP.

---

# System tray

The application should remain useful with its main window closed.

Target tray behavior:

```text
ChromaShift: Active
Current: Gaming

Automatic

Profiles
  Default
  Gaming
  High Visibility
  Color Accurate

────────────

Restore original settings
Pause ChromaShift

────────────

Open app panel
Open mini panel

────────────

Exit
```

Manual profile selection should override automation.

The user needs an obvious way to return to:

```text
Automatic
```

---

# Main UI

The UI should initially focus on three areas:

## Profiles

```text
Profiles

Default
Gaming
High Visibility
Color Accurate

+ New Profile
```

Show:

- profile name
- assigned applications
- assigned displays
- active state

The switch beside the profile name represents whether that profile is the
current activation target; it does not edit `profile.enabled`. Switching it on
creates a manual override and turns Auto switch off. Switching an active
application profile off immediately returns to Auto switch, so a profile target
is always selected. When Default is active, its activation switch stays on and
cannot be deselected. Turning a profile itself on or off is a separate action
available from both profile overflow menus.

---

## Profile editor

Controls may include:

- Brightness
- Contrast
- Gamma
- Saturation
- Hue
- Color temperature

Only show/enable settings supported by the selected display.

Allow assigning:

- one display
- multiple displays

Allow assigning:

- one application
- multiple applications

Changes should be previewable.

Canceling a preview must restore the previous display state.

---

## Displays

Provide a display diagnostics view.

Example:

```text
LG 32GQ950

Adapter
NVIDIA GeForce RTX 5080

HDR
Off

Capabilities

Brightness       Windows
Contrast         Windows
Gamma            Windows
Saturation       NVIDIA
Hue              NVIDIA
Color Temperature Unsupported
```

This view will be extremely useful for debugging hardware-specific issues.

---

# Application picker

Support:

1. browsing for an `.exe`
2. selecting a currently running application

Show:

- application icon
- friendly name
- executable filename
- path

Do not require the user to manually type executable paths.

---

# HDR

HDR must be explicitly detected.

Never blindly apply SDR gamma-ramp behavior while HDR is active.

For initial implementation:

```text
Detect HDR
→ determine capability behavior
→ disable unsafe/unsupported controls
→ surface reason in UI
```

Provider capability results may change when HDR changes.

Treat HDR state changes as display-capability changes.

---

# Display topology changes

Eventually handle:

- monitor connect
- monitor disconnect
- monitor sleep
- monitor wake
- resolution change
- refresh-rate change
- primary display change
- GPU driver reset
- HDR toggled
- adapter/display topology change

When topology changes:

1. invalidate native handles
2. re-enumerate
3. resolve stable display identities
4. re-query capabilities
5. determine whether baseline remains valid
6. reapply the intended active state where safe

Never blindly reuse stale native handles.

---

# Error handling

Native failures must not crash Electron.

Native failures should preferably not crash `DisplayService` either.

Represent failures explicitly.

Example:

```text
Gamma
Applied

Saturation
Unsupported

Hue
Failed: NVAPI display handle unavailable
```

Log enough information to diagnose failures.

Never swallow native errors silently.

---

# Logging

Implement structured logging early.

Useful events include:

```text
ApplicationStarted

NativeServiceStarted
NativeServiceExited

DisplayDetected
DisplayRemoved
DisplayCapabilityResolved

BaselineCaptured
BaselineRestored

ForegroundApplicationChanged

ProfileMatched
ProfileActivated
ProfileDeactivated

DisplaySettingApplied
DisplaySettingFailed

DisplayTopologyChanged

HdrChanged

ProviderError

ApplicationExiting
```

The logs should make it possible to answer:

> Why did this profile activate?

and:

> Why didn't this setting apply?

---

# Safety requirements

## Emergency restore

Provide a global emergency shortcut that restores baseline.

Exact shortcut can be decided later.

It must be possible to trigger without interacting with the main UI.

---

## Clamp settings

Never send malformed or dangerous values into native APIs.

Validate:

```text
TypeScript
→ IPC schema
→ C# command validation
→ provider validation
```

before writing native state.

---

## Preview rollback

Preview is explicitly controlled by the user. Do not show a countdown or discard
changes on a timer. Canceling Edit, stopping Preview, changing away from a dirty
profile, or resetting a mini-panel override must restore the exact pre-preview
automatic/manual state. Save keeps the edited result; an explicit Preview button
acts as a toggle.

---

# Anti-cheat compatibility

Never:

- inject DLLs
- inspect game memory
- modify game processes
- hook game rendering
- install kernel components
- communicate with anti-cheat software

Foreground application detection happens using normal Windows APIs.

Color changes happen through Windows/GPU display APIs.

---

# Performance

This should behave like a lightweight utility.

Avoid:

- continuous high-frequency polling
- unnecessary GPU queries
- constant renderer activity
- repeated writes of identical display state
- unnecessary native service traffic

Prefer event-driven behavior.

Foreground application switching should feel immediate.

---

# Phase 0 — Feasibility spike

Do this before building the real UI.

The goal is to answer:

> Can we reliably read, modify, and restore the display controls we need?

Build a developer-oriented CLI/minimal Electron shell and `DisplayService`.

---

## Phase 0.1 — Repository/toolchain setup

Create the npm workspace and toolchain configuration first.

Requirements:

- root npm workspace
- committed `package-lock.json`
- Node version documented or managed by mise
- .NET SDK version documented or managed by mise
- root development commands
- no dependency on pnpm, Yarn, or Bun

If mise is used, provide a root `mise.toml`.

Verify that the project can be initialized from a clean environment with approximately:

```bash
mise install
npm install
npm run dev
```

If mise is not installed, normal direct installations of Node and .NET must still be usable.

Do not make mise-specific shell behavior part of application runtime.

---

## Phase 0.2 — Native service lifecycle

Electron must be able to:

1. launch `DisplayService.exe`
2. detect successful initialization
3. send a command
4. receive a response
5. receive unsolicited events
6. detect native process exit
7. terminate it safely

Establish the IPC protocol.

Document it in:

```text
/docs/native-protocol.md
```

---

## Phase 0.3 — Foreground window

Implement:

```text
SetWinEventHook
EVENT_SYSTEM_FOREGROUND
```

Verify events for:

- browser
- Explorer
- normal application
- game if available

Log executable changes.

---

## Phase 0.4 — Display enumeration

Enumerate displays and determine:

- stable ID
- friendly name
- adapter
- GPU vendor
- connection where available
- primary state
- HDR state

Verify multi-monitor behavior if multiple displays are available.

---

## Phase 0.5 — Windows gamma

Prove:

1. read current RGB gamma ramp
2. persist it in memory as baseline
3. apply a modified ramp
4. restore the exact previous ramp

Represent ramps as:

```text
Red[256]
Green[256]
Blue[256]
```

using 16-bit values.

The color transform itself should be implemented as a pure, testable function.

---

## Phase 0.6 — NVIDIA

On NVIDIA hardware, investigate and verify:

- NVIDIA GPU/display enumeration
- NVAPI display mapping
- Digital Vibrance support
- current Digital Vibrance value
- supported range
- setting Digital Vibrance
- restoring previous value
- hue if practical
- behavior while HDR is enabled

Prefer existing maintained .NET NVAPI wrappers where appropriate, but inspect their implementation and licensing before making them permanent production dependencies.

Document any undocumented/private NVAPI dependencies.

Do not pretend private/undocumented NVAPI interfaces are stable.

---

## Phase 0.7 — AMD

Implement against AMD ADLX.

Investigate and expose support for:

- brightness
- contrast
- gamma
- saturation
- hue
- color temperature

For each capability:

- query support
- query current value
- query min/max/default where available
- set value
- restore previous value

If AMD hardware is unavailable during development:

- implement from official SDK/interfaces
- add unit/integration boundaries
- mark runtime behavior as unverified
- do not claim hardware validation

Document results separately from NVIDIA.

---

# Feasibility matrix

Maintain this in:

```text
/docs/display-research.md
```

Example:

| Capability          | Windows         | NVIDIA    | AMD      |
| ------------------- | --------------- | --------- | -------- |
| Adapter detection   | Verified        | Verified  | Verified |
| Display enumeration | Verified        | Verified  | Verified |
| HDR detection       | Verified        | N/A       | N/A      |
| Brightness          | Gamma transform | TBD       | ADLX     |
| Contrast            | Gamma transform | TBD       | ADLX     |
| Gamma               | Gamma ramp      | TBD       | ADLX     |
| Saturation          | —               | NVAPI DVC | ADLX     |
| Hue                 | —               | NVAPI     | ADLX     |
| Color temperature   | —               | TBD       | ADLX     |
| State read          | Verified        | TBD       | TBD      |
| Restoration         | Verified        | TBD       | TBD      |

Use:

```text
Verified
Implemented, unverified
Unsupported
Unknown
```

rather than ambiguous checkmarks when appropriate.

---

# Phase 0 exit criteria (completed)

Phase 0 was completed and reviewed on 2026-08-08. The criteria remain here as
the safety baseline for later work; do not repeat the spike unless a regression
or new hardware question requires it.

Do not proceed to polished product UI until we can reliably demonstrate:

1. reproducible npm-based project setup
2. Electron ↔ DisplayService communication
3. foreground application detection
4. display enumeration
5. stable display mapping
6. gamma capture/write/restore
7. NVIDIA saturation read/write/restore on NVIDIA hardware
8. AMD provider implementation against ADLX
9. AMD runtime validation if AMD hardware is available
10. capability reporting
11. baseline restoration

At the end of Phase 0, update:

```text
/docs/display-research.md
```

with:

- APIs used
- dependencies used
- Node version
- npm version
- .NET version
- GPU tested
- driver tested where relevant
- displays tested
- HDR findings
- multi-monitor findings
- native value ranges
- provider limitations
- undocumented API dependencies
- known failures
- recommended production architecture

The stop gate was satisfied by the reviewed findings in
`docs/display-research.md`. Do not regress those findings while implementing
later milestones.

---

# Roadmap status and slice rules

Current status on 2026-08-22:

- Phase 0 — complete
- Milestone 1 — complete
- Milestone 2 — complete
- Milestone 3 — complete
- Milestone 4 — complete
- Milestone 5 — complete
- Milestone 6 — complete
- Milestone 7 — complete
- Milestone 8 — next

Implement the roadmap in the numbered slices below. A slice is complete only
when its behavior is integrated, tested at the appropriate boundary, documented
where needed, and passes the repository's relevant build, typecheck, lint, and
test commands.

Do not pull UI-foundation or packaging work into Milestone 2. Do not begin
visual polish before the Milestone 4 functional UI exists.

---

# Milestone delivery workflow

When a full numbered milestone is complete and its functionality has passed the
repository's required validation:

1. confirm the intended milestone changes and exclude unrelated work
2. commit the completed work on a branch
3. push the branch and create a pull request
4. confirm required pull-request checks pass
5. merge the pull request into `main`
6. verify the merged result on `main`

Do not treat an individual slice as a completed milestone unless the user
explicitly asks for slice-level delivery. Never merge work with failing required
validation.

---

# Milestone 1 — Core domain (completed)

After Phase 0:

Implement TypeScript domain behavior.

Build:

- profile models
- application rules
- display targets
- profile repository
- profile matcher
- activation resolver
- manual overrides
- default profile behavior
- tests

Completed slices:

### Slice 1.1 — Profile model and validation

- vendor-neutral profile, application-rule, and display-target schemas
- optional color settings with normalized product values
- strict versioned configuration validation

### Slice 1.2 — Persistence and migration

- repository CRUD and duplication
- storage-port boundary
- explicit schema migration and invalid-data failures

### Slice 1.3 — Application matching

- exact normalized path matching
- filename fallback
- disabled-profile and deterministic-precedence behavior

### Slice 1.4 — Activation resolution

- manual, foreground, default, and baseline precedence
- duplicate-target suppression
- transition reset behavior

No polished UI was required for this milestone.

---

# Milestone 2 — Automatic activation

Connect:

```text
DisplayService
→ foreground event
→ NativeClient
→ ProfileMatcher
→ ActivationResolver
→ display.apply
```

Verify:

```text
Desktop
→ Default

Game A focused
→ Gaming

Desktop focused
→ Default

Game B focused
→ High Visibility
```

Rapid alt-tab must not corrupt state.

Implement in these slices:

### Slice 2.1 — Native activation command surface (completed)

- add validated `NativeClient` methods and schemas for state, baseline capture,
  apply, per-display restore, and restore-all
- preserve native error codes in a structured TypeScript error type
- test requests, responses, unsolicited events, timeouts, and process exits

### Slice 2.2 — Main-process composition and persistence (completed)

- implement the app-data JSON storage adapter for `JsonProfileRepository`
- load and validate configuration before enabling automatic activation
- compose the repository, matcher, resolver, native client, and structured
  logging in Electron main
- keep product behavior out of `DisplayService`

### Slice 2.3 — Serialized activation coordinator (completed)

- consume foreground events in Electron main
- select the intended profile and resolve per-display settings
- serialize transitions so rapid focus changes cannot interleave display writes
- suppress duplicate writes when the intended activation target has not changed
- apply each profile from captured baseline rather than from the preceding
  profile

### Slice 2.4 — Automatic-transition recovery and verification (completed)

- verify foreground, default, and baseline transitions
- cover duplicate and rapid event sequences with deterministic tests
- surface partial capability failures without crashing Electron
- reset activation state after external restore or native-service restart
- log why a profile matched, activated, failed, or was skipped

---

# Milestone 3 — Tray and packaging foundation

### Slice 3.1 — Tray read model and lifecycle (completed)

- current profile
- open
- exit
- close-to-tray behavior without terminating automatic activation

### Slice 3.2 — Tray activation controls (completed)

- profile selection
- automatic mode
- manual override
- baseline reset
- menu refresh when profiles or activation state change

### Slice 3.3 — Restore-safe shutdown (completed)

- normal exit requests native restore and waits for confirmation
- restore failure keeps the application alive with an actionable error
- tray exit and main-window exit use the same shutdown coordinator

### Slice 3.4 — Windows packaging foundation (completed)

Adapt the useful Electron Builder patterns from the reviewed starter rather than
adopting the starter itself.

- configure Windows application identity, icons, NSIS artifacts, and ASAR
- publish `DisplayService.exe` and all required runtime/native files as external
  packaged resources
- resolve the packaged sidecar from `process.resourcesPath`; retain explicit
  development-path resolution separately
- keep executable resources outside ASAR and verify their exact packaged paths
- provide code-signing configuration hooks without committing certificates or
  secrets
- smoke-test unpacked and installed builds, including service launch, IPC,
  baseline restoration, and uninstall/upgrade-safe data placement

---

# Milestone 4 — Profile UI

### Slice 4.1 — UI foundation (completed)

- Chakra UI v3 now owns accessible renderer controls and semantic tokens;
  Tailwind, shadcn, and Base UI were removed in the 2026-08-11 foundation migration
- define ChromaShift design tokens and light/dark themes
- add a React error boundary and accessible loading/error states
- retain the native Windows frame unless a later reviewed decision changes it
- do not add Router, Query, or animation libraries without demonstrated need

### Slice 4.2 — Typed renderer-to-main product API (completed)

- centralize request and response contracts in shared Zod schemas
- validate IPC sender, arguments, and returned data
- expose a narrow capability-oriented preload API rather than generic `invoke`
- translate native and persistence failures into explicit user-facing results

### Slice 4.3 — Profile management (completed)

- profile list
- create
- edit
- delete
- duplicate

### Slice 4.4 — Assignment workflows (completed)

- display selection
- application selection

### Slice 4.5 — Capability-driven preview (completed)

- live preview
- unsupported/HDR-unsafe control explanations
- explicit preview toggle without a countdown timer
- cancel restores the exact pre-preview state

Focus on functionality before visual polish.

### Slice 4.6 — Windows panel workflows (completed)

- use Chakra UI components with Lucide icons and application-owned wrappers only
  where Chakra's compound component API benefits from a narrower product API
- keep the native Windows frame for the app panel
- open a borderless, non-activating mini panel from tray left-click, keep it
  above taskbar flyouts, and close it when opening the app panel
- provide an explicit close button and a draggable header; remember the user
  position, clamp it to connected displays, and use tray anchoring as the fallback
- let mini-panel color overrides survive hiding the panel but restore them when
  switching profiles, returning to Auto switch, resetting, or exiting
- provide `Update profile` and `Reset changes` actions for temporary overrides
- keep one always-enabled, undeletable Default profile as the catch-all; it has
  no application assignments but remains editable and copyable
- keep profile navigation read-only until Edit; navigation never previews a
  profile without an explicit Preview action
- replace foreground-window capture with a visible top-level application picker,
  excluding ChromaShift, system/background windows, and duplicate executables;
  retain the `.exe` browser
- add System/Light/Dark theme, launch-at-startup, login launch behavior, close
  behavior, and Restore original settings; diagnostics/log browsing is completed
  in Slice 5.3
- login launch respects `Start in tray` versus `Show app panel`; explicit launches
  always show the app panel

### Redesign — Per-display profile settings (implemented and validated)

Color settings are stored independently per stable display ID inside a profile,
not once per profile. `ProfileDisplayTarget` owns `color` and `lastColorValues`;
the profile root has no shared color object. There is exactly one source of
applied settings per `(profileId, displayId)` pair.

Configuration schema version 2 introduces this shape with an explicit version 1 to
version 2 migration that copies the old shared `color` into every existing display
target. Never silently reset or rewrite `%APPDATA%\ChromaShift\profiles.json`.

An omitted color setting means that display keeps its captured pre-ChromaShift
baseline. A profile target whose `color` is empty issues no apply write, and a
display dropped from the desired target set is restored baseline-first.

Default is the fallback when no application profile matches. It implicitly covers
every connected display; a connected display with no Default overrides stays at
baseline, so newly connected displays receive nothing automatically. The Edit-mode
display checkbox means `this profile overrides this display`, and it applies to
Default and application profiles alike. For Default it controls whether a saved
override target exists, not whether the display belongs to the catch-all profile;
for an application profile, target presence also defines display assignment. Label
the fallback profile `Default`, never `Global`.

Use `docs/per-display-profile-settings-plan.md` as the source of truth for schema,
migration, activation, preview, UX, testing, and exit criteria. Its
`Confirmed UX decisions` and `Design-to-implementation mapping` sections are
authoritative where an individual Figma frame disagrees.

The redesign is Figma-MCP-first. Inspect components, variants, variables,
annotations, and auto-layout constraints through the connected Figma MCP rather
than guessing from flattened screenshots, and ask the user about ambiguous or
missing states before changing the product model.

---

# Milestone 5 — Hardening (complete)

### Slice 5.1 — Display and operating-system transitions (complete)

- rapid alt-tab
- monitor reconnect
- DisplayPort reconnect
- HDMI reconnect
- HDR toggles
- topology re-enumeration and stale-handle invalidation
- introduce a small testable adapter over Electron power events for lock,
  unlock, suspend, and resume instead of scattering `powerMonitor` listeners
- on resume, invalidate native handles, re-enumerate displays, re-resolve
  capabilities/HDR, validate baseline ownership, and only then reapply the
  intended product state; never write through stale handles
- persist debounced main-window bounds and maximized state, reject geometry that
  no longer intersects a connected display, and flush the final valid state on
  close without delaying restore-safe shutdown

### Slice 5.2 — Process and restoration resilience (complete)

- abrupt Electron parent exit restoration (completed; detached helper plus PID monitor)
- process exits
- unsupported GPU
- missing vendor SDK
- native service crash
- Electron crash
- heartbeat/watchdog restoration
- emergency restore shortcut
- add bounded recovery for renderer `crashed`, `oom`, and `abnormal-exit` states;
  recreate from main-owned product state, cap retries within a time window, and
  surface a terminal error rather than entering a reload loop
- add a DisplayService version/health handshake before considering automatic
  restart; any bounded backoff and circuit breaker must preserve the original
  captured-baseline owner and must never recapture already modified output as a
  new baseline

### Slice 5.3 — Packaged application security and diagnostics (implemented and package-smoke verified)

- packaged sidecar launch and restoration paths
- IPC sender validation and navigation/external-URL policy
- dependency audit and current Electron security patch level
- production Content Security Policy and Electron fuse review
- structured logs sufficient to diagnose activation and restore failures
- expose a bounded, sender-validated in-app browser for the latest structured
  diagnostic events without giving the renderer filesystem access
- isolate development data automatically per Git worktree while retaining
  explicit user-data overrides for smoke tests and intentional production-data
  migration checks

### Slice 5.4 — Current-hardware and release readiness (complete)

- multi-monitor
- installed upgrade and uninstall behavior
- code-signing hooks that keep credentials outside the repository
- add a release preflight/smoke that verifies tag, application version, package
  metadata, update manifest, artifact names, and published architectures agree
  before upload; serialize release publication and retain signing/notarization
  hooks even while credentials are absent

---

# Milestone 6 — Performance and footprint optimization (complete)

Optimize only from repeatable measurements. Reliability, exact baseline
restoration, native-provider coverage, renderer sandboxing, Windows interaction
behavior, and package security take precedence over a smaller benchmark number.
Keep Electron as the production shell unless new measurements cross the
reconsideration threshold recorded in `docs/performance.md`.

### Slice 6.1 — Establish footprint baselines and budgets

- measure the complete process tree in app-panel, mini-panel, hidden-to-tray,
  and post-renderer-release states after startup has settled
- record private memory, working set, process count, idle CPU, startup time,
  renderer bundle sizes, installer size, unpacked size, `app.asar` size, and the
  external `DisplayService` footprint
- separate repeatable product costs from machine-, driver-, and Electron-specific
  overhead; run comparable samples and record the test environment
- define regression budgets and explicit success criteria in
  `docs/performance.md`; do not declare this milestone complete from a single
  favorable sample or Task Manager snapshot

### Slice 6.2 — Minimize steady-state memory

- retain no renderer while ChromaShift is operating only as a tray utility;
  preserve the existing short mini-panel grace period only if measurements show
  that its responsiveness benefit justifies its cost
- lazy-load app- and mini-panel code and data, eliminate duplicate long-lived
  state, timers, listeners, and caches, and keep background work event-driven
- profile Electron main, renderer, utility, native helper, and .NET allocations
  independently before selecting changes
- keep automatic activation, the tray, emergency restore, logging, helper
  heartbeats, and baseline ownership available in the minimum-memory tray state
- add repeatable regression coverage for leaks across repeated open, close,
  preview, profile-switch, and app/mini handoff cycles

### Slice 6.3 — Minimize install and distribution size

- audit production dependencies, emitted renderer chunks, source maps, assets,
  Electron locales, architecture targets, ASAR contents, and duplicated native
  files; remove only content proven unnecessary at runtime
- measure the Electron application and self-contained .NET helper separately so
  the dominant contributors are visible
- evaluate supported .NET publish options such as trimming, single-file output,
  ReadyToRun settings, and framework-dependent deployment only through measured
  prototypes; reject any option that weakens cold-start behavior, NVAPI/ADLX
  loading, offline installation, diagnostics, or restore-safe recovery
- retain x64 packaging, required Electron runtime files, both NVIDIA and AMD
  provider support, ASAR integrity, production fuses, and the external sidecar
  boundary
- regenerate the exact installer with `npm run package:win` before recording its
  size; never infer installer size from `package:dir` or stale release output

### Slice 6.4 — Validate and enforce the optimized baseline

- compare before/after measurements on the same Windows host and publish the
  results, tradeoffs, retained files, and rejected experiments in
  `docs/performance.md`
- run canonical verification, repeated renderer lifecycle tests, real desktop
  smoke, memory measurement, package generation, and installed package smoke
- verify app/mini panel behavior, automatic switching, native helper liveness,
  baseline restoration, crash restoration, install/upgrade/uninstall, and user
  data preservation after optimization
- turn stable memory, renderer, and package-size limits into automated regression
  gates where the measurement is deterministic enough for CI

---

# Milestone 7 — Notifications, shortcuts, and tray extensions

### Slice 7.1 — Native profile-change notifications

- add an opt-in setting for native Windows notifications when the effective
  profile changes
- apply that preference to routine automatic, manual, and shortcut profile
  selections; explicit restore, pause/resume, safety, and critical shortcut
  failure feedback remains available independently
- identify the successfully selected profile and whether the transition came
  from automatic activation, a manual selection, or a shortcut
- notify only after a real activation transition completes; suppress duplicate
  focus events and avoid claiming full success when display application is only
  partially successful
- keep notification delivery in Electron main so it does not require an app- or
  mini-panel renderer to remain alive

### Slice 7.2 — Configurable global profile shortcuts

- allow shortcuts for specific profiles, Default, previous enabled profile, and
  next enabled profile
- make shortcut ordering deterministic, skip disabled profiles, and preserve the
  existing rule that an explicit profile selection establishes a manual override
- provide a shortcut that disables ChromaShift display control by restoring the
  captured original settings and pausing automatic writes; provide an explicit
  shortcut or toggle action to re-enable normal profile resolution
- register shortcuts in Electron main, validate and persist bindings, detect
  collisions or operating-system registration failures, and never depend on a
  renderer being open
- save each shortcut edit immediately through the same settings boundary used by
  General settings; support Ctrl, Alt, Shift, and the Windows key with another
  key, while treating hardware-only Fn as unavailable
- unregister stale bindings on edits and shutdown, and surface actionable errors
  without disturbing the last valid shortcut configuration

### Slice 7.3 — Explicit tray panel actions

- add separate `Open app panel` and `Open mini panel` actions to the tray context
  menu, including when the icon is opened from the Windows hidden-icons drawer
- represent the top-level Automatic choice with a native checkable item that can
  remain unchecked while a manual profile is selected; it has no adjacent radio
  peer because profile choices live in a submenu
- retain tray left-click reopening the last-used panel
- route both context actions through the shared panel controller so opening one
  surface hides the other
- preserve native app-panel focus and caption behavior plus the mini panel's
  non-activating, pointer-oriented, position-clamped behavior

### Slice 7.4 — Settings, state integration, and validation

- expose notification preferences and shortcut bindings through the existing
  validated settings and preload boundaries
- make paused/restored display-control state visible in the tray, app panel, and
  mini panel, with an obvious path back to automatic activation
- keep notifications, tray actions, and shortcuts synchronized with profile
  creation, rename, disablement, deletion, and activation-state changes
- cover settings persistence, shortcut conflicts, previous/next ordering,
  Default selection, restore/pause/resume behavior, notification deduplication,
  renderer-free operation, and real Windows tray interactions
- run canonical verification and the real Electron desktop sequence; unit tests
  alone do not validate global shortcuts, native notifications, or hidden-icons
  drawer behavior

Milestone 7 completed on 2026-08-22. The installed-package gate delivered and
physically clicked a real Windows notification, then verified that the app panel
routed to the selected profile. `docs/testing.md` records the completed
automated, real-desktop, package, notification-click, and performance evidence.

---

# Milestone 8 — Extended hardware and release hardening

Run this milestone after Milestone 7. It extends the validated matrix without
reopening the completed Milestone 5 implementation scope.

### Slice 8.1 — Guarded operating-system transition matrix

- validate suspend/resume and lock/unlock with the independent restoration guard
- validate resolution, refresh-rate, and primary-display changes
- validate NVIDIA driver reset, stable display identity, baseline ownership, and
  intended-state reapplication across each transition

### Slice 8.2 — GPU and driver matrix

- validate at least one ADLX-supported AMD-driven display before advertising AMD
  hardware support as verified
- validate mixed AMD/NVIDIA display ownership and independent capability routing
- record representative NVIDIA and AMD driver/version results and regressions

### Slice 8.3 — Baseline-owning process fault matrix

- validate an actually hung Electron parent through heartbeat restoration
- exercise baseline-owning helper termination and confirm the product fails
  closed without recapturing modified output
- document the restoration boundary for helper, operating-system, and power-loss
  failures that cannot be recovered after the baseline owner is gone

### Slice 8.4 — Signed distribution trust

- build with the real Authenticode certificate and verify every signed binary
- validate signed install, in-place upgrade, restore-safe exit, and uninstall
- record Windows SmartScreen and installer-reputation behavior on clean systems

---

# MVP definition

MVP is complete when:

## Profiles

Users can:

- create
- edit
- delete
- duplicate
- manually activate

profiles.

## Controls

Profiles support where available:

- Brightness
- Contrast
- Gamma
- Saturation
- Hue

Color temperature may ship if AMD support is straightforward.

## NVIDIA

Support:

- saturation through NVIDIA Digital Vibrance
- gamma/brightness/contrast through the best verified provider
- safe baseline restoration

## AMD

Support through ADLX where verified:

- brightness
- contrast
- gamma
- saturation
- hue

## Automation

Foregrounding an assigned application activates its profile.

Leaving that application activates the resolved default profile/baseline.

## Tray

Application works as a tray utility without requiring the main window to remain open.

## Persistence

Profiles survive application restart.

## Restoration

Normal exit restores display baseline.

Emergency restore is available.

---

# Deferred beyond Milestones 6 and 7

Architect for but do not schedule yet:

- Intel support
- DDC/CI
- monitor hardware brightness
- monitor hardware contrast
- monitor picture modes
- fullscreen-only rules
- application-running rules
- schedules
- HDR profiles
- RGB channel controls
- color temperature on additional vendors
- ICC integration
- profile import/export
- profile sharing
- per-game automatic discovery
- automatic updates
- LUT editor
- gamma curve visualization

---

# Testing

## TypeScript unit tests

At minimum:

### Matching

- exact executable path
- filename fallback
- case normalization
- multiple applications
- disabled profile
- no matching profile

### Activation

- baseline
- default
- foreground profile
- manual override
- manual → automatic
- Profile A → Profile B
- duplicate foreground event
- rapid event sequences

### Persistence

- valid configuration
- invalid configuration
- schema migration

---

## Native tests

Test what can be tested without hardware using abstractions.

Keep native SDK calls behind adapters so behavior can be mocked.

Manual/integration tests must verify actual hardware state.

---

# Code quality rules

When implementing:

1. Inspect existing code before modifying architecture.
2. Prefer small vertical slices.
3. Avoid speculative abstractions.
4. Keep TypeScript/native boundaries strict.
5. Never leak native handles into IPC.
6. Never expose NVAPI/ADLX structs outside their provider.
7. Add runtime validation at IPC boundaries.
8. Add tests alongside domain logic.
9. Log native failures.
10. Dispose native resources deterministically.
11. Do not silently ignore unsupported capabilities.
12. Do not hardcode driver-specific ranges.
13. Do not assume one GPU per machine.
14. Do not assume one display per GPU.
15. Do not implement roadmap features without being asked.
16. Prefer official Windows/NVIDIA/AMD APIs and documentation.
17. Clearly document use of undocumented/private APIs.
18. Do not redesign unrelated code while completing a task.
19. Preserve safe restoration behavior above convenience.
20. Stop and investigate if baseline restoration cannot be made dependable.
21. Use npm for JavaScript package management.
22. Keep and update `package-lock.json`.
23. Do not convert the project to pnpm, Yarn, or Bun without explicit approval.
24. Use mise only for reproducible tool/runtime version management where useful.
25. Prefer root npm scripts for common developer workflows.
26. Preserve renderer sandboxing and context isolation in development and production.
27. Validate privileged renderer-to-main IPC senders as well as payloads.
28. Allowlist protocols and destinations before opening external URLs.
29. Keep the native Windows frame unless a custom title bar is explicitly reviewed.
30. Do not copy a starter template's dependency set or lockfile wholesale.
31. Add UI and packaging dependencies only in their assigned roadmap slices.
32. Package `DisplayService` as an external resource, never inside ASAR.
33. Test native launch and restoration from the actual packaged directory layout.
34. Preserve applicable third-party copyright and license notices.

---

# AI agent expectations

This project is expected to be implemented primarily by coding agents.

Optimize the repository for that workflow.

Prefer:

- explicit contracts
- narrow modules
- strongly typed data
- documented boundaries
- reproducible commands
- automated tests
- diagnostic tooling
- structured logs
- small commits
- independently testable subsystems

The standard project entry points should be obvious to an agent.

Prefer:

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

over undocumented combinations of package-manager and native commands.

If tool versions are important, encode them in `mise.toml` rather than relying on whichever runtime happens to be installed globally.

Avoid hidden behavior and implicit global state.

When implementing hardware-specific behavior, provide diagnostics that allow a human tester to report exact outcomes without understanding the native implementation.

Example:

```text
Display
LG 32GQ950

Adapter
NVIDIA GeForce RTX 5080

HDR
Off

Gamma provider
Windows GDI
SUPPORTED

Saturation provider
NVIDIA NVAPI
SUPPORTED

Native range
0–63

Current
31

Requested normalized
75

Mapped native
47

Apply
SUCCESS
```

This kind of visibility is preferable to opaque abstractions.

---

# Current agent task

Phase 0 and Milestones 1–7 are complete. The GeoSwap-inspired Chakra UI,
feature-organization, canonical verification, CI, and focused-skill foundation
was accepted on 2026-08-11. The measured Tauri port and T3 Code review also
settled Electron as the production shell and added the recommendations recorded
in the per-display UI plan and Milestone 5. Continue with **Milestone 8 —
Extended hardware and release hardening**.

Milestone 5 is complete. The current NVIDIA/two-display machine passed
canonical verification, native watchdog restoration, real desktop, forced-parent
exit, and fused installer/install/upgrade/uninstall smoke. Slice 5.4's release
metadata and artifact preflight plus serialized signed draft-release workflow are
implemented. The guarded SDR/HDR/SDR recovery sequence is hardware-validated on
the G60SD. Active-Edit DisplayPort hot-unplug/cancel/reconnect is also validated
on that display, including stable-ID baseline retention and exact tray-exit
restoration. The G60SD HDMI disconnect/reconnect path is validated as well.
Disconnected targets remain persisted but are omitted from the editor; explicit
shutdown restores connected displays and discards unreachable session restoration
records without blocking Exit. The broader guarded transition, baseline-owning
process-fault, AMD/mixed-GPU/driver, signing-certificate, and installer-reputation
matrix moved to Milestone 8 by product decision on 2026-08-20. Do not convert an
unconfirmed baseline-owning helper exit into an automatic restart: fail closed
rather than recapturing modified output.

Physical display identity is separate from native endpoint identity. Native
endpoint IDs remain connector-specific and own immutable baselines. A physical
ID is derived only from a trustworthy EDID manufacturer and serial; otherwise it
falls back to the endpoint ID. Profiles and normal UI use the physical ID,
capabilities are intersected across current endpoints, and writes fan out while
restore remains endpoint-specific. The dual-connected G60SD DP/HDMI paths are
hardware-validated under this model. See `docs/physical-display-identity.md`.

The real `smoke:desktop:native-recovery` path force-terminates only the smoke
Electron process's baseline-free DisplayService child and verifies bounded
health/topology recovery before the full restore-safe desktop sequence. If a
crashed helper may have owned baselines, restart remains fail-closed and the UI
shows actionable recovery guidance without raw display identifiers; technical
details stay in Diagnostics.
The Diagnostics settings page reads only a bounded tail of the current JSONL log,
validates at most 250 newest-first entries through the typed preload API, and
keeps verbose payloads collapsed until the user opens them.

## Completed Phase 0 deliverables

The following list records the completed feasibility scope; it is historical
context, not the current task:

Scaffold the repository using **npm workspaces** and create:

1. root npm workspace
2. reproducible toolchain setup, optionally using mise
3. Electron + React + TypeScript desktop shell
4. C# `DisplayService`
5. JSON IPC between Electron and `DisplayService`
6. display enumeration
7. GPU vendor detection
8. foreground application watcher
9. Windows gamma read/write/restore proof
10. NVIDIA provider spike
11. AMD ADLX provider spike
12. capability reporting
13. baseline capture/restore
14. diagnostic logging

A basic developer diagnostics screen or CLI output was created to inspect results.

It intentionally remains unpolished.

---

# Completed Phase 0 report

The completed report is:

```text
/docs/display-research.md
```

including:

### Environment

- Windows version
- Node version
- npm version
- .NET version
- Electron version
- GPU(s)
- GPU driver(s)
- display(s)
- connection types
- HDR state

### Toolchain

- whether mise is used
- versions pinned by mise
- standard npm commands
- clean-install instructions

### Windows

- APIs used
- display identity approach
- gamma behavior
- restoration behavior

### NVIDIA

- library/API used
- supported controls
- ranges
- read behavior
- write behavior
- restoration behavior
- HDR behavior
- documented vs undocumented APIs

### AMD

- ADLX interfaces used
- supported controls
- ranges
- runtime validation status
- restoration behavior
- HDR behavior

### Multi-monitor

- enumeration behavior
- stable identity findings
- provider selection behavior

### Risks

List concrete technical risks.

### Recommendation

State the recommended production implementation for each capability.

This stop-and-review gate was satisfied on 2026-08-08. Use the recorded findings
as constraints for Milestone 2 and later work.
