import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

test(
  'the Builder hook signs literal paths and rejects signing or trust failures',
  {
    skip: globalThis.process.platform !== 'win32'
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chromashift-sign-hook-'))
    try {
      const moduleDirectory = join(directory, 'ArtifactSigning')
      await mkdir(moduleDirectory)
      // Substitute only the external signing and Windows trust commands. The
      // production Builder hook, PowerShell script, and verifier run unchanged.
      await writeFile(
        join(moduleDirectory, 'ArtifactSigning.psm1'),
        `
function Invoke-ArtifactSigning {
  param($Endpoint, $CodeSigningAccountName, $CertificateProfileName, $Files,
    $Description, $FileDigest, $TimestampRfc3161, $TimestampDigest,
    $ExcludeEnvironmentCredential, $ExcludeWorkloadIdentityCredential,
    $ExcludeManagedIdentityCredential, $ExcludeSharedTokenCacheCredential,
    $ExcludeVisualStudioCredential, $ExcludeVisualStudioCodeCredential,
    $ExcludeAzureCliCredential, $ExcludeAzurePowerShellCredential,
    $ExcludeAzureDeveloperCliCredential, $ExcludeInteractiveBrowserCredential)
  if ($env:CHROMASHIFT_TEST_SIGN_MODE -eq 'sign-error') { throw 'Service signing failed.' }
  $PSBoundParameters | ConvertTo-Json | Set-Content -LiteralPath $env:CHROMASHIFT_TEST_SIGN_RECORD
}
function Get-AuthenticodeSignature {
  param($LiteralPath)
  $status = if ($env:CHROMASHIFT_TEST_SIGN_MODE -eq 'unsigned') { 'NotSigned' } else { 'Valid' }
  $publisher = if ($env:CHROMASHIFT_TEST_SIGN_MODE -eq 'wrong-publisher') { 'CN=Someone Else' } else { 'CN=Expected Publisher' }
  $timestamp = if ($env:CHROMASHIFT_TEST_SIGN_MODE -eq 'no-timestamp') { $null } else { @{} }
  [pscustomobject]@{ Status = $status; SignerCertificate = [pscustomobject]@{ Subject = $publisher }; TimeStamperCertificate = $timestamp }
}
Export-ModuleMember -Function Invoke-ArtifactSigning, Get-AuthenticodeSignature
`
      )
      const executable = join(directory, "Uninstall ChromaShift's test.exe")
      await writeFile(executable, 'executable fixture')
      const record = join(directory, 'sign-request.json')
      const hook = pathToFileURL(
        join(import.meta.dirname, '../apps/desktop/scripts/sign-release-executable.mjs')
      ).href
      const environment = {
        ...globalThis.process.env,
        PSModulePath: `${directory};${globalThis.process.env.PSModulePath ?? ''}`,
        AZURE_ARTIFACT_SIGNING_ENDPOINT: 'https://example.codesigning.azure.net/',
        AZURE_ARTIFACT_SIGNING_ACCOUNT: 'account',
        AZURE_ARTIFACT_SIGNING_PROFILE: 'profile',
        AZURE_ARTIFACT_SIGNING_PUBLISHER: 'CN=Expected Publisher',
        CHROMASHIFT_TEST_SIGN_RECORD: record
      }
      const run = (mode, overrides = {}) =>
        spawnSync(
          globalThis.process.execPath,
          [
            '--input-type=module',
            '-e',
            `import sign from ${JSON.stringify(hook)}; sign({path: ${JSON.stringify(executable)}})`
          ],
          {
            encoding: 'utf8',
            env: { ...environment, CHROMASHIFT_TEST_SIGN_MODE: mode, ...overrides }
          }
        )
      const success = run('valid')
      assert.equal(success.status, 0, success.stderr)
      const request = JSON.parse(await readFile(record, 'utf8'))
      assert.equal(request.Files, executable)
      assert.equal(request.Description, 'ChromaShift')
      assert.equal(request.FileDigest, 'SHA256')
      assert.equal(request.TimestampDigest, 'SHA256')
      assert.equal(request.TimestampRfc3161, 'http://timestamp.acs.microsoft.com')
      assert.equal(request.ExcludeAzureCliCredential, false)
      for (const [name, excluded] of Object.entries(request)) {
        if (name.startsWith('Exclude') && name !== 'ExcludeAzureCliCredential')
          assert.equal(excluded, true, name)
      }
      for (const [mode, message] of [
        ['sign-error', /Service signing failed/],
        ['unsigned', /Invalid Authenticode signature/],
        ['wrong-publisher', /Wrong Authenticode publisher/],
        ['no-timestamp', /Authenticode timestamp is missing/]
      ]) {
        const failure = run(mode)
        assert.notEqual(failure.status, 0, mode)
        assert.match(failure.stderr, message)
      }
      const missingConfiguration = run('valid', { AZURE_ARTIFACT_SIGNING_ENDPOINT: '' })
      assert.notEqual(missingConfiguration.status, 0)
      assert.match(
        missingConfiguration.stderr,
        /Release signing requires AZURE_ARTIFACT_SIGNING_ENDPOINT/
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)
