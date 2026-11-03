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

- The sidebar has an Automatic | Manual toggle. Automatic calls Return to
  Automatic; Manual keeps the live profile, independently of the profile being
  previewed. Sidebar profile clicks preview without changing mode. Choose
  `Use this profile` in the preview strip or row menu, or double-click a row,
  to use an enabled profile manually. Mode changes use the existing unsaved-changes
  dialog. The collapsed 40px rail shows the same toggle as A | M, with the active
  mode highlighted. Both sizes have full labels and tooltips; Automatic includes
  its configured shortcut. Staying Paused when changing mode depends on #71's
  controller change; this renderer calls the existing APIs.
- Profile availability is Enabled or Disabled. The live row subtitle is
  `Live · Automatic` or `Live · Manual` while Active, `Paused · <mode>` while
  Paused, and `Blocked · <mode>` while Safety blocked. Its ring uses the live
  orange/pink accent, grey, or red respectively. Non-live previews carry an eye
  badge. Disabled profiles retain their image in greyscale with a small disabled
  badge, dimmed text and a Disabled subtitle. Row tooltips include available
  hotkeys. The collapsed rail preserves all badges, the live ring and unsaved dot.
  The reorder handle remains available on hover and keyboard focus.
- The clickable title-bar pill still pauses, resumes, or retries display control.
  It says `Active · Automatic` or `Active · Manual: <profile>` in green,
  `Previewing: <profile>` in the live accent for a non-live preview,
  `Auto-switching on hold` in amber for unsaved changes, `Paused` in grey,
  or `Safety blocked` in red. Paused and Safety blocked take precedence over
  preview and hold. Long names truncate, with the full state in the tooltip.
- Row menus offer Use this profile, Clone, Disable/Enable, then a divider and
  red Delete action. Default retains its protected availability and deletion
  behavior. Delete uses the existing confirmation dialog.
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
- Click the header title to rename a profile in place. Enter or blur records the
  name in the unsaved draft; Escape cancels the name input. New profiles open
  with naming focused. New profiles use `New profile`, `New profile 2`, and the
  first free number thereafter. Clones use the source name with the first free
  numeric suffix, including when cloning an already numbered name.
- Deleting a profile shows only the delete confirmation, even with unsaved changes.
  Cancel preserves the draft and session. Confirm ends only the deleted profile's
  session before deletion; deleting another profile preserves the open session.
- A subtle preview strip sits directly below the rounded main panel, aligned to
  its width without spanning the sidebar. Its text is left-aligned and actions
  are on the right. The panel shrinks to make room and scrolls internally, keeping
  the content's top position stable. It names the previewed profile and the automatic target.
  `Use this profile` selects it manually; disabled profiles offer `Enable`.
  `End preview`, selecting the live profile, or closing ends preview and returns
  the editor to the live profile. Minimizing ends only a clean preview. A dirty
  edit or temporary override stays applied with its draft intact and automatic
  switching on hold. Focus loss leaves preview active.
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

While Edit or Temporary override has unsaved changes, the app status pill and
mini-panel power icon show amber `Auto-switching on hold`. Their tooltips explain
the unsaved changes. The tray tooltip and status menu label show the same hold;
there is no separate tray icon asset. Active, Paused, and Safety blocked retain
their existing meanings, with Paused and Safety blocked taking precedence over
the hold indicator.

Main exposes the latest blocked automatic target through validated ProductState.
An app-view toast says `<Profile> not applied — unsaved changes on <edited profile>`
and offers Update and Discard. Both finish the session through the existing path
that resolves the latest queued foreground application. Update preserves the
activation mode. A later foreground change replaces the queued target; returning
to the currently intended target clears it.

Opening the app with a mini-panel override shows its applied values in editable
sliders and the normal `Update profile` / `Discard changes` bar. An existing unsaved
session opens directly in Profiles with that profile selected, even if the last
remembered view was Settings. Draft dirtiness compares current content with the
saved profile. Reverting all edits makes the draft clean; minimizing then ends it
through serialized rollback, including while main still has the older dirty state.
Promotion from
Override to Edit reuses matching targets without restoring, recapturing, or writing
to displays. The separate inverted override banner is removed.

The mini panel edits one explicitly selected display at a time and shows the same
icons and per-control neutral reset actions. `Update profile` saves the complete
temporary draft across touched displays; `Discard changes` rolls the session back.
Picking a profile discards the temporary changes without a blocking dialog.
The panel remains non-activating, always on top,
pointer-oriented, and non-resizable.

Tray Exit and other application quit requests warn when an Edit or Temporary
override session has unsaved changes. The main-process dialog names the profile
and offers `Update profile`, `Discard changes`, or `Cancel`, including when no
renderer exists. Before checking the main-owned draft, quit requests a renderer
draft flush and waits up to 750 ms for a validated acknowledgement. This includes
edits still inside the preview-sync debounce. Without a renderer or a timely
response, quit uses main-owned state. Update saves the main-owned complete draft through the existing
confirmation path before shutdown. Discard proceeds with normal restore-safe
shutdown. Cancel keeps the application and session running. Save or restoration
failure keeps the application alive; connected-display restoration remains a
requirement for exit.
