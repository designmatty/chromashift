---
name: chromashift-display-safety
description: Use for DisplayService, Windows GPU/display providers, foreground events, HDR, topology, baselines, restoration, or hardware validation.
---

# ChromaShift display safety

1. Read `AGENTS.md`, `docs/display-research.md`, `docs/native-protocol.md`, and
   `docs/testing.md` before changing native behavior.
2. Keep Windows/GPU interaction in `DisplayService`; keep matching and product
   behavior in TypeScript.
3. Capture one immutable pre-ChromaShift baseline, restore it before applying a
   complete desired state, validate and clamp every value, read writes back, and
   roll back the full display after partial failure.
4. Treat omitted settings as baseline, never as fixed neutral values. Do not
   compound transforms across profiles.
5. Reacquire native handles after topology changes. Gate unsafe Windows gamma
   controls while HDR is active.
6. Do not claim AMD or topology behavior is hardware-verified without the
   corresponding real test. Use mild values and retain a restoration guard.
7. For locked `DisplayService`, exit the owning ChromaShift instance through its
   restore-safe tray Exit path; do not force-kill it.
