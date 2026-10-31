import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

test(
  'payload signing preserves vendor signatures, signs unsigned PE files, and fails on invalid trust',
  { skip: globalThis.process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chromashift-payload-'))
    try {
      const payload = join(directory, 'payload')
      const moduleDirectory = join(directory, 'ArtifactSigning')
      await mkdir(payload)
      await mkdir(moduleDirectory)
      await writeFile(join(payload, 'vendor.dll'), 'MZvendor')
      await writeFile(join(payload, 'new.native'), 'MZunsigned')
      await writeFile(join(payload, 'notice.txt'), 'license fixture')
      const record = join(directory, 'signed-paths.txt')
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
  Add-Content -LiteralPath $env:CHROMASHIFT_TEST_SIGN_RECORD -Value $Files
}
function Get-AuthenticodeSignature {
  param($LiteralPath)
  $vendor = $LiteralPath.EndsWith('vendor.dll')
  $signed = (Test-Path -LiteralPath $env:CHROMASHIFT_TEST_SIGN_RECORD) -and
    ((Get-Content -LiteralPath $env:CHROMASHIFT_TEST_SIGN_RECORD) -contains $LiteralPath)
  $status = if ($vendor -or $signed) { 'Valid' } else { 'NotSigned' }
  if ($vendor -and $env:CHROMASHIFT_TEST_MODE -eq 'invalid') { $status = 'HashMismatch' }
  $timestamp = if ($vendor -and $env:CHROMASHIFT_TEST_MODE -eq 'no-timestamp') { $null } else { @{} }
  $publisher = if ($vendor) { 'CN=Vendor' } else { 'CN=Expected Publisher' }
  [pscustomobject]@{ Status = $status; SignerCertificate = [pscustomobject]@{Subject = $publisher}; TimeStamperCertificate = $timestamp }
}
Export-ModuleMember -Function Invoke-ArtifactSigning, Get-AuthenticodeSignature
`
      )
      const runner = join(directory, 'run.ps1')
      await writeFile(
        runner,
        `
$ErrorActionPreference = 'Stop'
Import-Module ArtifactSigning
& $env:CHROMASHIFT_TEST_PAYLOAD_SCRIPT -Directory $env:CHROMASHIFT_TEST_PAYLOAD -ExpectedPublisher 'CN=Expected Publisher' -SignUnsigned:($env:CHROMASHIFT_TEST_SIGN -eq 'true')
`
      )
      const run = (mode, sign = false) =>
        spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', runner], {
          encoding: 'utf8',
          env: {
            ...globalThis.process.env,
            PSModulePath: `${directory};${globalThis.process.env.PSModulePath ?? ''}`,
            AZURE_ARTIFACT_SIGNING_ENDPOINT: 'https://example.codesigning.azure.net/',
            AZURE_ARTIFACT_SIGNING_ACCOUNT: 'account',
            AZURE_ARTIFACT_SIGNING_PROFILE: 'profile',
            AZURE_ARTIFACT_SIGNING_PUBLISHER: 'CN=Expected Publisher',
            CHROMASHIFT_TEST_SIGN_RECORD: record,
            CHROMASHIFT_TEST_PAYLOAD_SCRIPT: resolve('scripts/verify-release-payload.ps1'),
            CHROMASHIFT_TEST_PAYLOAD: payload,
            CHROMASHIFT_TEST_MODE: mode,
            CHROMASHIFT_TEST_SIGN: String(sign)
          }
        })
      const unsigned = run('valid')
      assert.notEqual(unsigned.status, 0)
      assert.match(unsigned.stderr, /signature or timestamp is invalid/)
      const signed = run('valid', true)
      assert.equal(signed.status, 0, signed.stderr)
      assert.deepEqual((await readFile(record, 'utf8')).trim().split(/\r?\n/u), [
        join(payload, 'new.native')
      ])
      assert.equal(run('valid').status, 0)
      for (const mode of ['invalid', 'no-timestamp']) {
        const failure = run(mode, true)
        assert.notEqual(failure.status, 0)
        assert.match(failure.stderr, /signature or timestamp is invalid/)
      }
      assert.doesNotMatch(await readFile(record, 'utf8'), /vendor\.dll/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)
