# AGENTS.md

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

Avoid adding dependencies unless they provide clear value.

Do not add React Router unless navigation complexity actually warrants it.

Do not add TanStack Query unless asynchronous application state becomes complex enough to justify it.

Do not use pnpm, Yarn, Bun, or another JavaScript package manager unless explicitly requested.

Use `package-lock.json` and commit it.

Use standard npm workspaces for the monorepo.

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
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
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
export interface ColorProfile {
  id: string;
  name: string;
  enabled: boolean;

  color: {
    brightness?: number;
    contrast?: number;
    gamma?: number;
    saturation?: number;
    hue?: number;
    colorTemperature?: number;
  };

  applications: ApplicationRule[];

  displays: ProfileDisplayTarget[];
}
```

Each setting must be optional.

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
  id: string;

  name: string;

  adapter: {
    vendor: "nvidia" | "amd" | "intel" | "unknown";
    name: string;
  };

  connection?: string;

  primary: boolean;

  hdr: boolean;

  capabilities: DisplayCapabilities;
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
  supported: boolean;

  provider:
    | "windows"
    | "nvidia"
    | "amd"
    | "intel"
    | "unknown";

  min?: number;
  max?: number;
  default?: number;
}

interface DisplayCapabilities {
  brightness: Capability;
  contrast: Capability;
  gamma: Capability;
  saturation: Capability;
  hue: Capability;
  colorTemperature: Capability;
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
window.displayProfiles.getDisplays();

window.displayProfiles.getProfiles();

window.displayProfiles.activateProfile(profileId);

window.displayProfiles.restoreBaseline();
```

Keep `contextIsolation` enabled.

Do not enable unrestricted Node integration in renderer windows.

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
Current: Gaming

Automatic ✓

Profiles
  Default
  Gaming
  High Visibility
  Color Accurate

────────────

Reset displays
Open
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

When previewing extreme display changes, support automatic rollback.

Conceptually:

```text
Keep these settings?

Reverting in 15 seconds…
```

This may be implemented after the initial feasibility work.

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

| Capability | Windows | NVIDIA | AMD |
|---|---|---|---|
| Adapter detection | Verified | Verified | Verified |
| Display enumeration | Verified | Verified | Verified |
| HDR detection | Verified | N/A | N/A |
| Brightness | Gamma transform | TBD | ADLX |
| Contrast | Gamma transform | TBD | ADLX |
| Gamma | Gamma ramp | TBD | ADLX |
| Saturation | — | NVAPI DVC | ADLX |
| Hue | — | NVAPI | ADLX |
| Color temperature | — | TBD | ADLX |
| State read | Verified | TBD | TBD |
| Restoration | Verified | TBD | TBD |

Use:

```text
Verified
Implemented, unverified
Unsupported
Unknown
```

rather than ambiguous checkmarks when appropriate.

---

# Phase 0 exit criteria

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

Then stop.

Do not begin visual polish until the technical findings have been reviewed.

---

# Milestone 1 — Core domain

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

No polished UI required.

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

---

# Milestone 3 — Tray

Implement:

- current profile
- profile selection
- automatic mode
- manual override
- baseline reset
- open
- exit

---

# Milestone 4 — Profile UI

Build the React application for:

- profile list
- create
- edit
- delete
- display selection
- application selection
- live preview

Focus on functionality before visual polish.

---

# Milestone 5 — Hardening

Test:

- rapid alt-tab
- process exits
- sleep/wake
- monitor reconnect
- DisplayPort reconnect
- HDMI reconnect
- resolution changes
- refresh-rate changes
- HDR toggles
- NVIDIA driver reset
- unsupported GPU
- missing vendor SDK
- native service crash
- Electron crash
- multi-monitor
- mixed GPU configurations where possible

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

# Post-MVP

Architect for but do not initially build:

- Intel support
- DDC/CI
- monitor hardware brightness
- monitor hardware contrast
- monitor picture modes
- fullscreen-only rules
- application-running rules
- schedules
- HDR profiles
- global profile hotkeys
- RGB channel controls
- color temperature on additional vendors
- ICC integration
- profile import/export
- profile sharing
- per-game automatic discovery
- startup with Windows
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

# First agent task

Work on **Phase 0 only**.

Do not build the production UI.

## Deliverables

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

Create a basic developer diagnostics screen or CLI output sufficient to inspect results.

Do not spend time styling it.

---

# Required Phase 0 report

Before moving on, write:

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

Then stop and report the findings before continuing to the next milestone.