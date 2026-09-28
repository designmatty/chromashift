# chromashift.io

The product website is a static Vite build of one semantic HTML page, plain CSS,
and a small TypeScript module. It is served by an assets-only Cloudflare Worker
with Workers Static Assets. The canonical production origin is
`https://chromashift.io`.

```powershell
npm run website:dev
npm run website:build
npm run test --workspace @chromashift/website
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
- The hero app-panel image is still the design's placeholder slot. Replace it
  with a `public/media/app-profiles.webp` capture at 2000 × 1400 before
  production launch.

## Generated images

The favicons, app icons, header mark, and 1200 × 630 social card in `public/`
are committed. They are generated from the root brand PNGs and
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
