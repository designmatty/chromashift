# Per-display profile settings

This document records the current profile model and desktop interaction contract.
The implementation is the design source of truth. Validate changes on the visible
native Electron window; a renderer-only screenshot cannot prove Windows caption,
DPI, focus, non-activation, or z-order behavior.

## Profile model

Color settings belong to a stable physical display target:

```ts
interface ProfileDisplayTarget {
  displayId: string
  color: {
    brightness: number
    contrast: number
    gamma: number
    saturation: number
    hue: number
    colorTemperature: number
  }
}
```

An assigned display always stores all six values. New assignments start with the
neutral color settings: 50 brightness, 50 contrast, 1 gamma, 50 saturation, 0
hue, and 50 color temperature. Each changed control has an independent reset
action that returns only that value to neutral. There is no per-control enabled
state and no `lastColorValues`.

Unsupported settings stay persisted and visible so profiles survive adapter and
topology changes. Electron intersects capabilities across a physical display's
native endpoints and sends only supported fields to the helper.

Schema version 3 completes legacy partial targets with neutral values, removes
remembered inactive values, and clamps gamma to the brightness-dependent safety
envelope. Structured diagnostics record those changes without an in-app notice.

## Activation rules

Profile selection uses this precedence:

```text
manual override
  > foreground application profile
  > Default profile
  > original settings
```

After selection, Electron resolves work per physical display, restores targets
that are no longer assigned, captures a baseline before the first write, and
applies a capability-filtered native request. Transitions remain baseline-first.

The permanent Default profile implicitly covers connected displays. A connected
display without a persisted Default target stays at its original settings. An
application profile targets only displays in its `displays` array. Disconnected
targets remain persisted and resume when the same physical display returns.

## App-panel behavior

- The sidebar profile selector chooses Automatic mode or an enabled profile
  manually. Automatic shows its resolved profile name; available shortcuts are
  shown alongside each option. Sidebar profile clicks preview without changing
  the activation mode.
- Profile availability is Enabled or Disabled. Navigation marks the intended
  selection as Current while display control is Active, Will resume while
  Paused, or Pending while Safety blocked. Explicit selection resumes a user
  pause but never bypasses a safety block.
- The Status action pauses, resumes, or retries display control independently
  of profile navigation and availability.
- Every connected display appears as a tab in the always-editable profile view. The
  selected physical display persists across profiles and restarts.
- Selection falls back to the first display with saved settings, then the primary display,
  then the first connected display. Tabs scroll horizontally when needed.
- Adapter and connection details appear inside the selected tab. Primary displays
  carry a `Primary` marker.
- Every selected tab shows its color values without a display-level override
  checkbox. A connected display without saved settings starts from the neutral
  values, and the first change creates its complete display target.
- Opening the app selects the Intended target's profile, or Default, and scrolls
  it into view. Non-profile views remain remembered; profile requests from main win.
- Clicking a profile previews its saved values unless it is already live. Displays
  without a target are held at Original settings, including when the profile has
  no targets. The first color change creates that display's complete target and
  promotes Preview to Edit.
  Disabled profiles remain openable, previewable, and editable.
- While Paused or Safety blocked, profile clicks show values without applying
  them. Inputs are disabled and a Resume action remains available.
- The first change promotes Preview to Edit in place before applying the draft.
  Only sidebar rows, including the collapsed rail, mark unsaved changes with a bullet.
  When dirty, the header shows `Discard changes` then primary `Update profile`
  immediately left of the overflow menu, without an unsaved-changes label. `Update profile`
  commits the complete draft while preserving mode; `Discard changes` rolls back.
  A renderer dialog offers Update, Discard, or Cancel before leaving unsaved
  changes through profile selection, activation selection, or navigation.
- Deleting a profile shows only the delete confirmation, even with unsaved changes.
  Cancel preserves the draft and session. Confirm ends only the deleted profile's
  session before deletion; deleting another profile preserves the open session.
- A subtle preview strip sits directly below the rounded main panel, aligned to
  its width without spanning the sidebar. Its text is left-aligned and actions
  are on the right. The panel shrinks to make room and scrolls internally, keeping
  the content's top position stable. It names the previewed profile and the automatic target.
  `Use this profile` selects it manually; disabled profiles offer `Enable`.
  `End preview`, selecting the live profile, closing, or minimizing ends preview
  and returns the editor to the live profile. Focus loss leaves preview active.
- The established brightness, contrast, gamma, saturation, and hue controls keep
  their existing row layout. Their icons replace the former per-control enabled
  checkboxes. Unsupported controls stay disabled and explain their unavailable
  state, while a non-neutral value can still be reset while editing. Color temperature
  is not surfaced in the profile or mini-panel editor.
- Brightness changes clamp gamma immediately. The gamma number input adopts the
  new bounds, and its slider shows disallowed lower or upper track portions.
- Brightness, contrast, gamma, saturation, and hue each use a compact identifying
  icon in the app and mini panel.
- Profile and settings sidebars share one persisted collapsed state. The collapsed
  rail is 40 pixels wide and uses icon buttons with tooltips; it does not expand
  on hover or change the native window minimum width.
- `Copy to` copies the selected display's complete vector to chosen destinations.

## Preview and mini-panel behavior

One preview session can touch several display targets. Clicking an app-panel
profile starts Preview; its first change promotes the unchanged session to Edit
without restoring or recapturing. Draft changes then apply immediately and remain
unsaved until `Update profile`. `Discard changes`, navigation, or failure waits
for pending writes and restores the prior automatic or manual target. Preview
holds automatic writes while remembering foreground changes and has no countdown.

During app-panel Preview or Edit, connected SDR displays without a draft target
are held at Original settings. The session restores any existing immutable native
baseline without capturing modified output. A display without a captured baseline
needs no write. Adding a target uses normal capture-before-apply; removing it
restores Original settings. HDR and disconnected baselines remain retained and
deferred. Teardown restores all session and activation-owned baselines before
serialized activation rollback resets deduplication and reapplies the prior target
on every display, including displays held at Original settings. Restore failures
surface as preview failures.

The mini panel edits one explicitly selected display at a time and shows the same
icons and per-control neutral reset actions. `Update profile` saves the complete
temporary draft across touched displays; `Reset changes` remains the separate
session rollback action. The panel remains non-activating, always on top,
pointer-oriented, and non-resizable.
