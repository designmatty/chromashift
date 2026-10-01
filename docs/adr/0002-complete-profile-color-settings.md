---
status: accepted
---

# Complete profile color settings with capability-filtered native commands

Each assigned profile display target persists a complete vendor-neutral color
vector. The neutral vector is brightness 50, contrast 50, gamma 1, saturation
50, hue 0, and color temperature 50. A missing display target means the captured
original state; individual fields are not enabled or disabled.

Complete values make the app and mini panel predictable, allow each control to
reset independently, and keep read-only and edit views structurally identical.
Values remain persisted when the current adapter cannot apply them so profiles
survive hardware and topology changes without losing user intent.

Electron intersects endpoint capabilities and sends only supported fields to the
native helper. Native command settings therefore remain partial: omission at
that boundary means restore or retain the captured baseline for that capability.
The helper continues to own baseline capture, validation, read-back, rollback,
and restoration.

Schema version 3 completes legacy partial vectors with neutral values, removes
`lastColorValues`, and clamps gamma to the brightness-dependent safety envelope.
Migration changes are recorded in structured diagnostics without an in-app
notification.
