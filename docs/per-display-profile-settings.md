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

New profiles start with a neutral target for every currently connected display,
keyed by stable physical display ID. With no connected displays, a new profile
starts without targets. Duplicates copy their source. Missing targets still mean
original settings for Default, older empty profiles, and displays connected later.

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
  `Use this profile` in the preview strip or row menu, double-click a row, or
  press Shift+Enter on a row, including in the collapsed rail, to use an enabled
  profile manually. Mode changes use the existing unsaved-changes
  dialog. The collapsed 40px rail shows the same toggle as A | M, with the active
  mode highlighted. Both sizes have full labels and tooltips; Automatic includes
  its configured shortcut. Changing mode or selecting a profile while Paused updates persisted intent
  and stays Paused. Selection never bypasses a safety block.
- Profile availability is Enabled or Disabled. The live row subtitle is
  `Live · Automatic` or `Live · Manual` while Active, `Paused · <mode>` while
  Paused, and `Blocked · <mode>` while Safety blocked. Its ring uses the live
  orange/pink accent, grey, or red respectively. Non-live previews carry an eye
  badge. Disabled profiles retain their image in greyscale with a small disabled
  badge, dimmed text and a Disabled subtitle. Collapsed row tooltips include
  available hotkeys and the Shift+Enter action. The collapsed rail preserves all
  badges, the live ring and unsaved dot.
  The reorder handle remains available on hover and keyboard focus.
- The clickable title-bar pill still pauses, resumes, or retries display control.
  It says `Active · Automatic` or `Active · Manual: <profile>` in green,
  `Previewing: <profile>` in the live accent for a non-live preview,
  `Auto-switching on hold` in amber for unsaved changes, `Paused` in grey,
  or `Safety blocked` in red. Exactly one pill is shown. Paused or Safety blocked
  takes precedence over
  unsaved hold, which takes precedence over a non-live preview, then Active mode.
  Safety blocked retains its Retry action. The pill is at most 170px wide; longer
  labels truncate, with the full state in the tooltip.
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
- Without an unsaved session, opening the app selects the Intended target's
  profile, or Default, and scrolls it into view. Non-profile views remain remembered;
  profile requests from main win. An unsaved session opens directly in Profiles
  with its draft selected, including when Settings was the last view.
- Clicking a profile previews its saved values unless it is already live, so a
  new profile opens as a native Preview at neutral values. Connected displays
  without a target are held at Original settings, including profiles with no
  targets. The first color change creates that display's complete target and
  promotes Preview to Edit.
  Disabled profiles remain openable, previewable, and editable. Clicking the
  profile the Profiles view already shows does nothing, whether it is live or
  previewed.
- While Paused or Safety blocked, profile clicks show values without applying
  them. Inputs are disabled and a Resume action remains available. While
  Paused, a translucent overlay covers the whole Profiles pane, including the
  header, with a centered `ChromaShift is paused` card and Resume. The mini
  panel shows the same card over its controls pane; its title bar, profile
  picker, and footer stay usable. Both overlays blur the content beneath by 2px
  and stop it scrolling. Paused has no inline status row under the profile
  name. Safety blocked keeps its inline status row.
- The first change promotes Preview to Edit in place before applying the draft.
  Only sidebar rows, including the collapsed rail, mark unsaved changes with a bullet.
  When dirty, the header shows `Discard changes` then primary `Update profile`
  immediately left of the overflow menu, without an unsaved-changes label. Both
  keep the editor on the shown profile. `Update profile` saves the complete
  draft while preserving mode. On the live profile it ends the session; on
  another profile the session keeps previewing the saved values without a
  display change. `Discard changes` returns a non-live profile to its saved
  values, still previewed as if it had just been clicked. It reverts the session
  in place, restoring Original settings for targets the saved profile lacks.
  On the live profile it rolls back. A renderer dialog
  offers Update, Discard, or Cancel before leaving unsaved changes through
  profile selection, activation selection, or navigation; either choice then
  continues to that destination.
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
  the content's top position stable. A decorative icon sits left of
  "Previewing: <name>".
  `Use this profile` selects it manually; disabled profiles offer `Enable`.
  `End preview`, selecting the live profile, or closing ends preview and returns
  the editor to the live profile. Minimizing ends only a clean preview. A dirty
  edit or temporary override stays applied with its draft intact and automatic
  switching on hold. Focus loss leaves preview active.
  Switching from one previewed or edited profile to another profile that will
  preview keeps the strip mounted and names the destination. It hides only when
  the destination is the live profile or the switch fails.
