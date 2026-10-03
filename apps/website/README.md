# chromashift.io

The product website is a static Vite build of one semantic HTML page, plain CSS,
and a small TypeScript module. It is served by an assets-only Cloudflare Worker
with Workers Static Assets. The canonical production origin is
`https://chromashift.io`.

```powershell
npm run website:dev
npm run website:build
npm run test --workspace @chromashift/website
npm run smoke --workspace @chromashift/website
```

## Page behavior

- `index.html` follows the approved Claude Design reference
  `ChromaShift Website v3.dc.html`. `404.html` is served for unknown paths.
- Styles live in `src/styles`, one file per page section. Geist and Geist Mono
  are self-hosted from the Fontsource packages.
- Every download link points to GitHub releases in static HTML.
  `src/release.ts` then asks the GitHub releases API for the newest non-draft
  release with an x64 installer and links it directly. If that request fails,
  the releases-page fallback stays in place.
- Static metadata names no release version or channel.
- The hero is an HTML and CSS replica of the dark app panel, laid out at its
  1044 × 680 window size and scaled to fit. Icons are inline Lucide 1.31.0 SVG
  symbols, the same set the desktop app uses. Hover or focus the replica to
  reveal **Try it out**; touch screens show the action without hovering.
- **Try it out** opens a native modal dialog. A screenshot, shown whole with
  `object-fit: contain`, stands in for the monitor and a copy of the mini panel
  floats above it. Drag the panel by its title bar. The bottom row switches the
  foreground app (Escape from Tarkov, Rust, Blender, Figma) and the time of
  day, beside **Hold to compare**.
- A guided tour (`src/demo-tour.ts`) spotlights the panel, its sliders, the app
  switcher, day and night, and **Hold to compare**. It starts on the first open,
  is remembered in `localStorage`, and never blocks the demo. Escape, its close
  button, or **Skip tour** dismiss it; **Tour** restarts it.
- The demo follows the app's activation rules in memory. Automatic mode
  resolves the foreground app's profile, then Default; Figma has no profile.
  Executable names match case-insensitively, as on Windows. Tarkov and Rust
  also have night profiles that the demo selects for their night scenes. This
  is a demo-only refinement: the desktop app matches profiles by executable
  alone.
  The picker makes a manual selection. Slider changes show **Reset changes**
  and **Update profile**. Power pauses, the restore button shows the original
  until the next change, and **Hold to compare** shows it while pressed.
  Updating the Escape from Tarkov profile also updates the hero replica.
- `src/demo-model.ts` mirrors the app's control ranges and brightness-dependent
  gamma envelope. Brightness, contrast, and gamma use a port of the display
  helper's `GammaRampTransform` as an SVG lookup table. Saturation and hue use
  CSS `saturate()` and `hue-rotate()`. Filters affect only the screenshot.
- Screenshots load when the demo opens or an app is chosen. They are
  self-hosted, and each scene shows its credit. Sources and asset rights are
  recorded in [demo-media.md](demo-media.md).
- The browser smoke runs against the production build with its CSP, using the
  existing Electron runtime. It checks the demo's interactions and pixel
  changes, then writes desktop and mobile captures to `out/smoke`. It never
  starts the display helper or changes displays.

## Generated images

The favicons, app icons, mini-panel mark, full header logo, and 1200 × 630
social card in `public/`
are committed. They are generated from the website's brand PNGs in
`src/assets/brand/` and
`social/social-card.html`:

```powershell
npm run render:assets --workspace @chromashift/website
```

The script uses the Electron runtime that the desktop workspace already
installs. Run it only after a full `npm install`.

## Deployment channels

`deployment.ts` reads the Workers Builds environment at build time:

| Build                            | Channel    | Web Analytics beacon        | `X-Robots-Tag: noindex` |
| -------------------------------- | ---------- | --------------------------- | ----------------------- |
| Workers Builds on `main`         | production | when the token is set       | no                      |
| Workers Builds on other branches | preview    | never                       | yes                     |
| Local build                      | production | only with an explicit token | no                      |

The build writes `_headers` with a content security policy that allows only
the site itself, the Cloudflare Web Analytics beacon, and the GitHub releases
API. Fingerprinted `/assets/*` files are cached immutably.

Cloudflare Web Analytics gives aggregate, cookie-free traffic and performance
statistics. The site adds no cookies, fingerprinting, custom events, advertising
pixels, or consent banner. Cloudflare's automatic beacon injection does not
apply to Workers, so the build injects the manual snippet.

## Cloudflare setup

These are dashboard steps. None of them change DNS.

1. **Web Analytics.** Add a site for `chromashift.io` with manual JS snippet
   installation, then copy the site token.
2. **Workers Builds.** Create a Worker from this Git repository with these
   settings:
   - Worker name: `chromashift`, matching `name` in `wrangler.jsonc`
   - Production branch: `main`
   - Root directory: `apps/website`
   - Build command: `npm ci && npm run build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch builds: enabled, with the default preview command
   - Build watch paths: include `apps/website/*` and `package-lock.json`
   - Build variables: `NODE_VERSION=24.11.1`, `SKIP_DEPENDENCY_INSTALL=1`, and
     `CLOUDFLARE_WEB_ANALYTICS_TOKEN=<site token>`

   Running `npm ci` inside `apps/website` installs only this workspace from the
   root `package-lock.json`. It does not install the Electron desktop toolchain.
   Wrangler is pinned as a workspace dev dependency, so `npx wrangler` uses that
   locked version instead of downloading one during the build.

   Until a custom domain is attached, production is served at the Worker's
   `workers.dev` URL. Its canonical and social URLs still point to
   `https://chromashift.io`.

## Production domain (requires explicit authorization)

Do not do this without the owner's approval. When approved:

1. Attach `chromashift.io` as a Worker custom domain in the dashboard, or add
   this to `wrangler.jsonc`:
   `"routes": [{ "pattern": "chromashift.io", "custom_domain": true }]`.
   Either one creates the DNS record for the hostname.
2. Redirect `www.chromashift.io` to the apex, for example with a Cloudflare
   redirect rule.
3. After the custom domain serves correctly, consider setting
   `"workers_dev": false` so the `workers.dev` copy stops serving production.
   Keep `"preview_urls": true`, and confirm the next branch build still gets a
   preview URL.
4. Check `https://chromashift.io/`, `/robots.txt`, `/sitemap.xml`, and
   `/media/social-card.png`. Confirm the response headers and that Web Analytics
   receives page views.
