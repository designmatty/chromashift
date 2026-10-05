# Update service

Installed releases check `https://updates.chromashift.io/v1/releases.json` only
when the user chooses **Check for updates**. This address is independent of the
GitHub repository owner. Keep the domain active for the lifetime of those
installed clients. The service is separate from the product website.

## Publication

`apps/updates/wrangler.jsonc` deploys the `chromashift-updates` assets-only Worker.
It serves a versioned JSON feed with a 60-second cache lifetime, no database, and
no client analytics. Installers, block maps, and `latest.yml` remain on GitHub.
The desktop requires exact repository/version/filename agreement, SHA-512,
matching valid publisher signatures, cached-installer revalidation, and confirmed
display restoration before installing.

```powershell
npm run updates:build
npm run updates:deploy
npm run updates:smoke
```

Generation verifies GitHub repository ID `1328081965`, then uses its current
canonical name. Only public, complete releases with the expected installer,
block map, and `latest.yml` assets can enter the feed. The newest stable and
preview candidates are selected using SemVer. Preview clients may select a newer
stable release; stable clients never select a preview. An empty channel reports
an unavailable update channel rather than incorrectly reporting up to date.

`.github/workflows/update-feed.yml` regenerates and deploys on release
`published`, `edited`, and `deleted` events, or manual workflow dispatch. It uses
the current `main` publisher so old tags cannot restore old feed logic. Draft
creation by the signing workflow does not advertise a release. Publish releases
with a human-authenticated GitHub session or dispatch this workflow explicitly;
GitHub does not trigger additional workflows for events created with the
repository's `GITHUB_TOKEN`. If publishing metadata fails, the previous feed
remains available; retry with manual dispatch after fixing the deployment.
Post-deployment verification retries for up to 75 seconds to allow the previous
feed's 60-second cache lifetime and deployment propagation to expire.

## Cloudflare setup

The Worker uses `updates.chromashift.io` as a custom domain. It requires the
existing active `chromashift.io` Cloudflare zone. Local deployment uses
`npm exec --workspace @chromashift/website -- wrangler login`.

For GitHub Actions, configure these repository values:

- Secret `CLOUDFLARE_API_TOKEN`: a scoped Cloudflare token that can deploy Workers
  and their custom domain in the ChromaShift account and zone.
- Variable `CLOUDFLARE_ACCOUNT_ID`: the account containing that zone and Worker.

Use Cloudflare's **Edit Cloudflare Workers** API-token template, restricted to
the intended account and `chromashift.io` zone. Enter the token locally with
`gh secret set CLOUDFLARE_API_TOKEN`; never paste it into an agent conversation.
The workflow uses the `update-feed` GitHub environment. Add environment protection
only if release-feed deployments should require a separate human approval.

The feed must accept non-browser requests without a browser challenge. On the
Cloudflare Free plan, Bot Fight Mode cannot exempt a hostname or path. Turn it
off for the `chromashift.io` zone when using this feed. This also removes Bot
Fight Mode protection from the website; keep the other security settings enabled.
If Bot Fight Mode protection is required, use a plan with Super Bot Fight Mode
and a scoped exception instead. Confirm access from GitHub Actions as well as
locally, since a local HTTP 200 does not prove hosted update clients are allowed.
See [Cloudflare's Bot Fight Mode limitations](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/).

## Repository transfers

After a transfer, reconnect the repository's GitHub Actions and Cloudflare
publishing permissions and update Azure signing OIDC authorization. The
publisher verifies the same repository ID and gets canonical asset URLs from
GitHub. A local manual build can resolve the repository by ID even before its
new name is configured. Redeploy the feed after a transfer so installer URLs
use the new location. Keep the existing signing publisher identity.

Clients that predate the Cloudflare feed need a manual upgrade after a transfer.
Ship and install a release containing this update path before moving the repo.

## Verification

`npm run verify` covers the feed contract, selection, publication filtering,
transfer and rename cases, URL manipulation, repository replacement, bounded
responses, and existing updater safety behavior. `npm run updates:smoke` checks
the public response against generated metadata after deployment.

The isolated Electron download smoke checks the production feed, exact manifest,
installer hash, valid matching publisher, and cache revalidation without starting
DisplayService or NSIS:

```powershell
node apps/desktop/scripts/update-download-smoke.mjs <signed-app.exe> <installed-version> <update-version>
```