- Color controls keep the app's label/value/slider row and the mini panel's
  label/value above the slider. Values appear as plain text. In the app panel,
  click a value to edit it inline; Enter or blur saves and Escape cancels.
  Opening and closing an unchanged editor preserves the exact stored value,
  including fractional hue and gamma. Gamma keeps full precision while editing.
  There are no stepper arrows. Arrow keys adjust app-panel values and sliders
  within the current bounds. The mouse wheel adjusts sliders, and adjusts a value
  only while its inline editor is open, so scrolling past a value never changes
  it. Mini-panel values remain plain text without an editor; use the slider or
  scroll over it to adjust. Exact text entry is in the app panel. The mini panel retains its
  pointer-oriented, non-activating native window contract.
- Brightness, contrast, saturation, and color temperature display percentages.
  Gamma always displays two decimal places. Hue displays 0–359°, calculated as
  `round(stored hue × 3.59)`; degree input rounds back to the nearest stored
  value on the 0–100 scale. Storage and native requests remain unchanged.
- Each slider marks its neutral value with a two-tone line in the track, centered
  where the thumb sits at neutral. Non-neutral controls show
  a ↺ action directly after the control label, with the tooltip and accessible
  name `Reset to neutral`. It changes that control to its neutral value,
  independently of the last saved profile.
  Hue has a rainbow track; saturation has a grey-to-vivid track that ends in the
  theme accent (orange in light, pink in dark). Disabled sliders render in
  grayscale, so neither colored track suggests it can be adjusted.
- Unsupported controls stay disabled and explain their unavailable state, while
  a non-neutral value can still be returned to neutral while editing. Color
  temperature appears in both panels when its capability is supported. Otherwise
  it appears only when non-neutral, disabled with its neutral action available.
  The mini-panel height includes this row whenever it is visible.
- Brightness changes clamp gamma immediately. The inline gamma input adopts the
  new bounds. Disallowed slider sections use hatching in both themes. A tooltip
  names the gamma bounds and current brightness and appears briefly when the
  thumb reaches a constrained limit. The envelope cannot guarantee driver
  acceptance: a rejected Windows ramp reports the requested gamma, brightness,
  and display, and the existing whole-display restoration rule still applies.
- Profile and settings sidebars share one persisted collapsed state. The collapsed
  rail is 40 pixels wide and uses icon buttons with tooltips; it does not expand
  on hover or change the native window minimum width.
- Sidebar profile names stay on one line and truncate with an ellipsis. A
  truncated name shows its full text in the shared tooltip on hover; the
  collapsed rail's row tooltip always names the profile.
- `Copy to` sits flush right on the adapter and connection line below the
  display tabs and copies the selected display's complete vector. With two
  connected displays it names the destination directly, for example
  `Copy to VG278`. With three or more it opens a destination menu.

## Preview and mini-panel behavior

One preview session can touch several display targets. Clicking an app-panel
profile starts Preview; its first change promotes the unchanged session to Edit
without restoring or recapturing. Draft changes then apply immediately and remain
unsaved until `Update profile`. Navigation or failure waits for pending writes
and restores the prior automatic or manual target. `Discard changes` also waits
for pending writes; on a non-live profile it returns the session to the saved
values instead. Preview
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
There is no separate toast for it: the profile's `Update profile` and
`Discard changes` actions finish the session through the existing path that
resolves the latest queued foreground application. Update preserves the
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
