# Changelog

All notable changes to ChromaShift will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Per-control neutral reset actions and icons for the established color controls
  in the app and mini panel.
- Collapsible profile and settings sidebars with a shared persisted state.

### Changed

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

- Restored the complete display baseline when a gamma write or verification is
  rejected, with a clear user-facing failure message and diagnostic color tuple.

[Unreleased]: https://github.com/designmatty/chromashift/compare/v0.1.0-preview.4...HEAD
