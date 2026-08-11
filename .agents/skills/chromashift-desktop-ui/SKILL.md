---
name: chromashift-desktop-ui
description: Use for ChromaShift renderer, Chakra UI, app-panel, mini-panel, theme, accessibility, and real desktop interaction work.
---

# ChromaShift desktop UI

1. Read `AGENTS.md`, `docs/architecture.md`, and `docs/testing.md` first.
2. Keep `src.tsx` as bootstrap only. Put product surfaces under
   `src/renderer/features`, shared layout under `components/layout`, compound
   Chakra adapters under `components/ui`, and product/theme hooks under `hooks`.
3. Use Chakra UI v3 and semantic tokens. Do not add Tailwind, shadcn, Base UI,
   React Router, or another UI/state library without a concrete reviewed need.
4. Keep the renderer sandboxed and use only the narrow `window.chromaShift`
   preload API. Never import Node or native-client functionality into renderer code.
5. Preserve the native app frame and the pointer-oriented, non-activating mini
   panel. Mini-panel work must retain drag, close, position, taskbar z-order, and
   no-keyboard-focus behavior.
6. Preserve existing DOM accessibility labels and smoke-test selectors when
   practical; update the smoke intentionally when the approved UX changes them.
7. Run `npm run format:check`, `npm run lint`, `npm run typecheck`, tests, build,
   and `npm run smoke:desktop`. Inspect the real app and mini panel after changes.
