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
   Prefer existing Chakra colors, such as `red.solid` or a `{ base, _dark }` pair,
   over a new semantic color token.
   Surfaces follow one treatment, defined in `theme/system.ts`:
   - Raised (`shadow="raised"`): buttons, selects, the selected segment, tab,
     profile row, or settings nav item, and slider thumbs. It adds a lit 1px top
     edge, a hairline ring, and a soft lift. The button recipe applies it to
     solid, subtle, surface, and outline variants; set it on Select and
     NativeSelect parts directly. Ghost and plain stay flat. Settings rows stay
     flat; the raised look is too heavy on large stacked surfaces.
   - Recessed (`shadow="recessed"`): text inputs and segment or tab tracks. The
     input recipe adds a `blackAlpha.50` fill, `blackAlpha.400` in dark mode.
     Segment and tab tracks use `bg.muted`, `bg` in dark mode, so the track sits
     darker than its surroundings. The raised selection uses `bg.panel`,
     `bg.muted` in dark mode.
   - Panels and cards: a 1px border. In dark mode the top edge is
     `whiteAlpha.200`; light mode keeps `border` because white disappears against
     white panels. Use borders, not inset shadows, on scroll containers so sticky
     headers cannot hide the edge.
   - Focus rings are outlines, or Chakra's ring on slider thumbs, and stay
     visible over these shadows.
4. Keep the renderer sandboxed and use only the narrow `window.chromaShift`
   preload API. Never import Node or native-client functionality into renderer code.
5. Preserve native Windows caption behavior. The approved app-panel redesign may
   use Electron's hidden title bar with native `titleBarOverlay`; do not replace
   minimize, maximize, close, or Snap behavior with renderer-drawn caption
   buttons. Preserve the pointer-oriented, non-activating mini panel. Mini-panel
   work must retain drag, close, position, taskbar z-order, and no-keyboard-focus
   behavior.
6. Preserve existing DOM accessibility labels and smoke-test selectors when
   practical; update the smoke intentionally when the approved UX changes them.
7. Run `npm run format:check`, `npm run lint`, `npm run typecheck`, tests, build,
   and `npm run smoke:desktop`. Inspect the real app and mini panel after changes.
