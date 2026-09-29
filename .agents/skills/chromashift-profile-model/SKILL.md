---
name: chromashift-profile-model
description: Use for profiles, persistence schemas and migrations, matching, activation precedence, color settings, or preview rollback.
---

# ChromaShift profile model

1. Read `AGENTS.md`, `docs/core-domain.md`, `docs/architecture.md`, and
   `docs/per-display-profile-settings.md` before changing profile behavior.
2. Keep the model vendor-neutral. Every assigned target persists the complete
   color vector; a missing target means captured baseline. Filter unsupported
   fields only at the native-command boundary.
3. Preserve precedence: manual override, foreground application, Default,
   baseline. Deduplicate only successful activation targets.
4. Version persistence changes and provide explicit migrations with fixtures.
   Never silently reset or overwrite `%APPDATA%\ChromaShift\profiles.json`.
5. Preview must use the native service's existing immutable baseline, suspend
   automatic writes, and restore the exact prior automatic/manual target on
   cancel, navigation, reset, or failure.
6. Preserve schema-v3 and Default-profile semantics. Treat the current
   implementation as the profile UI source of truth.
