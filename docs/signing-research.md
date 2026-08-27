# Windows release-signing options

Research checked on 2026-08-27. This note asks a narrow question: can
ChromaShift meet Milestone 8's Windows trust goal without buying and managing a
traditional code-signing certificate?

## Recommendation

Use Azure Artifact Signing Basic for the primary NSIS release. This decision was
accepted on 2026-08-27. Open-source publication is also part of Milestone 8, but
the project will not make signing depend on SignPath Foundation approval or use
SignPath's publisher identity. Azure Artifact Signing uses the selected validated
individual identity and works before or after the repository becomes public.

Azure Artifact Signing is the lowest-cost direct option found. Its Basic plan
costs $9.99 per account per month and includes 5,000 signatures.
[Microsoft recommends it for non-Store distribution](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options),
and its Public Trust certificates support Win32 Authenticode and Windows trust
features.
[Microsoft documents the trust model here](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models).

Microsoft Store distribution can be free without opening the source, but only
if ChromaShift adds an MSIX/AppX package and distributes that package through the
Store. It is a separate release channel, not free signing for the existing NSIS
download. Treat a Store package as a later product decision unless Store
distribution is wanted for its own sake.

Artifact attestations are worth adding after the signing path is settled. They
prove build provenance, but they do not replace Authenticode.

## What ChromaShift needs signed

The current release workflow builds an Electron Builder NSIS installer and then
checks three files with `Get-AuthenticodeSignature`:

- `ChromaShift-<version>-x64-setup.exe`
- `win-unpacked/ChromaShift.exe`
- `win-unpacked/resources/display-service/ChromaShift.DisplayService.exe`

The workflow currently accepts only a PFX through `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD`. SignPath and Artifact Signing keep private keys in their
services, so neither is a drop-in secret replacement. The workflow will need a
service-specific signing step or Electron Builder custom signing hook.

The safe build order is important. ChromaShift must sign the Electron executable
and `ChromaShift.DisplayService.exe` before NSIS embeds them, then sign the final installer.
A SignPath artifact configuration may be able to perform nested signing, but that
must be proven with the actual package. Otherwise the workflow needs two signing
requests. In either case, retain the existing per-file signature gate after the
final signed artifact returns.

## Options

| Option | Source can stay private | Cost | Keeps direct NSIS release | GitHub Actions | Meets the current Authenticode gate |
| --- | --- | --- | --- | --- | --- |
| SignPath Foundation | No | Free for accepted OSS projects | Yes | Official SignPath action | Yes, after a staged or proven nested-signing integration |
| Azure Artifact Signing | Yes | $9.99/month Basic | Yes | Official action and SignTool integration | Yes |
| Microsoft Store MSIX | Yes | Free signing and hosting | No, adds a Store/MSIX channel | Partner Center submission automation is possible | Package trust yes; current three-file gate needs a different definition |
| Self-signed certificate | Yes | Free | Technically | Yes | Cryptographic signature only; not publicly trusted |
| GitHub artifact attestation | Yes | Included with GitHub Actions | Yes | Native | No |

### SignPath Foundation

