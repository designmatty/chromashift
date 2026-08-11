# Per-display profile settings redesign plan

Status: planned and deferred pending new product mockups
Decision date: 2026-08-11

This document is the handoff for a future implementation thread. It records the
agreed product direction and the cross-layer work required to replace the current
one-color-object-per-profile model. Do not begin the UI implementation until the
new app-panel and mini-panel mockups settle the open interaction questions below.

## Design source and Figma MCP workflow

The replacement designs will be authored in Figma. The implementation thread must
use the connected Figma MCP as the primary design-inspection path rather than
working from flattened screenshots alone.

Design references to fill in when the mockups are ready:

| Reference | Value |
|---|---|
| Figma file URL | TBD |
| App-panel page or root node | TBD |
| Mini-panel page or root node | TBD |
| Shared components or design-system page | TBD |

Before implementation, the agent must:

1. confirm the Figma MCP is installed, connected, and able to read the supplied
   file; if it is unavailable, pause UI implementation and ask the user to connect
   it rather than approximating from screenshots
2. ask for the Figma file URL and the specific page/frame/node IDs for the app
   panel, mini panel, and any relevant component library
3. retrieve only the relevant node hierarchy, component/variant metadata,
   variables, styles, auto-layout constraints, annotations, and exportable assets
4. inspect every represented state, including read-only, Edit, preview, dirty,
   disabled, unsupported, error, disconnected-display, light, and dark states
5. create a short design-to-implementation mapping that records Figma node IDs
   beside the React surface or component expected to implement them
6. ask the user about missing or ambiguous behavior before changing the product
   model; the mockups communicate layout and flow but are not assumed to enumerate
   every feature or edge case
7. reuse the existing Chakra UI components, semantic theme tokens, and Lucide
   icons where they match; export Figma assets only when they cannot be
   represented faithfully with the established component or icon system

The product semantics and safety rules in this plan remain authoritative when a
visual frame is ambiguous. User answers can amend those decisions. Figma-derived
measurements should inform spacing, sizing, hierarchy, and responsive behavior,
but must not weaken renderer isolation, capability gating, baseline restoration,
or non-activating mini-panel behavior.

After implementation, capture the real app and mini panel at the same theme,
scale, content, and state as the approved Figma frames. Compare hierarchy,
spacing, typography, colors, controls, overflow, and window dimensions, then test
the actual Windows interaction path in addition to the visual comparison.

## Why change the model

The current `ColorProfile` stores one shared `color` object and a list of display
IDs. Every selected display receives the same normalized values. That is simple,
but it cannot represent common multi-monitor requirements:

- two monitors can need different values for the same foreground application
- a gaming display may need overrides while a secondary color-accurate display
  stays at its captured baseline
- display capabilities and HDR safety can differ within one profile
- the permanent Default profile should not present connected displays as though
  they were optional activation assignments

The native boundary already applies settings to one stable display ID at a time.
The redesign belongs primarily in the TypeScript profile, persistence, activation,
preview, IPC, and renderer layers.

## Settled product semantics

1. Color settings are stored independently for each display within a profile.
2. An omitted color setting means that display uses its captured pre-ChromaShift
   baseline for that capability. It never means a fixed neutral value.
3. Applying or switching profiles remains baseline-first. Settings must not
   compound from one profile or display state into another.
4. The permanent Default profile is the fallback when no application-specific
   profile matches.
5. Default implicitly covers every currently connected display. Its display list
   is informational/configurational, not a set of assignment checkboxes.
6. A connected display with no Default overrides stays at baseline. A newly
   connected display therefore receives no overrides automatically.
7. Application profiles continue to target an explicit subset of displays, but
   each selected display owns its own optional color values.
8. Disconnected display records are retained by stable display ID so settings can
   return when the same display reconnects.
9. Fresh profiles and newly added display targets begin with no active color
   overrides. Remembered slider values may exist without becoming applied values.
10. Capability, provider, and HDR availability are evaluated per display.

## Proposed schema

Move `color` and `lastColorValues` from the profile root into each display target:

```ts
interface ProfileDisplayTarget {
  displayId: string
  color: ColorSettings
  lastColorValues?: ColorSettings
}

interface ColorProfile {
  id: string
  name: string
  enabled: boolean
  applications: ApplicationRule[]
  displays: ProfileDisplayTarget[]
}
```

`ColorSettings` remains vendor-neutral and optional per capability. Stable display
IDs remain the persistence key; display indices and transient native handles must
not enter the schema.

For an application profile, presence in `displays` means the display is assigned
to that profile. For Default, the renderer enumerates all connected displays and
joins any persisted target settings by stable ID. A connected Default display with
no persisted target is equivalent to `{ color: {} }` and remains at baseline.

The exact schema naming can change during implementation, but there must be one
unambiguous source of applied color settings per `(profileId, displayId)` pair.
Do not retain a second shared profile-level color fallback.

## Persistence and migration

Introduce configuration schema version 2 and an explicit version 1 to version 2
migration.

For each version 1 profile:

1. create one version 2 target for every existing `displays[]` entry
2. copy the profile's shared `color` into each target
3. copy `lastColorValues` into each target when present
4. preserve profile IDs, names, enabled state, application rules, target order,
   and stable display IDs
5. remove the version 1 root `color` and `lastColorValues` fields

This preserves current rendered behavior while enabling later independent edits.
The user's existing configuration must not be rewritten before the version 2
implementation is complete and validated. Before migration ships, add a fixture
representing the current customized Default and application profiles and prove
the migrated configuration produces equivalent per-display apply requests.

Version 1 profiles containing color values but no display targets currently issue
no native writes. Decide during the schema slice whether to discard those inert
values with an explicit migration diagnostic or preserve them as a user-visible
unassigned template; do not silently invent a display target.

