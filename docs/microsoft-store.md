# Microsoft Store distribution

Research checked against Microsoft's documentation on 2026-10-10. This is
preparation for a second download option; no Store account, submission, or
publication has been performed.

## Recommended route

Submit ChromaShift as an **EXE/MSI app**, using its signed, offline NSIS installer,
while continuing direct downloads. Microsoft accepts this route for existing
Win32 applications. The publisher hosts and signs the installer, and the app
handles updates. MSIX instead provides Store signing, hosting, and built-in
updates. [Distribution comparison](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path).

For ChromaShift, EXE submission is the smallest change. The current package
already contains Electron, the self-contained C# helper, and its native
dependencies. Its updater waits for confirmed display restoration before running
NSIS. Reusing that installation model preserves one install location and the
existing data and update contracts. See [packaging](packaging.md),
[signing](signing.md), and [architecture](architecture.md).

MSIX is a possible later project, not a prerequisite. Full-trust packaged desktop
apps are supported; MSIX does not require rewriting ChromaShift as UWP. However,
its protected install directory and package identity introduce different runtime
and deployment behavior. ChromaShift would need a separate review of updates,
AUMID/notifications, app-data behavior, native DLL loading, helper startup,
shortcuts, tray lifetime, and restoration during Store updates.
[MSIX containerization](https://learn.microsoft.com/en-us/windows/msix/msix-containerization-overview),
[desktop packaging preparation](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-prepare).

## Account setup

For this personal open-source project, use an Individual developer account.
Microsoft's current onboarding is free when started through
[storedeveloper.microsoft.com](https://storedeveloper.microsoft.com/). Sign in
with a personal Microsoft account, complete Microsoft's identity verification
yourself, and finish the Partner Center profile. That verification includes a
government-issued ID and selfie. Legacy entry points can still show the older
registration flow. Choose Company only when publishing for a registered business;
Microsoft does not support converting an Individual account into Company later.
[Account setup instructions](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account).

Then open Partner Center's Apps & games page, select **New product**, choose
**EXE or MSI app**, check whether **ChromaShift** is available, and reserve the
product name. Unused reservations expire after three months. Record the product
ID and chosen publisher display name for the listing and eventual website link.
[Name reservation instructions](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/reserve-your-apps-name).

Store enrollment and Azure Artifact Signing are separate accounts and approvals.
Keep the existing validated Authenticode identity. The Store does not re-sign
EXE/MSI installers. A Store display name does not replace the certificate's legal
publisher subject. [Store signing guidance](https://learn.microsoft.com/en-us/windows/apps/publish/get-started).

## Installer and release requirements

Microsoft requires an offline EXE or MSI, an immutable version-specific HTTPS
download URL, silent installation, and CA-trusted signatures on the installer
and **all Portable Executable files** in its payload. Each new installer needs a
new versioned URL submitted through Partner Center. A moving `latest` URL is
unsuitable. [EXE/MSI package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements).

Use a public version-specific release asset once its bytes and signatures are
final, or an equivalent immutable URL on ChromaShift's download hosting. Verify
unauthenticated downloads before submission. Enter EXE, x64, English, and the
tested silent parameters in Partner Center. The current package smoke invokes
NSIS with `/S`; validate `/S /currentuser` as the Store parameters without the
smoke's custom directory override, including exit codes and app launch behavior.
That exact Store invocation has not been tested in this work. Partner Center
supports return-code mappings for EXE installers.
[Package fields and installer handling](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/upload-app-packages).

The release signing gate checks the installer, application, display helper, and
uninstaller, and now signs unsigned Portable Executable files in the unpacked
payload before NSIS embeds them. It preserves valid vendor signatures and checks
the full payload again after installer creation. The signed Preview 14 workflow
and an audit of its extracted installer payload verified this gate on 2026-10-31.
All four previously unsigned DLLs had valid, timestamped maintainer signatures;
the existing Microsoft signature was preserved. A local `release/win-unpacked` audit on 2026-10-10, application
FileVersion `0.1.0-preview.12`, found `ffmpeg.dll`, `libEGL.dll`, `libGLESv2.dll`,
and `resources/display-service/NvAPIWrapper.dll` unsigned. The application,
helper, and `elevate.exe` had valid maintainer signatures; `d3dcompiler_47.dll`
had a valid Microsoft signature. This is a local snapshot, not an audit of a
public installer. Sign and verify the four DLLs, preserve valid third-party
signatures and LGPL replacement rights, and audit the final installer payload.

Keep the current user-requested updater for the EXE route. Changing the Store's
installer submission makes the newer installer available to new installs; it
does not push an update to existing users. Continue submitting each release's
new immutable installer URL. [EXE update guidance](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/publish-update-to-your-app-on-store),
[distribution comparison](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path).

## Automatic release submission

`.github/workflows/microsoft-store.yml` runs after a GitHub release is published,
including previews. It is separate from tag-time packaging because the Store
needs a public installer URL. The existing update-feed workflow runs independently.
Publishing a release remains the maintainer's decision; Store certification still
decides when the new version becomes available there.

The submission script verifies the repository's numeric identity, published tag,
installer name and size, and anonymous download access. It rejects older releases
when a newer release is public or the Store package is newer. It expects exactly
one existing x64 EXE package using a versioned ChromaShift GitHub release URL and
validated silent parameters. It PATCHes only that package's URL, commits package
ingestion, waits up to ten minutes for readiness, and creates the submission.
It preserves the existing installer parameters, return-code mappings, languages,
listing text, screenshots and pricing. Certification notes and listing updates
remain Partner Center work. Do not leave unrelated draft edits in Partner Center
while automatic submission is enabled: Microsoft submits the entire current draft.

Complete this setup before enabling automatic runs:

1. Create the product and first submission in Partner Center, including age ratings,
   listing assets, a real versioned installer URL and validated silent parameters.
   Confirm the final installer meets the full-payload signing requirement above.
2. Associate a Microsoft Entra application with Partner Center and grant it the
   Manager role required by the EXE/MSI submission API. Verify this association is
   available for your account. The existing Azure signing identity alone does not
   grant Partner Center access.
3. Create a GitHub environment named `microsoft-store`. Add environment variables
   `STORE_TENANT_ID`, `STORE_CLIENT_ID`, `STORE_SELLER_ID` and `STORE_PRODUCT_ID`.
   Add `STORE_CLIENT_SECRET` as an environment secret. Store no credential values
   in source, issues or chat. Track the secret's expiry and rotate it in Entra and
   GitHub before it expires.
4. Run **Submit Microsoft Store update** manually in GitHub Actions. Enter the
   published tag and leave **dry_run** selected. This authenticates and validates
   the package without changing or submitting the Store draft.
5. After the dry run and Store-specific installer checks pass, set the repository
   variable `MICROSOFT_STORE_ENABLED` to `true`. Subsequent published releases are
   submitted automatically. A manual run with **dry_run** cleared also requires
   this variable. Leave it unset or `false` until the initial Store setup is ready.

Runs are serialized and never canceled by newer releases. An active certification,
API error or ingestion timeout fails the job instead of silently reporting a
submission. The Actions summary records the installer URL and submission ID;
success means submitted, not certified or published. Check certification progress
and any rejection in Partner Center. A Store failure does not unpublish GitHub
assets or roll back the independent in-app update feed.

A repeated installer URL produces an `unchanged` result without a second submission.
If a run fails after PATCHing the package, inspect and finish that draft in Partner
Center before retrying; the unchanged result is not proof it was submitted. A lost
response from the submission request also requires checking Partner Center before
retrying. Automated retries of write requests are deliberately avoided.

Protocol tests run without credentials or Store writes:

```powershell
node --test scripts/microsoft-store.test.mjs
```

The workflow is prepared locally, but account association, a live dry run,
certification and Store publication have not been verified.
[Microsoft's EXE/MSI submission API and prerequisites](https://learn.microsoft.com/en-us/windows/apps/publish/store-submission-api).

## Listing and certification preparation

Prepare the category, free pricing, selected markets, age-rating questionnaire,
English description, applicable license terms, at least one desktop screenshot,
and square Store box art. Four or more screenshots and portrait art are
recommended. Keep the direct download option on the website and add the Store
link once the product is live. [Submission checklist](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/create-app-submission).

Declare Windows 11 and the actual display/GPU limitations in the listing.
Describe AMD writes as hardware-unverified. Include support and website URLs in
their designated fields. [Listing guidance](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/add-and-edit-store-listing-info),
[support fields](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/support-info).

Win32 apps require a privacy policy even when product data stays local. Reuse
[PRIVACY.md](../PRIVACY.md). Its public raw GitHub URL returned HTTP 200 during
this research. Check that the policy fully describes accessed data, retention,
storage/security, user controls, network requests, and third-party recipients.
The website currently links the GitHub policy; a permanent policy page on
`chromashift.io` would make the listing easier to maintain.
[Policy 10.5.1](https://learn.microsoft.com/en-us/windows/apps/publish/store-policy-archive/store-policy-7-19#105-personal-information).

Certification notes should explain the tray, global shortcuts, foreground
application observation, helper process, Windows/vendor display API usage,
HDR filtering, restoration on exit, and update shutdown. The helper is a child
process, not an installed Windows service. ChromaShift installs no driver and
does not inject into applications. Its NVIDIA/AMD controls depend on vendor
drivers already installed on the device. Disclose those dependencies for review;
Microsoft may require approval for non-Microsoft driver dependencies. NVIDIA
vibrance and hue currently use private NVAPI function IDs, as documented in
[third-party notices](third-party.md). Policy 10.2.8 requires supported methods
for changing Windows settings, so disclose this implementation for certification
review rather than assuming acceptance. Provide steps to test supported controls
and restore the original state.
[Product declarations](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/product-declarations),
[policy 10.2.4](https://learn.microsoft.com/en-us/windows/apps/publish/store-policy-archive/store-policy-7-19#102-security).

This route is technically suitable, but Store certification remains unverified.
Existing local checks do not prove Microsoft's approval. Keep the normal release
and restoration gates, then address specific certification feedback.

On the research date, policy 7.19 is effective. Microsoft's current policy page
already displays 7.20, which takes effect on 2026-10-22. Recheck the applicable
version before submission. [Policy 7.19](https://learn.microsoft.com/en-us/windows/apps/publish/store-policy-archive/store-policy-7-19),
[policy 7.20](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).