SignPath Foundation provides free signing for qualifying open-source projects
and stores its certificate key in an HSM.
[Its program page describes the service and cost](https://signpath.org/).
Microsoft describes the result as OV-level signing through a managed pipeline in
its own
[Windows code-signing comparison](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options#open-source-signpath-foundation).
SignPath supplies an
[official GitHub Action](https://github.com/SignPath/github-action-submit-signing-request)
that submits a built artifact and returns the signed result.

The catch is eligibility and control:

- Every component must use an OSI-approved license, without commercial dual
  licensing or proprietary project code.
- The project must be maintained, documented, and already released in the form
  that will be signed.
- The certificate belongs to SignPath Foundation. Windows will show `SignPath
  Foundation` as the publisher, not `ChromaShift` or the maintainer's name.
- Team members must use MFA. The project must name author, reviewer, and approver
  roles.
- Every release requires manual signing approval.
- The repository or project site must publish a code-signing policy, role list,
  and privacy statement.
- SignPath verifies that release binaries came from the configured repository
  and automated build. Acceptance and continued access remain at its discretion.

These are SignPath's
[current Foundation terms](https://signpath.org/terms.html). Its GitHub trusted
build system also performs origin verification against GitHub Actions;
[the integration requirements are documented here](https://docs.signpath.io/trusted-build-systems/github).

ChromaShift is not eligible today. The GitHub repository is private, the root
has no license file, and GitHub reports no detected license. The existing preview
releases may satisfy the "already released in the form to be signed" condition
after the project is public, but SignPath must make that determination.

If open-sourcing is approved, the practical sequence is:

1. Choose an OSI-approved license and confirm that every shipped project-owned
   component can use it.
2. Make the repository and release/download documentation public.
3. Add the required privacy and code-signing policy text, team roles, MFA, and
   protected release workflow.
4. Apply to SignPath with the existing NSIS preview release as format evidence.
5. After acceptance, prototype signing of all three required files and confirm
   the publisher, timestamp, clean-machine trust, and SmartScreen behavior.

This path has no certificate fee, but it is not automatic approval and it makes
open source a release prerequisite.

### Azure Artifact Signing

Microsoft renamed Trusted Signing to Azure Artifact Signing. Its Public Trust
model issues short-lived certificates rooted in Microsoft's trusted program and
is intended for publicly distributed Win32 applications.
[The service overview explains the managed certificate model](https://learn.microsoft.com/en-us/azure/artifact-signing/overview).

The Basic plan costs $9.99 per account per month for up to 5,000 signatures;
additional signatures cost $0.005 each.
[Microsoft publishes the current pricing](https://azure.microsoft.com/en-us/products/artifact-signing/).
It is low-cost, not free.

Public Trust requires identity validation. Individuals must be in the United
States or Canada. Organizations currently have a wider but still limited country
list.
[The current regions and identity prerequisites are in the setup quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).
Identity review can take 1 to 20 business days, so this work cannot wait until
release day.
[Microsoft documents that review window here](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-renew-identity-validation).

Artifact Signing works well with a private repository. Microsoft supports both
SignTool and GitHub Actions, and the certificate key never needs to enter a
GitHub secret.
[The integration guide includes both paths](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations).
For ChromaShift, the workflow would sign the two application executables before
NSIS packaging and sign the installer afterward, then run the current PowerShell
verification unchanged.

This is the fallback if SignPath is unavailable or ChromaShift remains private.
There is little reason to buy a traditional OV or EV certificate first. Microsoft
quotes traditional OV certificates at roughly $150 to $300 per year and says EV
no longer receives an automatic SmartScreen bypass.
[Its comparison records both points](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

### Microsoft Store MSIX

The Store route does not require the source to be public. Microsoft currently
offers new individual and company developer accounts without a registration fee
when enrollment begins at its Store developer page, although it still requires
identity or business verification.
[The current onboarding instructions describe the free flow](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account).

For MSIX/AppX submissions, Microsoft signs the package after certification and
provides hosting and updates. Store-installed packages avoid SmartScreen download
warnings. For an EXE or MSI submission, including ChromaShift's current NSIS
installer, Microsoft does not sign it. The publisher must provide a trusted
Authenticode signature for the installer and its PE files.
[Microsoft's distribution comparison makes this distinction explicit](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path).

This makes Store MSIX the only free path found that works with private source,
but it changes the package and distribution model. ChromaShift would need an MSIX
packaging spike that checks the external `ChromaShift.DisplayService.exe`, per-user data,
startup registration, global shortcuts, tray behavior, auto-update policy,
install/upgrade/uninstall, and restore-safe shutdown. The current NSIS package
should remain available until that spike proves parity.

Microsoft documents Store signing at the package level. It does not promise that
each embedded executable will receive its own Authenticode signature. Therefore,
it is an inference that a Store-only release should replace the present
three-file Authenticode gate with package-signature and package-integrity checks,
rather than pretending the existing gate passed.
[The MSIX signing overview explains package-level integrity](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview).

### Self-signed certificates

A self-signed certificate can make `Get-AuthenticodeSignature` report a
cryptographic signature on a machine where the certificate was manually trusted.
That does not provide public Windows trust. On ordinary user machines,
self-signed releases receive the same SmartScreen treatment as unsigned files.
[Microsoft limits self-signed certificates to development or managed enterprise
trust](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options#self-signed-certificates--dev-and-testing-only).

Self-signing is useful for exercising the packaging pipeline locally. It cannot
close Milestone 8's distribution-trust slice.

### GitHub artifact attestations

GitHub artifact attestations bind a binary digest to its repository and workflow
provenance. Users verify them with `gh attestation verify`.
[GitHub documents generation and verification here](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

Windows does not use that GitHub verification path for Authenticode, publisher
display, SmartScreen, or Smart App Control. This conclusion is an inference from
the separate verification models: GitHub requires its CLI to verify the
attestation, while Windows public trust requires a code-signing certificate from
a trusted root.
[Microsoft describes the Windows trust requirement here](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models).

Add attestations as supply-chain evidence if desired. Do not count them as signed
Windows distribution.

## Milestone 8 decision

Use these gates for Milestone 8:

- prepare and publish ChromaShift as an open-source project after an explicit
  publication checkpoint under the MIT license, preserving its Git history and
  author metadata and using `ChromaShift contributors` as the copyright
  attribution
- keep the direct GitHub-hosted NSIS installer as the primary release
- use Azure Artifact Signing Basic with an individually validated publisher
  identity for the NSIS installer and its executables
- produce and publish `v0.1.0-preview.3` as the first signed release after the
  existing release gates pass
- optional later channel: Store MSIX, after a dedicated compatibility spike
- not acceptable as release trust: a self-signed certificate, unsigned release,
  or artifact attestation alone.

The signed release uses ChromaShift's existing package and desktop gates plus
per-file signature validation. Milestone 8 does not add a clean-system VM or a
SmartScreen reputation study.
