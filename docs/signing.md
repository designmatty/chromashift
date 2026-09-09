# Windows release signing

ChromaShift will sign direct NSIS releases with Azure Artifact Signing Basic and
an individually validated Public Trust identity. The accepted decision is in
[ADR 0001](adr/0001-open-source-and-windows-release-trust.md). Rejected signing
options and the completed comparison have been removed from maintained docs.

## Current state

Issue #45 completed the human Azure enrollment and least-privilege federated
identity. The release workflow uses that identity for Azure Artifact Signing and
does not accept the former PFX inputs or an unsigned tag path. The maintainer
authorized unsigned `v0.1.0-preview.3` as a private-repository hotfix cut for
uninstall validation. Issue #47 will build and validate signed
`v0.1.0-preview.4`. Issue #48 is the explicit publication checkpoint.

No certificate key or identity document belongs in this repository or in a
GitHub secret. GitHub Actions will authenticate to Azure through workload identity
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
3. Build NSIS with those signed executables embedded.
4. Sign `ChromaShift-<version>-x64-setup.exe`.
5. Regenerate the installer block map and `latest.yml` hash from the signed
   installer.
6. Verify that all three signatures are valid, timestamped, and issued to the
   approved publisher before creating the draft release.

Both verification stages compare every signer certificate with the independently
recorded subject from the approved certificate profile. Final preflight also
requires a valid Windows trust result and a timestamp certificate for every file.

Ordinary `npm run build`, `npm run package:dir`, and `npm run package:win` commands
remain unsigned and require no Azure account.

## Microsoft references

- [Artifact Signing setup quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Resources and roles](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-resources-roles)
- [Role assignment tutorial](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles)
- [Signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
- [Workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust)
