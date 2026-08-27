# Per-display profile settings

This document records the shipped per-display profile contract and the approved
design references. The completed migration and implementation plan has been
removed. Tests and current architecture docs now own implementation coverage.

## Design source

The app and mini-panel designs live in Figma:

| Reference       | URL                                                                                |
| --------------- | ---------------------------------------------------------------------------------- |
| File            | https://www.figma.com/design/zPdG2A9e1XjzhS4Po8ujLf/chromashift?m=dev              |
| App-panel root  | https://www.figma.com/design/zPdG2A9e1XjzhS4Po8ujLf/chromashift?node-id=53-3&m=dev |
| Mini-panel root | https://www.figma.com/design/zPdG2A9e1XjzhS4Po8ujLf/chromashift?node-id=53-2&m=dev |

The file has no published variables or shared component library. ChromaShift
uses its Chakra semantic tokens, local component adapters, and Lucide icons.
Future design work must inspect the relevant Figma nodes and validate the visible
native window. A flattened renderer screenshot does not prove Windows caption,
DPI, focus, non-activation, or z-order behavior.

### Implementation mapping

| Figma node                                 | State                     | Current implementation                                  |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------- |
| `35:1606`, `35:1729`                       | Read-only profiles        | `features/profiles/profile-detail.tsx`                  |
| `35:1268`, `35:1429`                       | Edit profiles             | `features/profiles/profile-detail.tsx`                  |
| `39:4000`                                  | Temporary-override banner | `app/main-app.tsx`                                      |
| `35:1269`                                  | Native-caption header     | `components/layout/presentational.tsx`, `main/index.ts` |
| `35:1284`                                  | Profile sidebar           | `features/profiles/profile-list.tsx`                    |
| `35:1346`, `35:1351`                       | Display accordions        | `features/profiles/display-controls.tsx`                |
| `35:1360`                                  | Color controls            | `features/profiles/color-controls.tsx`                  |
| `35:1426`                                  | Application assignments   | `features/profiles/application-assignments.tsx`         |
| `39:2365`, `39:2723`, `39:2957`            | Settings views            | `features/settings/`                                    |
| `35:1859`, `35:1871`, `35:1944`, `35:2034` | Mini-panel states         | `features/mini-panel/mini-panel.tsx`                    |

## Profile model

Color settings belong to a stable display target:

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

Every color setting is optional. An omitted setting uses the captured original
display state; it does not mean a fixed neutral value. `lastColorValues` remembers
the most recent value for a disabled control without applying it.

Schema version 2 migrated each version 1 shared color object into every existing
display target. It preserved profile IDs, names, application rules, target order,
and stable display IDs. A version 1 profile with color values but no target had
never issued a display write, so migration discarded those inert values with a
diagnostic instead of inventing a target.

## Activation rules

Profile selection uses this precedence:

```text
manual override
  > foreground application profile
  > Default profile
  > original settings
```

After selecting a profile, Electron resolves work per display. It restores
targets that are no longer overridden, captures a baseline before the first
write, applies only present settings, and reports each display result. Empty
color objects produce no apply request. All transitions remain baseline-first.

The permanent Default profile implicitly covers connected displays. A connected
display without a persisted Default target stays at its original settings. An
application profile targets only the displays present in its `displays` array.
Disconnected targets stay persisted by stable ID and resume only when the same
physical display returns.

## App-panel behavior

- Display controls use a multi-expand accordion. Saved targets start expanded.
- In Edit mode, a display checkbox adds or removes that profile's target. It is
  not a global display assignment switch.
- Read-only mode lists connected displays and marks displays without overrides as
  `Not overridden`.
- Disconnected targets remain in persistence but stay out of the normal editor.
- `Copy to` copies one display's settings only to destinations the user chooses.
- Capability and HDR failures appear beside the affected control.
- Default is the fallback profile. The UI does not call it `Global`.

## Preview and mini-panel behavior

One preview session can touch several display targets. Cancel, reset, navigation,
or failure restores the exact previous automatic or manual target after pending
writes finish. Save persists the complete draft. Preview has no countdown.

The mini panel edits one explicitly selected display at a time. `Update profile`
saves the complete temporary draft across touched displays, and `Reset changes`
restores every touched display. The panel remains non-activating and
pointer-oriented. Text entry and keyboard-focused work belong in the app panel.
