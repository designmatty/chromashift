---
name: chromashift-packaging-release
description: Use for Electron Builder, DisplayService sidecar packaging, shutdown, installer smoke, signing, versioning, CI, or release automation.
---

# ChromaShift packaging and release

1. Read `AGENTS.md`, `docs/packaging.md`, and `docs/testing.md` first.
2. Keep application code inside ASAR and the self-contained `DisplayService`
   under `resources/display-service`. Resolve packaged paths only from
   `process.resourcesPath`.
3. Every exit path must use the restore-safe shutdown coordinator. A restore
   failure keeps the application and helper alive for retry.
4. CI runs the canonical `npm run verify` command on Windows. Real display smoke,
   crash restoration, packaged install/upgrade/uninstall, and hardware matrix
   checks require suitable interactive Windows hardware and must not be inferred
   from a hosted CI build.
5. Release automation must verify package/tag version agreement, serialize
   releases, preserve user data, and expose signing hooks without storing secrets.
