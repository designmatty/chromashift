# Changelog

All notable changes to ChromaShift will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0-preview.18] - 2026-11-23

### Added

- On AMD displays, brightness, contrast, saturation, hue and color temperature
  now apply while Windows HDR is on, in profiles, previews and overrides. Gamma
  stays SDR-only: it keeps its value and applies when HDR turns off. Verified on
  an integrated Radeon GPU; see the
  [display research](https://github.com/designmatty/chromashift/blob/v0.1.0-preview.18/docs/display-research.md#amd-hdr-hardware-record-122).

### Fixed

- On AMD displays, neutral hue and color temperature now leave the display at
  AMD's neutral settings. Before, a profile on an AMD display applied the
  strongest hue shift even with hue left at 0°.
- Gamma now works on AMD displays in SDR. It uses the same Windows gamma ramp as
  other displays, with the same read-back and exact restore. It stays disabled
  while HDR is on. AMD support is verified on an
  integrated Radeon GPU; see the
  [display research](https://github.com/designmatty/chromashift/blob/v0.1.0-preview.18/docs/display-research.md#amd-hardware-record-119).

## [0.1.0-preview.17] - 2026-11-20

### Added

- On NVIDIA displays, saturation and hue now apply while Windows HDR is on, in
  profiles, previews and overrides. Brightness, contrast and gamma stay
  SDR-only: they keep their values and apply when HDR turns off. AMD and other
  displays still stay at their original settings while HDR is on.
- Displays in HDR show an HDR badge in the display tabs and in the mini panel's
  display picker.

### Changed

- The HDR notice is a short warning in both panels. Controls that HDR turns off
  say "Disabled while HDR is on."
- A learned gamma limit shows on the shield icon only, not on the slider.

### Fixed

- If ChromaShift can't confirm that a display was restored after a failed
  write, it stops further writes and enters Safety blocked instead of reporting
  only the write error.
- A display that switches to HDR in the middle of an apply, for example when a
  game turns HDR on, no longer receives brightness, contrast or gamma changes
  meant for SDR.

## [0.1.0-preview.16] - 2026-11-16

### Added

- Hold to compare: while a profile has unsaved color changes, hold the button
  to see the saved profile on your displays. Release it to return to your
  changes.
- ChromaShift learns each display's gamma limits. When a display rejects a
  gamma value, it steps toward neutral, keeps the first value the display
  accepts, and remembers that limit. Settings → Displays can reset learned
  limits.
- An End preview shortcut, unassigned by default.
- Diagnostics has a level filter and search, and shows details as formatted
  JSON.
- About links to the release notes, the repository and the license.
- The mini panel's picker shows a Live badge on the profile in use, profile
  icons and hotkeys, and a count of disabled profiles.

### Changed

- Switching between previews goes straight from one profile to the next,
  without showing the live profile in between.
- Closing a panel with unsaved changes reverts them, the same as Discard
  changes. Minimizing still keeps them.
- Applications are now called Triggers and sit above the color controls. The
  profile hotkey shows in the profile header, which stays pinned while the
  profile scrolls.
- Settings pages have a Back button, and Esc goes back. Shortcuts are grouped
  into Safety, Control, Navigation and Profiles. Startup window is disabled
  while Launch at startup is off.
- After Restore original settings, a message offers Resume.
- Buttons, inputs and panels have a subtle raised and recessed look in both
  themes.

### Removed

- Windows notifications and tray balloons. Clicking one took focus from your
  app, which could switch profiles. Status stays visible in the app, the mini
  panel and the tray.
- The Saved badge.

### Fixed

- Clicking the taskbar, the tray, Start, Search, Quick Settings or
  Notification Center no longer switches your displays to the Default profile.
- Turning on HDR during a preview or edit restores original settings right
  away, keeps your changes, and reapplies them when HDR turns off.
- If ChromaShift can't confirm that a preview was restored, it stays Safety
  blocked with Retry instead of reporting success.
- Diagnostics no longer repeats display capability entries on every profile
  switch.

## [0.1.0-preview.15] - 2026-11-07

### Added

- Click a profile to preview it on your displays without applying it. Editing a
  preview has Update profile and Discard changes actions, and leaving with
  unsaved changes asks first.
- An Automatic | Manual toggle and a single title-bar status pill that shows
  Active, Previewing, Auto-switching on hold, Paused, or Safety blocked.
- A color temperature control, neutral markers on every slider, a reset to
  neutral action per control, and a Copy to action for display settings.
- Gamma sliders show the range each display can't accept as hatched limits.
- A Paused overlay with Resume over the Profiles pane and the mini panel's
  controls.
- Quitting with unsaved changes asks whether to update or discard them.

### Changed

- Profiles without settings for a display preview that display at its original
  settings.
- Selecting a profile or changing mode while Paused stays Paused. Restore
  original settings now pauses display control.
- Values are edited inline; the mouse wheel changes a value only while its
  editor is open. Disabled sliders appear in grayscale.
- Minimizing keeps an unsaved draft, and long profile names truncate with the
  full name in a tooltip.

### Fixed

- Closing the app while a preview's restore fails keeps the window open with
  Try again guidance instead of hiding it with displays still changed.
- Opening the app from the tray or a notification shows the requested view after
  the renderer was released.
- Loading screens use the selected light or dark theme.

## [0.1.0-preview.14] - 2026-10-31

### Added

- None.

### Changed

- Signed releases now sign unsigned payload DLLs and verify all packaged Portable
  Executable signatures while preserving valid vendor signatures.
- Updated Electron and compatible dependencies to patched versions required by
  the release security audit.

### Fixed

- Release validation rejects unsigned, invalid, or untimestamped payload binaries
  before publication.

## [0.1.0-preview.12] - 2026-10-04

### Added

- An explicit Save action for captured shortcuts and an overflow menu to remove
  existing bindings.

### Changed

- Shortcut settings use compact keycaps that become an inline recorder when
  clicked. Escape or clicking elsewhere discards an unsaved replacement.

### Fixed

- Shortcut labels, errors, and confirmations use Windows key names such as Ctrl
  and Win.
- Longer captured shortcuts remain fully visible in the recording input.
- Release-feed verification waits for cached metadata to refresh after deployment.

## [0.1.0-preview.11] - 2026-10-04

### Added

- A Cloudflare release feed with automatic publication after GitHub releases.

### Changed

- Update checks use `updates.chromashift.io`, allowing future repository moves
  without changing the update address in installed clients.

### Fixed

- Signed Windows packages include the updater configuration required to download
  installers, fixing the download and verification failure in Preview 9 and 10.
- Packaging and release checks reject a missing updater cache configuration.

## [0.1.0-preview.10] - 2026-10-04

### Added

- None.

### Changed

- Preview edits wait for pending rollback before starting a fresh session.

### Fixed

- Continuing a mini-panel slider adjustment through the saved profile value no
  longer sends an update to a cancelled preview or shows "No preview is active."
- Successful preview updates and resets clear stale preview error messages.

## [0.1.0-preview.9] - 2026-10-03

### Added

- Update checks in About, with preview-aware version comparison and automatic
  installer downloads.
- Update installation verifies the release hash and Windows publisher signature
  and waits for confirmed display restoration before running the installer.

### Changed

- About shows update download progress and offers Restart and install when the
  verified installer is ready.

### Fixed

- About shows the actual time of the last successful update check instead of a
  placeholder date.

## [0.1.0-preview.8] - 2026-10-03

### Added

- Ownership checks that preserve shortcuts belonging to other Electron applications.

### Changed

- Development notifications use a separate identity from installed ChromaShift.
- Uninstall validation documents the stale app entries Windows 11 can retain in Start.

### Fixed

- Development notifications clean up their bare Electron Start menu shortcut,
  preventing an Electron shell launcher from remaining after ChromaShift exits.
- Development and test runners remove owned shortcut leftovers after Electron exits,
  including leftovers from earlier runs and forced exits.
- Updated the desktop smoke check to follow the current Diagnostics wording.

## [0.1.0-preview.7] - 2026-10-03

### Added

- ChromaShift artwork on the installer and uninstaller welcome and finish pages.

### Changed

- Windows elevation prompts identify the installer as ChromaShift.
- Documented the SmartScreen reputation warning that can appear for signed releases.

### Fixed

- Converted the supplied sidebar artwork to the BMP format supported by NSIS.
- Release builds sign the generated uninstaller before embedding it, so uninstall
  can identify the verified publisher after upgrading to the updated installer.
- Release preflight verifies the uninstaller extracted from the finished installer.

## [0.1.0-preview.6] - 2026-10-03

### Added

- Profile reordering events in Diagnostics to trace drag interactions and saved order.
- Copy logs, Download logs, and Clear logs actions with brief inline confirmations.
- Interactive website demos with selectable scenes, color controls, and a draggable mini panel.

### Changed

- Replaced custom sidebar drag handling with dnd-kit optimistic sorting.
- Tightened the Diagnostics layout so log entries sit closer to their actions.

### Fixed

- Reordering profiles no longer resets activation or reapplies an unchanged profile.
  Application matching still respects the saved profile priority.
- Retained the dropped order until persistence confirms it to prevent items snapping back.
- Removed the vulnerable HTTP cache dependency from Electron Builder's download tooling.

## [0.1.0-preview.5] - 2026-10-01

### Added

- Per-control neutral reset actions and icons for the established color controls
  in the app and mini panel.
- Collapsible profile and settings sidebars with a shared persisted state.

### Changed

- Replaced profile activation and automatic-switching toggles with one sidebar
  profile selector. Profile navigation now distinguishes Current, Will resume,
  and Pending selections from Enabled and Disabled availability; display control
  reports Active, Paused, and Safety blocked separately.
- The profile selector shows the resolved profile in Automatic mode and assigned
  keyboard shortcuts alongside its dropdown options. Its popover uses a listbox
  with fully rounded rows, left-side radio indicators, and a divider after Automatic.
- Replaced monitor accordions with display tabs and aligned read-only profile
  views with the disabled edit layout.
- Removed the display-level override checkbox. Every connected display tab now
  shows its values immediately, and the first edit creates a neutral target when
  one does not already exist.
- Assigned displays now persist a complete neutral-relative color vector. Schema
  version 3 completes legacy partial values and removes remembered inactive
  values without showing an in-app migration notice.
- Gamma bounds now follow the active brightness value. Sliders show unavailable
  portions of the physical gamma range and number inputs update immediately.
- Unsupported color values remain in profiles while native requests include only
  controls supported by every endpoint for the physical display.

### Fixed

- Updated Electron, Wrangler, and affected transitive dependencies to resolve
  the dependency-audit findings that blocked canonical verification.
- Installed Electron's binary before parallel desktop tests to prevent
  overlapping extraction failures after a clean dependency install.
- The mini-panel profile picker labels the permanent profile Default rather than Global.
- Restored the complete display baseline when a gamma write or verification is
  rejected, with a clear user-facing failure message and diagnostic color tuple.

[Unreleased]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.18...HEAD
[0.1.0-preview.18]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.17...v0.1.0-preview.18
[0.1.0-preview.17]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.16...v0.1.0-preview.17
[0.1.0-preview.16]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.15...v0.1.0-preview.16
[0.1.0-preview.15]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.14...v0.1.0-preview.15
[0.1.0-preview.14]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.12...v0.1.0-preview.14
[0.1.0-preview.12]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.11...v0.1.0-preview.12
[0.1.0-preview.11]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.10...v0.1.0-preview.11
[0.1.0-preview.10]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.9...v0.1.0-preview.10
[0.1.0-preview.9]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.8...v0.1.0-preview.9
[0.1.0-preview.8]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.7...v0.1.0-preview.8
[0.1.0-preview.7]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.6...v0.1.0-preview.7
[0.1.0-preview.6]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.5...v0.1.0-preview.6
[0.1.0-preview.5]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.4...v0.1.0-preview.5
