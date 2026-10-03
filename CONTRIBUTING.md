# Contributing

Issues and pull requests are permitted. This policy is permission to use those
GitHub features, not a request for contributions. There is no promise of review,
acceptance, response, or support, and the maintainer may close submissions for
any reason.

Contributors are not required to sign a Contributor License Agreement. By
submitting a contribution, you agree that it may be distributed under the
repository's MIT license.

Before opening a pull request, run `npm run verify` on Windows. Changes involving
real display behavior or Electron desktop interaction also need the relevant
hardware or desktop smoke command described in `docs/testing.md`. A passing test
does not guarantee that a pull request will be merged.

## Import aliases

Use these aliases for all source imports within each app, including sibling
modules, tests, lazy imports, and assets. ESLint rejects relative module imports
under `apps/*/src`. TypeScript, Vite, and Vitest
resolve the same directories.

| App and context          | Alias       | Directory                    |
| ------------------------ | ----------- | ---------------------------- |
| Desktop renderer         | `@/`        | `apps/desktop/src/renderer/` |
| Desktop main and preload | `@main/`    | `apps/desktop/src/main/`     |
| Desktop main and preload | `@preload/` | `apps/desktop/src/preload/`  |
| Desktop all contexts     | `@shared/`  | `apps/desktop/src/shared/`   |
| Website                  | `@/`        | `apps/website/src/`          |

Keep the `.js` extension in desktop main, preload, and shared TypeScript imports
to match their NodeNext module resolution. For example, use
`@main/renderer-security.js` or `@shared/product-api.js`. Renderer and website
imports can omit the extension, such as `@/components/ui/provider` or
`@/demo-model`.

Keep imports between workspaces on their package names, such as
`@chromashift/core` and `@chromashift/native-client`. App aliases do not expose
main or preload modules to the renderer and apply only to code processed by
the app's build or test runner. Standalone Node scripts use relative imports.

Desktop renderer brand PNGs live in `apps/desktop/src/renderer/assets/brand` and
are imported through `@/assets/brand/`. Website brand originals live in
`apps/website/src/assets/brand`; its asset generator creates the optimized images
under `public/icons`. These app-local copies preserve the original PNG bytes.
When updating the brand, update each app's copies as well.
