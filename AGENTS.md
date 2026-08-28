# ChromaShift repository instructions

ChromaShift is a Windows 11 display profile manager built with Electron, React,
TypeScript, Chakra UI, and a separate C# display helper. Reliability and exact
restoration outrank feature breadth.

## Route work to the focused guidance

Read `docs/architecture.md` plus the matching skill before changing these areas:

- `.agents/skills/chromashift-desktop-ui/SKILL.md` for renderer, Chakra UI,
  app-panel, mini-panel, accessibility, theme, or native-window interaction
- `.agents/skills/chromashift-display-safety/SKILL.md` for DisplayService,
  providers, HDR, topology, foreground events, baselines, or hardware validation
- `.agents/skills/chromashift-profile-model/SKILL.md` for profiles, persistence,
  migrations, matching, activation, optional settings, or preview rollback
- `.agents/skills/chromashift-packaging-release/SKILL.md` for packaging, helper
  shutdown, signing, versioning, CI, installers, or release automation

Repository workflows:

- GitHub issues are the tracker. Read `docs/agents/issue-tracker.md` before issue
  or pull-request operations.
- Triage labels are defined in `docs/agents/triage-labels.md`.
- Domain terminology and ADR rules are defined in `docs/agents/domain.md` and
  `CONTEXT.md`.

## Product and process boundaries

- Electron owns product behavior. Keep profiles, matching, activation precedence,
  preview, settings, tray behavior, notifications, and user-facing errors in
  TypeScript.
- `ChromaShift.DisplayService.exe` owns Windows and GPU interaction only. Keep
  native handles, display enumeration, foreground hooks, capability discovery,
  state reads and writes, baseline ownership, and restoration in C#.
- Communicate with the helper through the typed NDJSON protocol. Do not add a Node
  native addon or expose vendor APIs through renderer IPC.
- Keep profiles vendor-neutral. Product `saturation` maps to NVIDIA Digital
  Vibrance or AMD Saturation inside the provider.
- Treat each physical display independently. Mixed NVIDIA, AMD, Intel, and unknown
  adapters must remain valid.
- Use stable physical display IDs for persistence. Native endpoint IDs remain
  separate restoration targets and may fan out behind one physical profile target.
- Use normal Windows and GPU display APIs. ChromaShift does not inject into
  applications, inspect process memory, hook rendering, install a driver, or
  interact with anti-cheat software.

Avoid speculative features, new frameworks, and dependencies without a current
product requirement and measured benefit.

## Display safety

Original settings mean the state captured before ChromaShift first modifies a
display during the current control session. They are not factory defaults and are
not the Default profile.

- Capture supported state before the first mutation.
- Calculate every profile from the immutable captured baseline. Never compound
  one profile transform onto another.
- Validate and clamp values in TypeScript, IPC schemas, native commands, and the
  provider before a write.
- Read back native writes. On a partial apply failure, restore the whole display.
- Treat HDR as a capability change. Do not apply SDR gamma behavior while HDR is
  active.
- Reacquire native handles after topology changes. Never reuse stale handles.
- A provider or stable-identity mismatch fails closed. Do not recapture output
  that ChromaShift may already have modified.
- Normal exit and explicit shutdown require confirmed restoration for connected
  displays. A genuine restore failure keeps the app and helper alive for retry.
- A disconnected display retains baseline ownership for reconnect during the
  session. Explicit shutdown may discard only unreachable-display restoration
  records; saved profile targets remain.
- The fixed global emergency shortcut must work without a renderer.

AMD ADLX support is implemented, but AMD writes remain hardware-unverified until
tested on an AMD-driven display. Do not describe AMD behavior as verified.

## Profiles and activation

Color settings live on per-display profile targets. Every setting is optional.
An omitted setting uses the captured original state; it does not mean a neutral
number. Keep `lastColorValues` separate from applied settings.

Activation precedence is:

```text
manual override
  > foreground application profile
  > Default profile
  > original settings
```

- The permanent Default profile is enabled, undeletable, and the only catch-all.
  It cannot receive application assignments.
- Default implicitly covers connected displays. A missing target means that
  display stays at its captured original settings.
- Application profiles target the displays present in their `displays` array.
- Persist disconnected targets by stable ID, but omit them from the normal editor.
- Deduplicate only after a successful transition. Failed transitions remain
  retryable.
- Profile switching, pause, restore, topology work, and preview rollback share the
  serialized activation queue.
- Version persistence changes and provide explicit fixtures. Never reset or
  overwrite invalid user configuration silently.

Preview is user-controlled and has no countdown. Cancel, reset, navigation away,
or failure must wait for pending writes and restore the exact prior automatic or
manual target. Save keeps the edited result. Entering Edit from an unchanged
same-profile preview promotes the existing session without a restore or recapture.

See `docs/core-domain.md` and `docs/per-display-profile-settings.md` for the full
current contract.

## Display-control states

Use the product terms from `CONTEXT.md`:

