# Changelog

All notable changes to ChromaShift will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0-preview.7] - 2026-10-03

### Added

- ChromaShift artwork on the installer and uninstaller welcome and finish pages.

### Changed

- Windows elevation prompts identify the installer as ChromaShift.
- Documented the SmartScreen reputation warning that can appear for signed releases.

### Fixed

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

[Unreleased]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.6...HEAD
[0.1.0-preview.6]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.5...v0.1.0-preview.6
[0.1.0-preview.5]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.4...v0.1.0-preview.5
