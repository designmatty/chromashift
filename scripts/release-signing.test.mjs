import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { URL } from 'node:url'

const repositoryRoot = new URL('..', import.meta.url)

async function text(path) {
  return readFile(new URL(path, repositoryRoot), 'utf8')
}

test('the release workflow signs every executable in package order through Azure OIDC', async () => {
  const workflow = await text('.github/workflows/release.yml')
  const rootPackage = JSON.parse(await text('package.json'))
  const desktopPackage = JSON.parse(await text('apps/desktop/package.json'))

  assert.match(workflow, /permissions:\s+contents: write\s+id-token: write/)
  assert.match(workflow, /environment: release-signing/)
  assert.match(workflow, /uses: azure\/login@v3/)
  assert.match(workflow, /client-id: \$\{\{ vars\.AZURE_CLIENT_ID \}\}/)
  assert.match(workflow, /tenant-id: \$\{\{ vars\.AZURE_TENANT_ID \}\}/)
  assert.match(workflow, /subscription-id: \$\{\{ vars\.AZURE_SUBSCRIPTION_ID \}\}/)

  const stages = [
    'npm run package:release:prepare',
    'name: Sign packaged executables',
    'name: Verify packaged executable signatures',
    'npm run package:release:installer',
    'name: Sign Windows installer',
    'npm run package:release:finalize',
    'npm run release:preflight -- --tag $env:GITHUB_REF_NAME --artifacts --signatures'
  ]
  let previous = -1
  for (const stage of stages) {
    const index = workflow.indexOf(stage)
    assert.ok(index > previous, `${stage} must follow the previous release stage`)
    previous = index
  }

  assert.match(
    workflow,
    /files:\s+\|\s+\$\{\{ github\.workspace \}\}\\apps\\desktop\\release\\win-unpacked\\ChromaShift\.exe\s+\$\{\{ github\.workspace \}\}\\apps\\desktop\\release\\win-unpacked\\resources\\display-service\\ChromaShift\.DisplayService\.exe/
  )
  assert.match(
    workflow,
    /files: \$\{\{ github\.workspace \}\}\\apps\\desktop\\release\\ChromaShift-\$\{\{ steps\.version\.outputs\.value \}\}-x64-setup\.exe/
  )
  assert.equal(workflow.match(/uses: azure\/artifact-signing-action@v2/g)?.length, 2)
  assert.match(workflow, /endpoint: \$\{\{ vars\.AZURE_ARTIFACT_SIGNING_ENDPOINT \}\}/)
  assert.match(workflow, /signing-account-name: \$\{\{ vars\.AZURE_ARTIFACT_SIGNING_ACCOUNT \}\}/)
  assert.match(
    workflow,
    /certificate-profile-name: \$\{\{ vars\.AZURE_ARTIFACT_SIGNING_PROFILE \}\}/
  )
  assert.match(workflow, /timestamp-rfc3161: http:\/\/timestamp\.acs\.microsoft\.com/)
  assert.match(workflow, /timestamp-digest: SHA256/)
  assert.equal(workflow.match(/vars\.AZURE_ARTIFACT_SIGNING_PUBLISHER/g)?.length, 2)
  assert.doesNotMatch(workflow, /steps\.packaged-signatures\.outputs\.publisher/)
  assert.doesNotMatch(workflow, /WIN_CSC|signed=false|isPrerelease/)

  const signatureVerifier = await text('scripts/verify-authenticode.ps1')
  assert.match(signatureVerifier, /Status -ne 'Valid'/)
  assert.match(signatureVerifier, /TimeStamperCertificate/)
  assert.match(signatureVerifier, /actualPublisher -cne \$ExpectedPublisher/)

  const preflight = await text('scripts/release-preflight.mjs')
  assert.match(preflight, /'--signatures requires --artifacts\.'/)
  assert.match(preflight, /'--signatures requires --expected-publisher\.'/)

  assert.match(rootPackage.scripts['package:release:prepare'], /package:release:prepare/)
  assert.match(rootPackage.scripts['package:release:installer'], /package:release:installer/)
  assert.match(rootPackage.scripts['package:release:finalize'], /package:release:finalize/)
  assert.match(
    desktopPackage.scripts['package:release:prepare'],
    /electron-builder --win dir --x64/
  )
  assert.match(
    desktopPackage.scripts['package:release:installer'],
    /electron-builder --win nsis --x64 --prepackaged release\/win-unpacked/
  )
})

test('release metadata finalization hashes and maps the signed installer bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chromashift-signing-'))
  const version = '1.2.3-preview.4'
  const installerName = `ChromaShift-${version}-x64-setup.exe`
  const installer = join(directory, installerName)
  const bytes = Buffer.from('signed installer fixture\n'.repeat(1024))
  await writeFile(installer, bytes)
  await writeFile(
    join(directory, 'latest.yml'),
    `version: ${version}\nfiles:\n  - url: ${installerName}\n    sha512: stale\n    size: 1\npath: ${installerName}\nsha512: stale\nreleaseDate: '2026-09-08T00:00:00.000Z'\n`
  )

  const result = spawnSync(
    process.execPath,
    [
      'scripts/finalize-release-metadata.mjs',
      '--release-directory',
      directory,
      '--version',
      version
    ],
    { cwd: new URL('.', repositoryRoot), encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)

  const expectedHash = createHash('sha512').update(bytes).digest('base64')
  const manifest = await readFile(join(directory, 'latest.yml'), 'utf8')
  assert.equal(manifest.match(/sha512: (\S+)/g)?.length, 2)
  assert.match(manifest, new RegExp(`sha512: ${expectedHash.replace(/[+]/g, '\\+')}`))
  assert.match(manifest, new RegExp(`size: ${bytes.length}`))
  assert.match(manifest, /releaseDate: '2026-09-08T00:00:00.000Z'/)

  const compressedBlockMap = await readFile(join(directory, `${installerName}.blockmap`))
  const blockMap = JSON.parse(gunzipSync(compressedBlockMap).toString('utf8'))
  assert.equal(blockMap.version, '2')
  assert.equal(
    blockMap.files[0].sizes.reduce((total, size) => total + size, 0),
    bytes.length
  )
})