## Activation behavior

The activation resolver continues to choose one profile using the existing
precedence:

```text
manual override
  > foreground application profile
  > Default profile
  > baseline
```

After profile selection, the activation coordinator resolves desired work per
display:

1. build the desired `(displayId, color)` targets
2. restore captured displays that are no longer overridden by the new target set
3. capture baseline for each display that has at least one active override
4. apply that target's color object only to that display
5. isolate and report capture, apply, and restore failures per display
6. consider the transition complete only after every display result is accounted
   for

Targets whose `color` object is empty produce no apply write. Moving from an
overridden target to an empty target restores the captured baseline. Duplicate
stable display IDs remain invalid case-insensitively.

Topology changes must rejoin settings by stable ID, never reuse stale handles, and
leave unknown/new Default displays at baseline. The later Milestone 5 topology work
must consume this same resolution path rather than introduce separate semantics.

## Preview and editing behavior

Preview sessions become per-display while retaining one atomic profile-edit
session:

- editing one display previews only that display's draft settings
- changing the selected display does not discard the profile draft
- Cancel restores every display touched by the edit to the exact pre-edit
  automatic/manual state
- explicit Preview remains a toggle and never starts a countdown
- Save persists the complete profile draft and keeps the intended active state
- navigating away from a previewed profile ends preview and restores prior state
- a failure on one display is surfaced without hiding successful/failed status for
  the others

The typed product API should send complete validated target settings or a precise
per-display patch. Do not create a generic renderer-controlled native command.

## Full app UX requirements

The new mockups should define these interactions before renderer work begins:

- how users navigate between display cards/tabs inside one profile
- how application-profile display assignment differs visually from selecting a
  display to edit
- how Default shows all connected displays without enable/disable checkboxes
- how disconnected saved displays appear and can be removed
- how mixed values are represented if multi-display editing is offered
- whether and where `Copy settings to displays...` belongs
- how per-display capability/HDR explanations appear beside controls

Read-only mode must summarize settings by display without rendering editable
inputs. Edit mode previews changes for the currently edited display. The Default
profile should be labeled `Default` or `Fallback`, never `Global`, because its
fallback activation role is distinct from applying identical settings globally.

## Mini-panel UX requirements

The current mini panel assumes one shared color object. The new design must choose
an explicit interaction for per-display overrides; do not silently default all
edits to the primary monitor.

The mockups should settle:

- whether a compact display switcher is always visible
- whether the panel can show one display at a time or a deliberate multi-display
  selection
- how mixed values and unsupported capabilities are represented
- whether `Update profile` saves only the visible display or the complete draft
- how Reset restores every display touched by the temporary override

The panel must remain pointer-oriented and non-activating on Windows. Any solution
requiring text entry or keyboard focus belongs in the full app panel.

## Implementation slices

### Slice 1 - Confirm UX and contract

- connect the Figma MCP and record the approved file, page, frame, and component
  node IDs in this document
- inspect the full-app and mini-panel mockups through Figma MCP, including variants,
  variables, annotations, and layout constraints
- write the design-to-implementation node mapping
- close every UX question listed above
- finalize version 2 names and Default semantics in `AGENTS.md` and this document

### Slice 2 - Core schema and migration

- add per-display color/remembered settings to `packages/core`
- implement and fixture-test version 1 to version 2 migration
- update CRUD, duplication, validation, and configuration documentation

### Slice 3 - Activation coordinator

- resolve and apply independent target settings
- restore stale/empty targets baseline-first
- test partial failures, identical transitions, and multi-display ordering

### Slice 4 - Preview and product API

- update preview session state and rollback for touched displays
- update shared Zod IPC schemas, main handlers, and the narrow preload API
- retain sender validation and capability/HDR rejection

### Slice 5 - Full app UI

- implement approved per-display navigation and summaries
- make Default display membership implicit/read-only
- implement display assignment only for application profiles

### Slice 6 - Mini panel

- implement the approved compact per-display interaction
- verify close, drag, remembered position, taskbar Z-order, and non-activation

### Slice 7 - End-to-end validation

- migrate an isolated copy of the real version 1 configuration
- extend desktop smoke for two displays with different settings
- verify edit/preview/cancel/save/navigation and temporary mini-panel overrides
- run normal-exit and forced-exit baseline restoration smokes
- run packaged smoke and inspect the real Windows interaction path

## Required tests

- schema accepts different color objects for two stable display IDs
- migration duplicates version 1 shared settings into every old target exactly
- duplicate target IDs are rejected case-insensitively
- one profile applies different payloads to two displays
- empty target settings restore baseline and issue no apply write
- switching profiles restores displays removed from the desired override set
- Default leaves new/unconfigured displays at baseline
- disconnected target settings survive persistence and reconnect by stable ID
- capability/HDR rejection is isolated to the affected display
- Cancel and preview navigation restore every touched display exactly
- duplication deep-copies all target settings and remembered values
- renderer read-only and Edit views never conflate display assignment with display
  selection
- mini-panel Reset restores all temporarily touched displays
- normal shutdown and abrupt Electron termination restore all captured baselines

## Non-goals

- vendor-specific values in persisted profiles
- changing the native per-display command boundary unless a concrete gap appears
- schedules, window-title rules, fullscreen triggers, or global profile hotkeys
- a database or state-management library migration
- high-frequency display polling
- implementing UI before the replacement mockups are approved

## Exit criteria

The redesign is complete only when version 1 data is preserved, two connected
displays can hold visibly different settings in one active profile, Default leaves
unconfigured displays at baseline, preview rollback is exact across all touched
displays, the non-activating mini panel has an intentional per-display flow, and
normal/crash restoration smokes pass on the merged result.
