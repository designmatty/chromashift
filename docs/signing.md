# Windows release signing

ChromaShift signs direct NSIS releases with Azure Artifact Signing Basic and
an individually validated Public Trust identity. The accepted decision is in
[ADR 0001](adr/0001-open-source-and-windows-release-trust.md). Rejected signing
options and the completed comparison have been removed from maintained docs.

## Current state

Issue #45 completed the human Azure enrollment and least-privilege federated
identity. The release workflow uses that identity for Azure Artifact Signing and
does not accept the former PFX inputs or an unsigned tag path. Signed previews
have shipped since `v0.1.0-preview.4`. Publication still requires the maintainer's
explicit approval.

No certificate key or identity document belongs in this repository or in a
GitHub secret. GitHub Actions authenticates to Azure through workload identity
federation.

## Enrollment resources

The Azure account must contain:

1. an Artifact Signing Basic account in the intended subscription and billing
   account
2. a completed Individual Developer Public identity validation
3. a Public Trust certificate profile whose subject preview matches the intended
   Windows publisher
4. a Microsoft Entra application or managed identity with a GitHub Actions
   federated credential

Identity validation happens in the Azure portal. Microsoft currently requires
the `Artifact Signing Identity Verifier` role for that request. The GitHub
identity needs only `Artifact Signing Certificate Profile Signer`, scoped to the
certificate profile, for release signing. Account creation and certificate
profile administration stay with the human-owned Azure identity.

Record these non-secret integration values as repository variables:

- Azure tenant ID
- Azure subscription ID
- federated application client ID
- Artifact Signing endpoint
- account name
- certificate profile name
- exact certificate subject from the approved publisher preview

The repository uses `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
`AZURE_CLIENT_ID`, `AZURE_ARTIFACT_SIGNING_ENDPOINT`,
`AZURE_ARTIFACT_SIGNING_ACCOUNT`, `AZURE_ARTIFACT_SIGNING_PROFILE`, and
`AZURE_ARTIFACT_SIGNING_PUBLISHER` in the `release-signing` GitHub environment.

Do not record validation documents, billing details, access tokens, or private
keys in GitHub.

## Signing order

The build must sign files in this order:

1. Build the unpacked Electron application and publish the native helper.
2. Sign `ChromaShift.exe` and `ChromaShift.DisplayService.exe`.
3. Build NSIS with those signed executables embedded. The release-only Builder
   configuration invokes `scripts/sign-release-executable.ps1` through a signing
   hook to sign and verify the generated uninstaller before embedding it.
4. The same hook signs and verifies `ChromaShift-<version>-x64-setup.exe` after
   NSIS finishes. It also signs the packaged elevation helper when Builder copies it.
5. Regenerate the installer block map and `latest.yml` hash from the signed
   installer.
6. Extract `Uninstall ChromaShift.exe` from the finished installer and verify it
   alongside the installer, app, and display helper. All four signatures must be
   valid, timestamped, and issued to the approved publisher before draft creation.

Both verification stages compare every signer certificate with the independently
recorded subject from the approved certificate profile. Final preflight also
requires a valid Windows trust result and a timestamp certificate for every file.

The Builder hook reuses the `ArtifactSigning` PowerShell module installed by
`azure/artifact-signing-action@v2`. Authentication uses only the Azure CLI session
created by `azure/login`; the hook excludes interactive and other credential
sources. Missing signing configuration or failed verification stops the build.

Ordinary `npm run build`, `npm run package:dir`, and `npm run package:win` commands
remain unsigned and require no Azure account.

## Windows prompts and SmartScreen

The installer and uninstaller use `ChromaShift` as their file description and
signed-content description, so UAC displays the product name. The verified
publisher comes from the certificate's validated legal identity, not the package
author or product name.

Authenticode establishes publisher identity and detects changes to signed files.
Microsoft Defender SmartScreen also evaluates the publisher and file hash's
reputation. New signed releases can still show an unrecognized-app warning.
Azure Artifact Signing does not guarantee that this warning disappears, and
Microsoft publishes no fixed reputation threshold or timeline. Keep the same
validated signing identity across releases and describe this limitation to early
users. See [Microsoft's SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

Previous signed previews omitted the generated uninstaller from signing and
verification. Installing a release built with the signing hook replaces that
unsigned uninstaller; signing a new installer does not repair old installations
until they are upgraded.

## Microsoft references

- [Artifact Signing setup quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Resources and roles](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-resources-roles)
- [Role assignment tutorial](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles)
- [Signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
- [Workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust)
