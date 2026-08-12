import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory = resolve(scriptDirectory, '../out/renderer')
const totalGzipBudget = 320_000
const largestJavaScriptBudget = 1_100_000

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? filesUnder(path) : [path]
    })
  )
  return files.flat()
}

const assets = []
for (const path of await filesUnder(outputDirectory)) {
  const extension = extname(path)
  if (extension !== '.js' && extension !== '.css') continue
  const contents = await readFile(path)
  assets.push({
    path: relative(outputDirectory, path),
    rawBytes: contents.length,
    gzipBytes: gzipSync(contents, { level: 9 }).length
  })
}

const totalGzipBytes = assets.reduce((total, asset) => total + asset.gzipBytes, 0)
const largestJavaScript = assets
  .filter((asset) => extname(asset.path) === '.js')
  .sort((left, right) => right.rawBytes - left.rawBytes)[0]

globalThis.console.log(
  JSON.stringify(
    {
      totalGzipBytes,
      totalGzipBudget,
      largestJavaScript,
      largestJavaScriptBudget,
      assets
    },
    null,
    2
  )
)

if (totalGzipBytes > totalGzipBudget) {
  throw new Error(`Renderer JavaScript and CSS exceed the ${totalGzipBudget}-byte gzip budget.`)
}
if (largestJavaScript !== undefined && largestJavaScript.rawBytes > largestJavaScriptBudget) {
  throw new Error(`Largest renderer chunk exceeds the ${largestJavaScriptBudget}-byte raw budget.`)
}
