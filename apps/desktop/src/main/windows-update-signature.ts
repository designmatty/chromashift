import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

const execute = promisify(execFile)
const signatureSchema = z.object({ status: z.string(), subject: z.string().nullable() })

export async function readTrustedPublisher(path: string): Promise<string> {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:CHROMASHIFT_UPDATE_SIGNATURE_PATH',
    '@{ status = $signature.Status.ToString(); subject = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Subject } } | ConvertTo-Json -Compress'
  ].join('\n')
  const environment: NodeJS.ProcessEnv = { ...process.env, CHROMASHIFT_UPDATE_SIGNATURE_PATH: path }
  // PowerShell 7's inherited module path can break Windows PowerShell's security module.
  delete environment.PSModulePath
  try {
    const { stdout } = await execute(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-OutputFormat',
        'Text',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')
      ],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        env: environment
      }
    )
    const signature = signatureSchema.parse(JSON.parse(stdout.replace(/^\uFEFF/u, '').trim()))
    if (signature.status !== 'Valid' || !signature.subject) throw new Error('Untrusted signature')
    return signature.subject
  } catch (cause) {
    throw new Error('A valid Windows publisher signature is required for in-app updates.', {
      cause
    })
  }
}