- Active: ChromaShift may resolve and apply profiles.
- Paused: the user requested no writes after successful restoration.
- Safety blocked: ChromaShift failed closed because restoration, identity, or
  ownership could not be confirmed.

Pause enters Paused only after complete restoration. An incomplete pause or
resume enters Safety blocked. Explicit profile or Automatic selection resumes a
user pause, but it cannot bypass a safety block. One-shot Restore original
settings leaves display control Active and preserves the intended target.

## Desktop application

- Keep renderer sandboxing and context isolation enabled. The renderer receives a
  narrow typed preload API, not Node access or a generic IPC primitive.
- Validate privileged IPC sender, input, and output with shared Zod schemas.
- Deny unexpected navigation and new windows. Allow only explicit HTTPS external
  links.
- Use Chakra UI v3 and the established semantic tokens. Do not add Tailwind,
  shadcn, Base UI, or another styling system.
- Keep Electron's native caption controls and `titleBarOverlay`. Preserve Windows
  minimize, maximize, close, Snap, keyboard, and DPI behavior.
- The app and mini panel are mutually exclusive. Closing the app panel releases
  its renderer to the tray.
- The mini panel stays pointer-oriented, non-activating, and always on top. It uses
  `showInactive()` and remains non-resizable unless the user approves a product
  contract change.
- Hardware acceleration stays disabled until a measured interaction requires it.
  Repeat desktop visual and performance gates after changing that decision.
- Keep renderer imports light enough to stay inside the fixed gzip budget.

Use the approved Figma references in `docs/per-display-profile-settings.md` for
profile or mini-panel design changes. Inspect exact nodes and capture the visible
native window for comparison. A renderer-only screenshot is insufficient.

## Persistence and diagnostics

Production data lives under `%APPDATA%\ChromaShift`:

- `profiles.json` holds schema-versioned profiles.
- `preferences.json` holds renderer-editable preferences and shortcuts.
- `window-state.json` holds Electron-owned geometry and mini-panel position.
- `chroma-shift.json` holds runtime-owned display-control state and intent.
- `logs/main.jsonl` holds rotated diagnostics.

Development data is worktree-specific under
`%APPDATA%\ChromaShift-development\<worktree>-<hash>`. Preserve production and
legacy migration paths. Keep settings-slice ownership separate so one writer
cannot clobber another slice.

The renderer may read only a bounded, validated diagnostic tail through preload.
It never receives a filesystem path.

## Packaging and release

- Use npm workspaces and `package-lock.json`. Do not switch package managers.
- Use mise only for toolchain versions. Do not make it part of application
  runtime.
- Package compiled application code inside ASAR.
- Publish the self-contained helper under
  `resources/display-service/ChromaShift.DisplayService.exe`.
- Ship replaceable `NvAPIWrapper.dll`, GPL/LGPL license texts, and the third-party
  notice beside the helper.
- Resolve packaged resources only from `process.resourcesPath`.
- Preserve user data during install, upgrade, and uninstall.
- Keep local builds unsigned. Release signing uses Azure Artifact Signing after
  the human enrollment and workflow tickets complete.
- Verify version, tag, installer, block map, update metadata, architecture, and
  every required Authenticode signature before draft publication.
- Repository visibility and release publication require the explicit approval in
  issue #48. Preparation work must leave the repository private.

See `docs/packaging.md`, `docs/signing.md`, and `docs/third-party.md`.

## Working and validation rules

- Preserve unrelated tracked and untracked work. Do not overwrite user changes.
- If a request removes or weakens existing behavior, explain the conflict and get
  approval before implementation.
- Prefer small implementation slices at existing boundaries.
- Add dependencies only when they provide clear value. Pin current compatible
  versions through npm.
- Use `npm run verify` as the canonical non-interactive gate.
- Run the relevant single test files and typechecking during implementation.
- Run real Electron flows for shortcuts, focus, tray, native display, packaging,
  or desktop visual work. A passing `npm run verify` does not prove those paths.
- Display-mutating smoke requires a restoration guard and suitable interactive
  hardware. Do not infer hardware success from hosted CI.
- Treat `EmergencyRestoreShortcutUnavailable` as a conflicting running instance.
  Do not stop a user-owned process without permission.

Common commands are defined in `package.json`. Test scope and hardware records
live in `docs/testing.md`; performance and footprint budgets live in
`docs/performance.md`.

## Current release work

Milestones 1 through 7 are shipped. The explicitly authorized unsigned
`v0.1.0-preview.3` hotfix validates the uninstall and Start menu cleanup before
Milestone 8 publishes the existing product as signed `v0.1.0-preview.4`:

- #44 public-source readiness and documentation cleanup
- #45 human Azure Artifact Signing enrollment
- #46 Azure signing integration
- #47 signed `v0.1.0-preview.4` release-candidate validation
- #48 explicit public-repository and release publication

Additional sleep, lock, driver-reset, AMD, mixed-GPU, clean-VM, and SmartScreen
studies are issue-driven follow-up work, not Milestone 8 release gates.
