---
name: chromashift-profile-model
description: Use for profiles, persistence schemas and migrations, matching, activation precedence, optional color settings, or preview rollback.
---

# ChromaShift profile model

1. Read `AGENTS.md`, `docs/core-domain.md`, `docs/architecture.md`, and any active
   schema redesign plan before changing profile behavior.
2. Keep the model vendor-neutral and every color capability optional. An omitted
   capability means captured baseline.
3. Preserve precedence: manual override, foreground application, Default,
   baseline. Deduplicate only successful activation targets.
4. Version persistence changes and provide explicit migrations with fixtures.
   Never silently reset or overwrite `%APPDATA%\ChromaShift\profiles.json`.
5. Preview must use the native service's existing immutable baseline, suspend
   automatic writes, and restore the exact prior automatic/manual target on
   cancel, navigation, reset, or failure.
6. The pending per-display redesign is governed by
   `docs/per-display-profile-settings-plan.md`; do not begin its UI until approved
   Figma interactions settle the documented open questions.
